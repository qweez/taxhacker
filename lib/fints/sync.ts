import { prisma } from "@/lib/db"
import type { Transaction as FinTSTransaction } from "lib-fints"
import type { Transaction } from "@/prisma/client"

export type SyncStats = {
  imported: number
  skipped: number
  errors: string[]
}

/**
 * Generate a stable external ID for deduplication from FinTS transaction fields.
 */
function generateExternalId(tx: FinTSTransaction, accountNumber: string): string {
  const parts = [
    accountNumber,
    tx.valueDate?.toISOString().slice(0, 10) || "",
    tx.amount?.toString() || "0",
    tx.customerReference || "",
    tx.e2eReference || "",
    tx.purpose?.slice(0, 50) || "",
  ]
  return parts.join("|")
}

/**
 * Sync FinTS transactions into the database, with idempotent upserts.
 */
export async function syncBankTransactions(
  userId: string,
  bankAccountId: string,
  fintsTransactions: FinTSTransaction[],
): Promise<SyncStats> {
  const stats: SyncStats = { imported: 0, skipped: 0, errors: [] }

  for (const ftx of fintsTransactions) {
    const externalId = generateExternalId(ftx, bankAccountId)

    try {
      // Check if already imported
      const existing = await prisma.transaction.findFirst({
        where: { userId, externalId },
      })

      if (existing) {
        stats.skipped++
        continue
      }

      // Determine type: positive amount = income, negative = expense
      const isIncome = ftx.amount > 0
      const totalCents = Math.round(Math.abs(ftx.amount) * 100)

      // Build a descriptive name from available fields
      const name = ftx.remoteName || ftx.bookingText || ftx.purpose?.slice(0, 80) || "Bankumsatz"
      const merchant = ftx.remoteName || undefined
      const description = [ftx.purpose, ftx.additionalInformation].filter(Boolean).join(" | ")

      await prisma.transaction.create({
        data: {
          userId,
          name,
          merchant,
          description: description || undefined,
          total: totalCents,
          currencyCode: "EUR",
          type: isIncome ? "income" : "expense",
          issuedAt: ftx.valueDate || ftx.entryDate,
          sourceType: "fints",
          externalId,
          bankAccountId,
          isReconciled: false,
          text: [
            ftx.bookingText,
            ftx.purpose,
            ftx.remoteName,
            ftx.e2eReference ? `E2E: ${ftx.e2eReference}` : null,
            ftx.mandateReference ? `Mandat: ${ftx.mandateReference}` : null,
            ftx.remoteAccountNumber ? `Kto: ${ftx.remoteAccountNumber}` : null,
            ftx.remoteBankId ? `BLZ: ${ftx.remoteBankId}` : null,
          ].filter(Boolean).join("\n"),
        },
      })

      stats.imported++
    } catch (error: any) {
      stats.errors.push(`${externalId}: ${error.message}`)
    }
  }

  // Update bank account last sync timestamp
  await prisma.finTSBankAccount.update({
    where: { id: bankAccountId },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: stats.errors.length > 0
        ? `${stats.imported} imported, ${stats.errors.length} errors`
        : `${stats.imported} imported, ${stats.skipped} skipped`,
    },
  })

  return stats
}

/**
 * Find potential matches between bank-imported transactions and manual transactions.
 * Matches on amount + date (within 3 days) + similar merchant name.
 */
export async function findReconciliationCandidates(
  userId: string,
  bankTransactionId: string,
): Promise<Transaction[]> {
  const bankTx = await prisma.transaction.findUnique({
    where: { id: bankTransactionId, userId },
  })

  if (!bankTx || !bankTx.total || !bankTx.issuedAt) return []

  const dateFrom = new Date(bankTx.issuedAt)
  dateFrom.setDate(dateFrom.getDate() - 3)
  const dateTo = new Date(bankTx.issuedAt)
  dateTo.setDate(dateTo.getDate() + 3)

  return await prisma.transaction.findMany({
    where: {
      userId,
      sourceType: "manual",
      isReconciled: false,
      total: bankTx.total,
      issuedAt: { gte: dateFrom, lte: dateTo },
      id: { not: bankTransactionId },
    },
    include: { category: true, project: true },
  })
}

/**
 * Reconcile a bank transaction with a manual transaction.
 */
export async function reconcileTransactions(
  userId: string,
  bankTransactionId: string,
  manualTransactionId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.transaction.update({
      where: { id: bankTransactionId, userId },
      data: { isReconciled: true, reconciledAt: new Date() },
    }),
    prisma.transaction.update({
      where: { id: manualTransactionId, userId },
      data: { isReconciled: true, reconciledAt: new Date() },
    }),
  ])
}
