"use server"

import { getCurrentUser } from "@/lib/auth"
import { getBankAccounts, getBankAccountById, createBankAccount, updateBankAccount, updateBankingInfo, deleteBankAccount, getDecryptedPin } from "@/models/bank-accounts"
import { synchronizeBank, fetchStatements, continueSyncWithTan } from "@/lib/fints/client"
import { syncBankTransactions, findReconciliationCandidates, reconcileTransactions } from "@/lib/fints/sync"
import { generateDatevExport } from "@/lib/fints/datev-export"
import { sendTelegramMessage, formatSyncReport } from "@/lib/fints/telegram"
import type { FinTSConnectionConfig } from "@/lib/fints/client"
import { checkRateLimit } from "@/lib/rate-limit"
import { addBankAccountSchema, syncBankAccountSchema, submitTanSchema, datevExportSchema } from "@/forms/banking"
import { logAuditEvent } from "@/models/audit-log"

const ONE_HOUR = 60 * 60 * 1000
const FIFTEEN_MINUTES = 15 * 60 * 1000

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
    pin: getDecryptedPin(account as any),
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

  const rateCheck = checkRateLimit(`${user.id}:addBankAccount`, 5, ONE_HOUR)
  if (!rateCheck.allowed) {
    const seconds = Math.ceil(rateCheck.retryAfterMs! / 1000)
    return { success: false, error: `Zu viele Anfragen. Bitte warte ${seconds} Sekunden.` }
  }

  const parsed = addBankAccountSchema.safeParse({
    bankCode: formData.get("bankCode"),
    fintsUrl: formData.get("fintsUrl"),
    fintsUser: formData.get("fintsUser"),
    fintsPin: formData.get("fintsPin"),
    accountNumber: formData.get("accountNumber") || undefined,
    iban: formData.get("iban") || "",
    bankName: formData.get("bankName") || undefined,
  })

  if (!parsed.success) {
    const firstError = parsed.error.errors[0]
    return { success: false, error: firstError.message }
  }

  const { bankCode, fintsUrl, fintsUser, fintsPin, accountNumber, iban, bankName } = parsed.data

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
    accountNumber: syncResult.accounts?.[0]?.accountNumber || accountNumber || "pending",
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

  await logAuditEvent(user.id, "bank_account.create", account.iban ?? account.accountNumber)

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
  const parsed = syncBankAccountSchema.safeParse({ bankAccountId, daysBack })
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]
    return { success: false, error: firstError.message }
  }

  const user = await getCurrentUser()

  const rateCheck = checkRateLimit(`${user.id}:syncBankAccount`, 20, ONE_HOUR)
  if (!rateCheck.allowed) {
    const seconds = Math.ceil(rateCheck.retryAfterMs! / 1000)
    return { success: false, error: `Zu viele Anfragen. Bitte warte ${seconds} Sekunden.` }
  }

  const account = await getBankAccountById(parsed.data.bankAccountId, user.id)

  if (!account) {
    return { success: false, error: "Bankkonto nicht gefunden" }
  }

  const cfg = buildFinTSConfig(account)
  const from = new Date()
  from.setDate(from.getDate() - parsed.data.daysBack)

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

  await logAuditEvent(user.id, "bank_account.sync", account.id, stats)

  return { success: true, data: stats }
}

export async function submitTanAction(
  bankAccountId: string,
  tanReference: string,
  tan: string,
): Promise<ActionState<any>> {
  const parsed = submitTanSchema.safeParse({ bankAccountId, tanReference, tan })
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]
    return { success: false, error: firstError.message }
  }

  const user = await getCurrentUser()

  const rateCheck = checkRateLimit(`${user.id}:submitTan`, 10, FIFTEEN_MINUTES)
  if (!rateCheck.allowed) {
    const seconds = Math.ceil(rateCheck.retryAfterMs! / 1000)
    return { success: false, error: `Zu viele Anfragen. Bitte warte ${seconds} Sekunden.` }
  }

  const account = await getBankAccountById(parsed.data.bankAccountId, user.id)

  if (!account) {
    return { success: false, error: "Bankkonto nicht gefunden" }
  }

  const cfg = buildFinTSConfig(account)
  const result = await continueSyncWithTan(cfg, parsed.data.tanReference, parsed.data.tan || undefined)

  if (!result.success) {
    return { success: false, error: result.error }
  }

  if (result.bankingInfo) {
    await updateBankingInfo(account.id, result.bankingInfo)
  }

  await logAuditEvent(user.id, "bank_account.tan_submit", account.id)

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
  await logAuditEvent(user.id, "bank_account.delete", bankAccountId)
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
  const parsed = datevExportSchema.safeParse({ dateFrom, dateTo })
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]
    return { success: false, error: firstError.message }
  }

  const user = await getCurrentUser()
  const csv = await generateDatevExport(
    user.id,
    parsed.data.dateFrom ? new Date(parsed.data.dateFrom) : undefined,
    parsed.data.dateTo ? new Date(parsed.data.dateTo) : undefined,
  )
  return { success: true, data: csv }
}
