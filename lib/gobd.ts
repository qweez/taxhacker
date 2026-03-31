import { prisma } from "@/lib/db"
import { logAuditEvent } from "@/models/audit-log"
import type { Transaction } from "@/prisma/client"

/**
 * GoBD (Grundsaetze ordnungsgemaesser Buchfuehrung) compliance utilities.
 *
 * - Unveraenderlichkeit: locked transactions cannot be modified or deleted
 * - Nachvollziehbarkeit: every change is traced via audit log
 * - Ordnungsmaessigkeit: sequential booking numbers, no gaps
 */

/** Lock a single transaction (Festschreibung) -- makes it immutable. */
export async function lockTransaction(
  userId: string,
  transactionId: string,
): Promise<void> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId, userId },
  })

  if (!transaction) {
    throw new Error("Transaction not found")
  }

  if (transaction.isLocked) {
    throw new Error("Transaction is already locked")
  }

  await prisma.transaction.update({
    where: { id: transactionId, userId },
    data: {
      isLocked: true,
      lockedAt: new Date(),
    },
  })

  await logAuditEvent(userId, "transaction.lock", transactionId, {
    bookingNumber: transaction.bookingNumber,
  })
}

/** Lock all transactions up to a given date (e.g. end of month/quarter). Returns the count of newly locked transactions. */
export async function lockTransactionsUntil(
  userId: string,
  until: Date,
): Promise<number> {
  const result = await prisma.transaction.updateMany({
    where: {
      userId,
      isLocked: false,
      issuedAt: { lte: until },
    },
    data: {
      isLocked: true,
      lockedAt: new Date(),
    },
  })

  await logAuditEvent(userId, "transaction.lock_batch", undefined, {
    until: until.toISOString(),
    count: result.count,
  })

  return result.count
}

/** Create a reversal booking (Stornobuchung) for a locked transaction. */
export async function createReversalBooking(
  userId: string,
  transactionId: string,
  reason: string,
): Promise<Transaction> {
  const original = await prisma.transaction.findUnique({
    where: { id: transactionId, userId },
  })

  if (!original) {
    throw new Error("Transaction not found")
  }

  if (!original.isLocked) {
    throw new Error(
      "Transaction is not locked. Unlock transactions can be edited directly.",
    )
  }

  if (original.reversedById) {
    throw new Error("Transaction has already been reversed")
  }

  // Create the reversal and update the original in a single database transaction
  const reversal = await prisma.$transaction(async (tx) => {
    const reversalTx = await tx.transaction.create({
      data: {
        userId,
        name: `Storno: ${original.name ?? ""}`,
        description: reason,
        merchant: original.merchant,
        total: original.total ? -original.total : 0,
        currencyCode: original.currencyCode,
        convertedTotal: original.convertedTotal
          ? -original.convertedTotal
          : null,
        convertedCurrencyCode: original.convertedCurrencyCode,
        type: original.type,
        categoryCode: original.categoryCode,
        projectCode: original.projectCode,
        issuedAt: original.issuedAt,
        sourceType: "reversal",
        note: `Stornobuchung: ${reason}`,
        reversalOfId: original.id,
        isLocked: true,
        lockedAt: new Date(),
      },
    })

    // Link the original to its reversal
    await tx.transaction.update({
      where: { id: original.id },
      data: { reversedById: reversalTx.id },
    })

    return reversalTx
  })

  // Audit log entries for both transactions
  await logAuditEvent(userId, "transaction.reversal_created", reversal.id, {
    originalTransactionId: original.id,
    reason,
    amount: reversal.total,
  })

  await logAuditEvent(userId, "transaction.reversed", original.id, {
    reversalTransactionId: reversal.id,
    reason,
  })

  return reversal
}

/** Check if a transaction can be modified (i.e. it is not locked). */
export async function canModifyTransaction(
  userId: string,
  transactionId: string,
): Promise<boolean> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId, userId },
    select: { isLocked: true },
  })

  if (!transaction) {
    throw new Error("Transaction not found")
  }

  return !transaction.isLocked
}

/** Get the next booking number for the user. */
export async function getNextBookingNumber(userId: string): Promise<number> {
  const result = await prisma.transaction.findFirst({
    where: { userId },
    orderBy: { bookingNumber: "desc" },
    select: { bookingNumber: true },
  })

  return (result?.bookingNumber ?? 0) + 1
}
