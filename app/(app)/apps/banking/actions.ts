"use server"

import { getCurrentUser } from "@/lib/auth"
import { getBankAccounts, getBankAccountById, createBankAccount, updateBankAccount, updateBankingInfo, deleteBankAccount } from "@/models/bank-accounts"
import { synchronizeBank, fetchStatements, continueSyncWithTan } from "@/lib/fints/client"
import { syncBankTransactions, findReconciliationCandidates, reconcileTransactions } from "@/lib/fints/sync"
import { generateDatevExport } from "@/lib/fints/datev-export"
import { sendTelegramMessage, formatSyncReport } from "@/lib/fints/telegram"
import type { FinTSConnectionConfig } from "@/lib/fints/client"

type ActionState<T = null> = {
  success: boolean
  error?: string
  data?: T
}

function buildFinTSConfig(account: {
  bankCode: string
  fintsUrl: string
  fintsUser: string
  fintsPin: string
  bankingInfo?: any
  tanMethodId?: number | null
  tanMediaName?: string | null
}): FinTSConnectionConfig {
  return {
    bankCode: account.bankCode,
    fintsUrl: account.fintsUrl,
    userId: account.fintsUser,
    pin: account.fintsPin,
    bankingInfo: account.bankingInfo as object | null,
    tanMethodId: account.tanMethodId,
    tanMediaName: account.tanMediaName,
  }
}

export async function listBankAccountsAction(): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  const accounts = await getBankAccounts(user.id)
  // Strip sensitive data before sending to client
  return {
    success: true,
    data: accounts.map(a => ({
      id: a.id,
      bankCode: a.bankCode,
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      iban: a.iban,
      bic: a.bic,
      fintsUrl: a.fintsUrl,
      lastSyncAt: a.lastSyncAt,
      lastSyncStatus: a.lastSyncStatus,
      isActive: a.isActive,
    })),
  }
}

export async function addBankAccountAction(
  _prevState: ActionState | null,
  formData: FormData,
): Promise<ActionState<any>> {
  const user = await getCurrentUser()

  const bankCode = formData.get("bankCode") as string
  const fintsUrl = formData.get("fintsUrl") as string
  const fintsUser = formData.get("fintsUser") as string
  const fintsPin = formData.get("fintsPin") as string
  const accountNumber = formData.get("accountNumber") as string || "pending"
  const iban = formData.get("iban") as string || undefined
  const bankName = formData.get("bankName") as string || undefined

  if (!bankCode || !fintsUrl || !fintsUser || !fintsPin) {
    return { success: false, error: "Alle Pflichtfelder ausfüllen (BLZ, FinTS URL, Benutzer, PIN)" }
  }

  // Test connection first
  const syncResult = await synchronizeBank({
    bankCode,
    fintsUrl,
    userId: fintsUser,
    pin: fintsPin,
  })

  if (!syncResult.success && !syncResult.requiresTan) {
    return { success: false, error: `Verbindung fehlgeschlagen: ${syncResult.error}` }
  }

  const account = await createBankAccount(user.id, {
    bankCode,
    bankName,
    accountNumber: syncResult.accounts?.[0]?.accountNumber || accountNumber,
    iban: syncResult.accounts?.[0]?.iban || iban,
    bic: syncResult.accounts?.[0]?.bic,
    fintsUrl,
    fintsUser,
    fintsPin,
    tanMethodId: syncResult.tanMethods?.[0]?.id,
  })

  if (syncResult.bankingInfo) {
    await updateBankingInfo(account.id, syncResult.bankingInfo)
  }

  return {
    success: true,
    data: {
      id: account.id,
      requiresTan: syncResult.requiresTan,
      tanChallenge: syncResult.tanChallenge,
      tanReference: syncResult.tanReference,
      tanMethods: syncResult.tanMethods,
      accounts: syncResult.accounts,
    },
  }
}

export async function syncBankAccountAction(
  bankAccountId: string,
  daysBack: number = 30,
): Promise<ActionState<any>> {
  const user = await getCurrentUser()
  const account = await getBankAccountById(bankAccountId, user.id)

  if (!account) {
    return { success: false, error: "Bankkonto nicht gefunden" }
  }

  const cfg = buildFinTSConfig(account)
  const from = new Date()
  from.setDate(from.getDate() - daysBack)

  const result = await fetchStatements(cfg, account.accountNumber, from)

  if (!result.success) {
    return { success: false, error: result.error }
  }

  if (result.requiresTan) {
    return {
      success: true,
      data: {
        requiresTan: true,
        tanChallenge: result.tanChallenge,
        tanReference: result.tanReference,
      },
    }
  }

  if (!result.transactions?.length) {
    return { success: true, data: { imported: 0, skipped: 0, errors: [] } }
  }

  const stats = await syncBankTransactions(user.id, account.id, result.transactions)

  // Send Telegram notification if configured
  await sendTelegramMessage(formatSyncReport({
    bankName: account.bankName || undefined,
    accountNumber: account.accountNumber,
    ...stats,
  }))

  return { success: true, data: stats }
}

export async function submitTanAction(
  bankAccountId: string,
  tanReference: string,
  tan: string,
): Promise<ActionState<any>> {
  const user = await getCurrentUser()
  const account = await getBankAccountById(bankAccountId, user.id)

  if (!account) {
    return { success: false, error: "Bankkonto nicht gefunden" }
  }

  const cfg = buildFinTSConfig(account)
  const result = await continueSyncWithTan(cfg, tanReference, tan || undefined)

  if (!result.success) {
    return { success: false, error: result.error }
  }

  if (result.bankingInfo) {
    await updateBankingInfo(account.id, result.bankingInfo)
  }

  return {
    success: true,
    data: {
      requiresTan: result.requiresTan,
      tanChallenge: result.tanChallenge,
      tanReference: result.tanReference,
      accounts: result.accounts,
      tanMethods: result.tanMethods,
    },
  }
}

export async function deleteBankAccountAction(bankAccountId: string): Promise<ActionState> {
  const user = await getCurrentUser()
  await deleteBankAccount(bankAccountId, user.id)
  return { success: true }
}

export async function getReconciliationCandidatesAction(
  transactionId: string,
): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  const candidates = await findReconciliationCandidates(user.id, transactionId)
  return { success: true, data: candidates }
}

export async function reconcileAction(
  bankTransactionId: string,
  manualTransactionId: string,
): Promise<ActionState> {
  const user = await getCurrentUser()
  await reconcileTransactions(user.id, bankTransactionId, manualTransactionId)
  return { success: true }
}

export async function exportDatevAction(
  dateFrom?: string,
  dateTo?: string,
): Promise<ActionState<string>> {
  const user = await getCurrentUser()
  const csv = await generateDatevExport(
    user.id,
    dateFrom ? new Date(dateFrom) : undefined,
    dateTo ? new Date(dateTo) : undefined,
  )
  return { success: true, data: csv }
}
