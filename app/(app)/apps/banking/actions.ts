"use server"

import { getCurrentUser } from "@/lib/auth"
import { getBankAccounts, getBankAccountById, createBankAccount, updateBankAccount, updateBankingInfo, deleteBankAccount, getDecryptedPin } from "@/models/bank-accounts"
import { synchronizeBank, fetchStatements, continueSyncWithTan } from "@/lib/fints/client"
import { syncBankTransactions, findReconciliationCandidates, reconcileTransactions } from "@/lib/fints/sync"
import { findMatchingReceipts, linkReceiptToTransaction } from "@/lib/fints/receipt-matching"
import { generateDatevExport } from "@/lib/fints/datev-export"
import { generateInvoicePDF, type InvoiceData } from "@/lib/invoice-generator"
import { generateInflationReport, adjustForInflation, CPI_DATA, type InflationReport, type InflationReportItem } from "@/lib/inflation"
import { generateXRechnungXML, type XRechnungData } from "@/lib/fints/xrechnung-generator"
import { validateXRechnung, type ValidationResult } from "@/lib/fints/xrechnung-validator"
import { generateEUER, formatEUERAsCSV } from "@/lib/fints/euer-export"
import { generateSageBuchungsstapel } from "@/lib/sage/buchungsstapel-export"
import { generateDebitoren, generateKreditoren } from "@/lib/sage/stammdaten-export"
import { generateGDPdUExport, type GDPdUPackage } from "@/lib/sage/gdpdu-export"
import { generateUStSummary } from "@/lib/fints/ust-summary"
import { detectRecurringTransactions } from "@/lib/fints/recurring-detection"
import type { RecurringPattern } from "@/lib/fints/recurring-detection"
import {
  getRecurringInvoices,
  createRecurringInvoice,
  updateRecurringInvoice,
  deleteRecurringInvoice,
  generateDueTransactions,
} from "@/lib/recurring-invoices"
import type { RecurringInvoiceData } from "@/lib/recurring-invoices"
import { tryExtractEInvoice } from "@/lib/fints/zugferd-integration"
import { lookupFinTSInstitute } from "@/lib/fints/institute-lookup"
import { sendTelegramMessage, formatSyncReport } from "@/lib/fints/telegram"
import { matchRuleBasedCategory } from "@/lib/fints/categorize-rules"
import { categorizeBankTransaction } from "@/lib/fints/auto-categorize"
import type { FinTSConnectionConfig } from "@/lib/fints/client"
import { checkRateLimit } from "@/lib/rate-limit"
import { addBankAccountSchema, syncBankAccountSchema, submitTanSchema, datevExportSchema } from "@/forms/banking"
import { logAuditEvent, getAuditLogs } from "@/models/audit-log"
import { getCategories } from "@/models/categories"
import { getSettings, getLLMSettings } from "@/models/settings"
import { lockTransaction, lockTransactionsUntil, createReversalBooking } from "@/lib/gobd"
import { prisma } from "@/lib/db"
import config from "@/lib/config"
import { ERPNextClient as ERPNextClientIntegration } from "@/lib/integrations/erpnext-client"
import {
  syncCustomersFromERPNext,
  syncSuppliersFromERPNext,
  syncInvoicesFromERPNext,
  exportTransactionsToERPNext,
  syncPaymentEntries,
} from "@/lib/integrations/erpnext-sync"
import {
  generateSageBuchungsstapel as generateSageBuchungsstapelIntegration,
  generateSageDebitorenExport,
  generateSageKreditorenExport,
} from "@/lib/integrations/sage-export"
import { generateBWA, formatBWAAsCSV, formatBWAAsHTML } from "@/lib/bwa"
import { generateUStVAData, generateElsterXML } from "@/lib/elster-ustva"
import { getOpenItems, createOpenItem, markAsPaid, autoMatchPayments, getAgingReport, getDebitSaldenliste, getKreditorSaldenliste } from "@/lib/open-items"
import { getDunningCandidates, executeDunning, getDunningHistory } from "@/lib/dunning"
import { generateEBilanzData, generateXBRLDocument } from "@/lib/ebilanz"
import {
  generateDepreciationSchedule,
  generateAssetRegister,
  getUsefulLife,
  isGWG,
  type Asset,
  type DepreciationMethod,
} from "@/lib/asset-accounting"

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

export async function toggleAutoSyncAction(
  bankAccountId: string,
  isActive: boolean,
): Promise<ActionState> {
  const user = await getCurrentUser()
  const account = await getBankAccountById(bankAccountId, user.id)
  if (!account) {
    return { success: false, error: "Bankkonto nicht gefunden" }
  }
  await updateBankAccount(bankAccountId, user.id, { isActive })
  await logAuditEvent(user.id, "bank_account.toggle_auto_sync", bankAccountId, { isActive })
  return { success: true }
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

export async function getAuditLogsAction(): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  const logs = await getAuditLogs(user.id, 100)
  return {
    success: true,
    data: logs.map(l => ({
      id: l.id,
      action: l.action,
      target: l.target,
      details: l.details,
      createdAt: l.createdAt.toISOString(),
    })),
  }
}

export async function getUnreconciledTransactionsAction(): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      sourceType: "fints",
      isReconciled: false,
    },
    orderBy: { issuedAt: "desc" },
    take: 100,
    include: { category: true },
  })
  return {
    success: true,
    data: transactions.map(t => ({
      id: t.id,
      name: t.name,
      merchant: t.merchant,
      total: t.total,
      currencyCode: t.currencyCode,
      type: t.type,
      issuedAt: t.issuedAt?.toISOString() || null,
      categoryCode: t.categoryCode,
      categoryName: (t as any).category?.name || null,
    })),
  }
}

export async function lookupBankAction(
  blz: string,
): Promise<ActionState<{ bankName: string; fintsUrl: string; bic: string }>> {
  if (!blz || blz.length !== 8 || !/^\d{8}$/.test(blz)) {
    return { success: false, error: "BLZ muss genau 8 Ziffern haben." }
  }

  const result = lookupFinTSInstitute(blz)
  if (!result) {
    return { success: false, error: "Bank nicht gefunden." }
  }

  return { success: true, data: result }
}

export type DashboardStats = {
  currentMonth: { income: number; expenses: number; net: number; count: number }
  previousMonth: { income: number; expenses: number; net: number; count: number }
  yearToDate: { income: number; expenses: number; net: number; count: number }
  unreconciledCount: number
  lastSyncAt: string | null
}

export async function getDashboardStatsAction(): Promise<ActionState<DashboardStats>> {
  const user = await getCurrentUser()

  const now = new Date()
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const yearStart = new Date(now.getFullYear(), 0, 1)

  async function sumPeriod(from: Date, to: Date) {
    const transactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        issuedAt: { gte: from, lt: to },
      },
      select: { total: true, type: true },
    })
    let income = 0
    let expenses = 0
    for (const t of transactions) {
      if (t.type === "income") {
        income += t.total ?? 0
      } else if (t.type === "expense") {
        expenses += t.total ?? 0
      }
    }
    return { income, expenses, net: income - expenses, count: transactions.length }
  }

  const [currentMonth, previousMonth, yearToDate, unreconciledCount, lastSync] = await Promise.all([
    sumPeriod(currentMonthStart, now),
    sumPeriod(previousMonthStart, currentMonthStart),
    sumPeriod(yearStart, now),
    prisma.transaction.count({
      where: {
        userId: user.id,
        sourceType: "fints",
        isReconciled: false,
      },
    }),
    prisma.finTSBankAccount.findFirst({
      where: { userId: user.id, isActive: true },
      orderBy: { lastSyncAt: "desc" },
      select: { lastSyncAt: true },
    }),
  ])

  return {
    success: true,
    data: {
      currentMonth,
      previousMonth,
      yearToDate,
      unreconciledCount,
      lastSyncAt: lastSync?.lastSyncAt?.toISOString() ?? null,
    },
  }
}

export async function exportDatevAction(
  dateFrom?: string,
  dateTo?: string,
  chart?: string,
  consultantNumber?: string,
  clientNumber?: string,
): Promise<ActionState<string>> {
  const parsed = datevExportSchema.safeParse({ dateFrom, dateTo })
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]
    return { success: false, error: firstError.message }
  }

  const user = await getCurrentUser()
  const chartOfAccounts = chart === "SKR03" ? "SKR03" as const : "SKR04" as const
  const csv = await generateDatevExport(
    user.id,
    parsed.data.dateFrom ? new Date(parsed.data.dateFrom) : undefined,
    parsed.data.dateTo ? new Date(parsed.data.dateTo) : undefined,
    chartOfAccounts,
    consultantNumber,
    clientNumber,
  )
  return { success: true, data: csv }
}

export async function getUStSummaryAction(
  dateFrom: string,
  dateTo: string,
): Promise<ActionState<any>> {
  const user = await getCurrentUser()

  if (!dateFrom || !dateTo) {
    return { success: false, error: "Zeitraum (von/bis) ist erforderlich." }
  }

  const summary = await generateUStSummary(
    user.id,
    new Date(dateFrom),
    new Date(dateTo),
  )

  // Serialize dates for client transport
  return {
    success: true,
    data: {
      ...summary,
      period: {
        from: summary.period.from.toISOString(),
        to: summary.period.to.toISOString(),
      },
    },
  }
}

export async function autoCategorizeAction(
  transactionId: string,
): Promise<ActionState<{ categoryCode: string | null; source: "rule" | "llm" | null }>> {
  const user = await getCurrentUser()

  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId, userId: user.id },
  })

  if (!transaction) {
    return { success: false, error: "Transaktion nicht gefunden" }
  }

  const categories = await getCategories(user.id)
  if (categories.length === 0) {
    return { success: false, error: "Keine Kategorien vorhanden" }
  }

  const validCodes = new Set(categories.map((c) => c.code))

  // 1. Try rule-based matching first
  const ruleMatch = matchRuleBasedCategory(
    {
      name: transaction.name ?? "",
      merchant: transaction.merchant,
      description: transaction.description,
    },
    validCodes,
  )

  if (ruleMatch) {
    await prisma.transaction.update({
      where: { id: transactionId, userId: user.id },
      data: { categoryCode: ruleMatch },
    })
    return { success: true, data: { categoryCode: ruleMatch, source: "rule" } }
  }

  // 2. Fall back to LLM categorization
  const settings = await getSettings(user.id)
  const llmSettings = getLLMSettings(settings)

  const llmMatch = await categorizeBankTransaction(
    {
      name: transaction.name ?? "",
      merchant: transaction.merchant,
      description: transaction.description,
      total: transaction.total ?? 0,
      type: transaction.type ?? "expense",
    },
    categories.map((c) => ({ code: c.code, name: c.name, llm_prompt: c.llm_prompt })),
    llmSettings,
  )

  if (llmMatch) {
    await prisma.transaction.update({
      where: { id: transactionId, userId: user.id },
      data: { categoryCode: llmMatch },
    })
    return { success: true, data: { categoryCode: llmMatch, source: "llm" } }
  }

  return { success: true, data: { categoryCode: null, source: null } }
}

export async function autoCategorizeAllAction(): Promise<
  ActionState<{ total: number; categorized: number; ruleMatches: number; llmMatches: number; skipped: number }>
> {
  const user = await getCurrentUser()

  const categories = await getCategories(user.id)
  if (categories.length === 0) {
    return { success: false, error: "Keine Kategorien vorhanden" }
  }

  const validCodes = new Set(categories.map((c) => c.code))
  const categoryInputs = categories.map((c) => ({ code: c.code, name: c.name, llm_prompt: c.llm_prompt }))

  const settings = await getSettings(user.id)
  const llmSettings = getLLMSettings(settings)

  // Find all uncategorized FinTS transactions
  const uncategorized = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      sourceType: "fints",
      categoryCode: null,
    },
    orderBy: { issuedAt: "desc" },
  })

  let ruleMatches = 0
  let llmMatches = 0
  let skipped = 0

  for (const tx of uncategorized) {
    // 1. Try rule-based matching first
    const ruleMatch = matchRuleBasedCategory(
      {
        name: tx.name ?? "",
        merchant: tx.merchant,
        description: tx.description,
      },
      validCodes,
    )

    if (ruleMatch) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { categoryCode: ruleMatch },
      })
      ruleMatches++
      continue
    }

    // 2. Fall back to LLM
    const llmMatch = await categorizeBankTransaction(
      {
        name: tx.name ?? "",
        merchant: tx.merchant,
        description: tx.description,
        total: tx.total ?? 0,
        type: tx.type ?? "expense",
      },
      categoryInputs,
      llmSettings,
    )

    if (llmMatch) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { categoryCode: llmMatch },
      })
      llmMatches++
    } else {
      skipped++
    }
  }

  return {
    success: true,
    data: {
      total: uncategorized.length,
      categorized: ruleMatches + llmMatches,
      ruleMatches,
      llmMatches,
      skipped,
    },
  }
}

export async function findReceiptMatchesAction(
  transactionId: string,
): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  const candidates = await findMatchingReceipts(user.id, transactionId)
  // Enrich candidates with file info
  const enriched = await Promise.all(
    candidates.map(async (c) => {
      const file = await prisma.file.findFirst({
        where: { id: c.fileId, userId: user.id },
      })
      const parseResult = file?.cachedParseResult as Record<string, unknown> | null
      return {
        ...c,
        filename: file?.filename ?? null,
        merchant: parseResult?.merchant ?? null,
        total: parseResult?.total ?? null,
        issuedAt: parseResult?.issuedAt ?? null,
      }
    }),
  )
  return { success: true, data: enriched }
}

export async function linkReceiptAction(
  transactionId: string,
  fileId: string,
): Promise<ActionState> {
  const user = await getCurrentUser()
  try {
    await linkReceiptToTransaction(user.id, transactionId, fileId)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export type SerializedRecurringPattern = Omit<RecurringPattern, "lastOccurrence" | "nextExpected"> & {
  lastOccurrence: string
  nextExpected: string
}

export async function detectRecurringAction(): Promise<ActionState<SerializedRecurringPattern[]>> {
  const user = await getCurrentUser()

  try {
    const patterns = await detectRecurringTransactions(user.id)

    return {
      success: true,
      data: patterns.map(p => ({
        ...p,
        lastOccurrence: p.lastOccurrence.toISOString(),
        nextExpected: p.nextExpected.toISOString(),
      })),
    }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler bei der Erkennung wiederkehrender Transaktionen." }
  }
}

// --- GoBD compliance actions ---

export async function lockTransactionAction(
  transactionId: string,
): Promise<ActionState> {
  const user = await getCurrentUser()
  try {
    await lockTransaction(user.id, transactionId)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function lockTransactionsUntilAction(
  until: string,
): Promise<ActionState<{ count: number }>> {
  const user = await getCurrentUser()
  try {
    const date = new Date(until)
    if (isNaN(date.getTime())) {
      return { success: false, error: "Ungueltiges Datum." }
    }
    const count = await lockTransactionsUntil(user.id, date)
    return { success: true, data: { count } }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function createReversalAction(
  transactionId: string,
  reason: string,
): Promise<ActionState<any>> {
  const user = await getCurrentUser()
  try {
    if (!reason || reason.trim().length === 0) {
      return { success: false, error: "Ein Stornogrund ist erforderlich." }
    }
    const reversal = await createReversalBooking(user.id, transactionId, reason)
    return {
      success: true,
      data: {
        id: reversal.id,
        name: reversal.name,
        total: reversal.total,
        reversalOfId: reversal.reversalOfId,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function generateEUERAction(
  year: number,
): Promise<ActionState<{ euer: any; csv: string }>> {
  const user = await getCurrentUser()

  if (!year || year < 2000 || year > 2100) {
    return { success: false, error: "Bitte ein gueltiges Jahr angeben." }
  }

  try {
    const euerData = await generateEUER(user.id, year)
    const csv = formatEUERAsCSV(euerData)
    return { success: true, data: { euer: euerData, csv } }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// --- ZUGFeRD / XRechnung e-invoice extraction ---

export async function extractEInvoiceAction(
  fileId: string,
): Promise<ActionState<any>> {
  const user = await getCurrentUser()

  if (!fileId) {
    return { success: false, error: "Keine Datei-ID angegeben." }
  }

  const file = await prisma.file.findFirst({
    where: { id: fileId, userId: user.id },
  })

  if (!file) {
    return { success: false, error: "Datei nicht gefunden." }
  }

  try {
    const invoice = await tryExtractEInvoice(file.path)

    if (!invoice) {
      return { success: false, error: "Keine ZUGFeRD/XRechnung-Daten in dieser Datei gefunden." }
    }

    return { success: true, data: invoice }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Extrahieren der E-Rechnung." }
  }
}

export async function setupTelegramWebhookAction(): Promise<ActionState<{ webhookUrl: string }>> {
  await getCurrentUser()

  const baseURL = config.app.baseURL
  const secret = config.telegram.webhookSecret

  if (!config.telegram.botToken) {
    return { success: false, error: "TELEGRAM_BOT_TOKEN ist nicht konfiguriert." }
  }

  if (!secret) {
    return { success: false, error: "TELEGRAM_WEBHOOK_SECRET ist nicht konfiguriert." }
  }

  try {
    const res = await fetch(`${baseURL}/api/telegram/setup?secret=${encodeURIComponent(secret)}`)
    const data = await res.json()

    if (data.ok) {
      return { success: true, data: { webhookUrl: data.webhookUrl } }
    } else {
      return { success: false, error: data.error || "Webhook-Einrichtung fehlgeschlagen." }
    }
  } catch (error: any) {
    return { success: false, error: error.message || "Webhook-Einrichtung fehlgeschlagen." }
  }
}

export async function getTelegramStatusAction(): Promise<ActionState<{
  configured: boolean
  botToken: boolean
  chatId: boolean
  webhookSecret: boolean
  webhookUrl: string
}>> {
  await getCurrentUser()

  return {
    success: true,
    data: {
      configured: !!(config.telegram.botToken && config.telegram.chatId),
      botToken: !!config.telegram.botToken,
      chatId: !!config.telegram.chatId,
      webhookSecret: !!config.telegram.webhookSecret,
      webhookUrl: `${config.app.baseURL}/api/telegram/webhook`,
    },
  }
}

export async function generateInvoiceAction(
  data: InvoiceData,
): Promise<ActionState<string>> {
  await getCurrentUser()

  try {
    const buffer = await generateInvoicePDF(data)
    const base64 = buffer.toString("base64")
    return { success: true, data: base64 }
  } catch (error: any) {
    return { success: false, error: error.message ?? "PDF-Erstellung fehlgeschlagen." }
  }
}

export async function generateXRechnungAction(
  data: XRechnungData,
): Promise<ActionState<{ xml: string; validation: ValidationResult }>> {
  await getCurrentUser()

  try {
    const xml = generateXRechnungXML(data)
    const validation = validateXRechnung(xml)

    if (!validation.valid) {
      return {
        success: false,
        error: `XRechnung-Validierung fehlgeschlagen: ${validation.errors.join("; ")}`,
        data: { xml, validation },
      }
    }

    return { success: true, data: { xml, validation } }
  } catch (error: any) {
    return { success: false, error: error.message ?? "XRechnung-Erstellung fehlgeschlagen." }
  }
}

export async function validateXRechnungAction(
  xml: string,
): Promise<ActionState<ValidationResult>> {
  await getCurrentUser()

  if (!xml || typeof xml !== "string" || xml.trim().length === 0) {
    return { success: false, error: "Kein XML-Inhalt angegeben." }
  }

  try {
    const result = validateXRechnung(xml)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Validierung fehlgeschlagen." }
  }
}

// --- Recurring Invoice / Subscription management ---

export type SerializedRecurringInvoice = {
  id: string
  name: string
  merchant: string | null
  description: string | null
  amount: number
  currencyCode: string
  type: string
  categoryCode: string | null
  projectCode: string | null
  frequency: string
  startDate: string
  endDate: string | null
  nextDueDate: string
  lastGeneratedAt: string | null
  isActive: boolean
  autoGenerate: boolean
  notifyBeforeDays: number | null
  inflationAdjusted: boolean
  baseAmount: number | null
  baseYear: number | null
  createdAt: string
  updatedAt: string
}

function serializeRecurringInvoice(inv: any): SerializedRecurringInvoice {
  return {
    id: inv.id,
    name: inv.name,
    merchant: inv.merchant,
    description: inv.description,
    amount: inv.amount,
    currencyCode: inv.currencyCode,
    type: inv.type,
    categoryCode: inv.categoryCode,
    projectCode: inv.projectCode,
    frequency: inv.frequency,
    startDate: inv.startDate instanceof Date ? inv.startDate.toISOString() : inv.startDate,
    endDate: inv.endDate ? (inv.endDate instanceof Date ? inv.endDate.toISOString() : inv.endDate) : null,
    nextDueDate: inv.nextDueDate instanceof Date ? inv.nextDueDate.toISOString() : inv.nextDueDate,
    lastGeneratedAt: inv.lastGeneratedAt ? (inv.lastGeneratedAt instanceof Date ? inv.lastGeneratedAt.toISOString() : inv.lastGeneratedAt) : null,
    isActive: inv.isActive,
    autoGenerate: inv.autoGenerate,
    notifyBeforeDays: inv.notifyBeforeDays,
    inflationAdjusted: inv.inflationAdjusted,
    baseAmount: inv.baseAmount,
    baseYear: inv.baseYear,
    createdAt: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : inv.createdAt,
    updatedAt: inv.updatedAt instanceof Date ? inv.updatedAt.toISOString() : inv.updatedAt,
  }
}

export async function listRecurringInvoicesAction(): Promise<ActionState<SerializedRecurringInvoice[]>> {
  const user = await getCurrentUser()
  try {
    const invoices = await getRecurringInvoices(user.id)
    return { success: true, data: invoices.map(serializeRecurringInvoice) }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Laden der Dauerauftraege." }
  }
}

export async function createRecurringInvoiceAction(
  data: RecurringInvoiceData,
): Promise<ActionState<SerializedRecurringInvoice>> {
  const user = await getCurrentUser()
  try {
    const invoice = await createRecurringInvoice(user.id, data)
    await logAuditEvent(user.id, "recurring_invoice.create", invoice.id)
    return { success: true, data: serializeRecurringInvoice(invoice) }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Erstellen des Dauerauftrags." }
  }
}

export async function updateRecurringInvoiceAction(
  id: string,
  data: Partial<RecurringInvoiceData>,
): Promise<ActionState<SerializedRecurringInvoice>> {
  const user = await getCurrentUser()
  try {
    const invoice = await updateRecurringInvoice(id, user.id, data)
    await logAuditEvent(user.id, "recurring_invoice.update", invoice.id)
    return { success: true, data: serializeRecurringInvoice(invoice) }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Aktualisieren des Dauerauftrags." }
  }
}

export async function deleteRecurringInvoiceAction(
  id: string,
): Promise<ActionState> {
  const user = await getCurrentUser()
  try {
    await deleteRecurringInvoice(id, user.id)
    await logAuditEvent(user.id, "recurring_invoice.delete", id)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Loeschen des Dauerauftrags." }
  }
}

export async function generateDueTransactionsAction(): Promise<
  ActionState<{ generated: number; skipped: number }>
> {
  const user = await getCurrentUser()
  try {
    const result = await generateDueTransactions(user.id)
    await logAuditEvent(user.id, "recurring_invoice.generate", undefined, result)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Generieren faelliger Transaktionen." }
  }
}

// --- Inflation adjustment actions ---

type SerializedInflationReportItem = {
  name: string
  merchant: string | null
  baseAmount: number
  baseYear: number
  currentAmount: number
  inflationRate: number
  difference: number
  shouldAdjust: boolean
}

type SerializedInflationReport = {
  items: SerializedInflationReportItem[]
  totalBaseAmount: number
  totalCurrentAmount: number
  totalDifference: number
  averageInflation: number
  generatedAt: string
  thresholdPercent: number
}

export async function generateInflationReportAction(
  thresholdPercent?: number,
): Promise<ActionState<SerializedInflationReport>> {
  const user = await getCurrentUser()

  try {
    const report = await generateInflationReport(user.id, thresholdPercent)
    return {
      success: true,
      data: {
        ...report,
        generatedAt: report.generatedAt.toISOString(),
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler bei der Inflationsberechnung." }
  }
}

export async function applyInflationAdjustmentAction(
  recurringInvoiceId: string,
): Promise<ActionState> {
  const user = await getCurrentUser()

  try {
    // First try to find a recurring invoice by ID
    const invoices = await getRecurringInvoices(user.id)
    let invoice = invoices.find(i => i.id === recurringInvoiceId)

    // If not found by ID, try to match by name/merchant (from inflation report)
    if (!invoice) {
      invoice = invoices.find(
        i => i.name === recurringInvoiceId || i.merchant === recurringInvoiceId,
      )
    }

    if (!invoice) {
      return { success: false, error: "Wiederkehrender Posten nicht gefunden." }
    }

    const currentYear = new Date().getFullYear()
    const baseYear = invoice.baseYear ?? invoice.startDate.getFullYear()
    const baseAmount = invoice.baseAmount ?? invoice.amount

    // Clamp years to available CPI data
    const cpiYears = Object.keys(CPI_DATA).map(Number).sort((a, b) => a - b)
    const minYear = cpiYears[0]
    const maxYear = cpiYears[cpiYears.length - 1]
    const clampedBase = Math.max(minYear, Math.min(maxYear, baseYear))
    const clampedCurrent = Math.max(minYear, Math.min(maxYear, currentYear))

    if (clampedBase === clampedCurrent) {
      return { success: false, error: "Keine Inflationsanpassung möglich (gleiches Jahr)." }
    }

    const adjustedAmount = adjustForInflation(baseAmount, clampedBase, clampedCurrent)

    await updateRecurringInvoice(invoice.id, user.id, {
      amount: adjustedAmount,
      inflationAdjusted: true,
      baseAmount: baseAmount,
      baseYear: clampedBase,
    } as any)

    await logAuditEvent(user.id, "recurring_invoice.inflation_adjust", invoice.id, {
      baseAmount,
      baseYear: clampedBase,
      adjustedAmount,
      currentYear: clampedCurrent,
    })

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler bei der Inflationsanpassung." }
  }
}

// --- ERPNext Integration ---

import { fullSync, getERPNextConfig } from "@/lib/erpnext/sync"
import { ERPNextClient } from "@/lib/erpnext/client"

export async function syncToERPNextAction(): Promise<ActionState<any>> {
  try {
    const user = await getCurrentUser()

    const rateCheck = checkRateLimit(`${user.id}:erpnextSync`, 10, ONE_HOUR)
    if (!rateCheck.allowed) {
      const seconds = Math.ceil(rateCheck.retryAfterMs! / 1000)
      return { success: false, error: `Zu viele Anfragen. Bitte warte ${seconds} Sekunden.` }
    }

    const result = await fullSync(user.id, "to_erpnext")

    await logAuditEvent(user.id, "erpnext.sync_to", "to_erpnext", {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    })

    return { success: result.success, data: result }
  } catch (error: any) {
    return { success: false, error: error.message ?? "ERPNext-Synchronisation fehlgeschlagen." }
  }
}

export async function syncFromERPNextAction(): Promise<ActionState<any>> {
  try {
    const user = await getCurrentUser()

    const rateCheck = checkRateLimit(`${user.id}:erpnextSync`, 10, ONE_HOUR)
    if (!rateCheck.allowed) {
      const seconds = Math.ceil(rateCheck.retryAfterMs! / 1000)
      return { success: false, error: `Zu viele Anfragen. Bitte warte ${seconds} Sekunden.` }
    }

    const result = await fullSync(user.id, "from_erpnext")

    await logAuditEvent(user.id, "erpnext.sync_from", "from_erpnext", {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    })

    return { success: result.success, data: result }
  } catch (error: any) {
    return { success: false, error: error.message ?? "ERPNext-Import fehlgeschlagen." }
  }
}

export async function getERPNextStatusAction(): Promise<ActionState<{
  configured: boolean
  connected: boolean
  url: string | null
  hasApiKey: boolean
  hasApiSecret: boolean
}>> {
  try {
    const user = await getCurrentUser()
    const config = getERPNextConfig(user.id)

    if (!config) {
      return {
        success: true,
        data: {
          configured: false,
          connected: false,
          url: null,
          hasApiKey: !!process.env.ERPNEXT_API_KEY,
          hasApiSecret: !!process.env.ERPNEXT_API_SECRET,
        },
      }
    }

    const client = new ERPNextClient(config)
    const connected = await client.testConnection()

    return {
      success: true,
      data: {
        configured: true,
        connected,
        url: config.url,
        hasApiKey: true,
        hasApiSecret: true,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Statusabfrage fehlgeschlagen." }
  }
}

export async function testERPNextConnectionAction(): Promise<ActionState<{ connected: boolean; user?: string }>> {
  try {
    const user = await getCurrentUser()
    const config = getERPNextConfig(user.id)

    if (!config) {
      return { success: false, error: "ERPNext ist nicht konfiguriert. Bitte Umgebungsvariablen setzen." }
    }

    const client = new ERPNextClient(config)
    const connected = await client.testConnection()

    if (!connected) {
      return { success: false, error: "Verbindung zu ERPNext fehlgeschlagen. Bitte API-Schlüssel prüfen." }
    }

    return { success: true, data: { connected: true } }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Verbindungstest fehlgeschlagen." }
  }
}

// --- Sage Warenwirtschaft 7.1 Export ---

export async function exportSageBuchungsstapelAction(
  dateFrom?: string,
  dateTo?: string,
): Promise<ActionState<string>> {
  const user = await getCurrentUser()
  try {
    const csv = await generateSageBuchungsstapel(
      user.id,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
    )
    return { success: true, data: csv }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Sage Buchungsstapel-Export fehlgeschlagen." }
  }
}

export async function exportSageDebitorenAction(): Promise<ActionState<string>> {
  const user = await getCurrentUser()
  try {
    const csv = await generateDebitoren(user.id)
    return { success: true, data: csv }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Sage Debitoren-Export fehlgeschlagen." }
  }
}

export async function exportSageKreditorenAction(): Promise<ActionState<string>> {
  const user = await getCurrentUser()
  try {
    const csv = await generateKreditoren(user.id)
    return { success: true, data: csv }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Sage Kreditoren-Export fehlgeschlagen." }
  }
}

export async function exportGDPdUAction(
  dateFrom: string,
  dateTo: string,
): Promise<ActionState<GDPdUPackage>> {
  const user = await getCurrentUser()

  if (!dateFrom || !dateTo) {
    return { success: false, error: "Zeitraum (von/bis) ist erforderlich für den GDPdU-Export." }
  }

  try {
    const pkg = await generateGDPdUExport(
      user.id,
      new Date(dateFrom),
      new Date(dateTo),
    )
    return { success: true, data: pkg }
  } catch (error: any) {
    return { success: false, error: error.message ?? "GDPdU-Export fehlgeschlagen." }
  }
}

// --- ERPNext Integration (erweitert) ---

export async function connectERPNextAction(
  url: string,
  apiKey: string,
  apiSecret: string,
): Promise<ActionState<{ connected: boolean }>> {
  const user = await getCurrentUser()

  if (!url || !apiKey || !apiSecret) {
    return { success: false, error: "URL, API-Key und API-Secret sind erforderlich." }
  }

  try {
    const client = new ERPNextClientIntegration({ url, apiKey, apiSecret })
    const connected = await client.testConnection()

    if (!connected) {
      return { success: false, error: "Verbindung zu ERPNext fehlgeschlagen. Bitte Zugangsdaten prüfen." }
    }

    // ERPNext-Konfiguration in CompanyProfile speichern
    await prisma.companyProfile.upsert({
      where: { userId: user.id },
      update: {
        erpnextUrl: url,
        erpnextApiKey: apiKey,
        erpnextApiSecret: apiSecret,
      },
      create: {
        userId: user.id,
        erpnextUrl: url,
        erpnextApiKey: apiKey,
        erpnextApiSecret: apiSecret,
      },
    })

    await logAuditEvent(user.id, "erpnext.connect", url)
    return { success: true, data: { connected: true } }
  } catch (error: any) {
    return { success: false, error: error.message ?? "ERPNext-Verbindung fehlgeschlagen." }
  }
}

export async function syncFromERPNextIntegrationAction(): Promise<ActionState<any>> {
  const user = await getCurrentUser()

  const rateCheck = checkRateLimit(`${user.id}:erpnextSyncInt`, 10, ONE_HOUR)
  if (!rateCheck.allowed) {
    const seconds = Math.ceil(rateCheck.retryAfterMs! / 1000)
    return { success: false, error: `Zu viele Anfragen. Bitte warte ${seconds} Sekunden.` }
  }

  try {
    const profile = await prisma.companyProfile.findUnique({ where: { userId: user.id } })
    if (!profile?.erpnextUrl || !profile?.erpnextApiKey || !profile?.erpnextApiSecret) {
      return { success: false, error: "ERPNext ist nicht konfiguriert." }
    }

    const client = new ERPNextClientIntegration({
      url: profile.erpnextUrl,
      apiKey: profile.erpnextApiKey,
      apiSecret: profile.erpnextApiSecret,
    })

    const [customers, suppliers, invoices, payments] = await Promise.all([
      syncCustomersFromERPNext(user.id, client),
      syncSuppliersFromERPNext(user.id, client),
      syncInvoicesFromERPNext(user.id, client),
      syncPaymentEntries(user.id, client),
    ])

    const combined = {
      created: customers.created + suppliers.created + invoices.created + payments.created,
      updated: customers.updated + suppliers.updated + invoices.updated + payments.updated,
      skipped: customers.skipped + suppliers.skipped + invoices.skipped + payments.skipped,
      errors: [...customers.errors, ...suppliers.errors, ...invoices.errors, ...payments.errors],
    }

    await logAuditEvent(user.id, "erpnext.sync_from_integration", undefined, combined)
    return { success: true, data: combined }
  } catch (error: any) {
    return { success: false, error: error.message ?? "ERPNext-Import fehlgeschlagen." }
  }
}

export async function exportToERPNextAction(
  transactionIds: string[],
): Promise<ActionState<any>> {
  const user = await getCurrentUser()

  if (!transactionIds || transactionIds.length === 0) {
    return { success: false, error: "Keine Transaktionen zum Exportieren ausgewählt." }
  }

  try {
    const profile = await prisma.companyProfile.findUnique({ where: { userId: user.id } })
    if (!profile?.erpnextUrl || !profile?.erpnextApiKey || !profile?.erpnextApiSecret) {
      return { success: false, error: "ERPNext ist nicht konfiguriert." }
    }

    const client = new ERPNextClientIntegration({
      url: profile.erpnextUrl,
      apiKey: profile.erpnextApiKey,
      apiSecret: profile.erpnextApiSecret,
    })

    const result = await exportTransactionsToERPNext(user.id, client, transactionIds)
    await logAuditEvent(user.id, "erpnext.export", undefined, result)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message ?? "ERPNext-Export fehlgeschlagen." }
  }
}

// --- Sage Warenwirtschaft 7.1 Export (Integration) ---

export async function exportSageBuchungsstapelIntegrationAction(
  dateFrom?: string,
  dateTo?: string,
): Promise<ActionState<string>> {
  const user = await getCurrentUser()
  try {
    const csv = await generateSageBuchungsstapelIntegration(
      user.id,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
    )
    return { success: true, data: csv }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Sage Buchungsstapel-Export fehlgeschlagen." }
  }
}

export async function exportSageDebitorenIntegrationAction(): Promise<ActionState<string>> {
  const user = await getCurrentUser()
  try {
    const csv = await generateSageDebitorenExport(user.id)
    return { success: true, data: csv }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Sage Debitoren-Export fehlgeschlagen." }
  }
}

export async function exportSageKreditorenIntegrationAction(): Promise<ActionState<string>> {
  const user = await getCurrentUser()
  try {
    const csv = await generateSageKreditorenExport(user.id)
    return { success: true, data: csv }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Sage Kreditoren-Export fehlgeschlagen." }
  }
}

// --- BWA (Betriebswirtschaftliche Auswertung) ---

export async function generateBWAAction(
  year: number,
  month: number,
): Promise<ActionState<{ report: any; csv: string; html: string }>> {
  const user = await getCurrentUser()

  if (!year || year < 2000 || year > 2100) {
    return { success: false, error: "Bitte ein gültiges Jahr angeben." }
  }
  if (!month || month < 1 || month > 12) {
    return { success: false, error: "Bitte einen gültigen Monat angeben (1-12)." }
  }

  try {
    const report = await generateBWA(user.id, year, month)
    const csv = formatBWAAsCSV(report)
    const html = formatBWAAsHTML(report)
    return { success: true, data: { report, csv, html } }
  } catch (error: any) {
    return { success: false, error: error.message ?? "BWA-Erstellung fehlgeschlagen." }
  }
}

// --- UStVA (Elster XML) ---

export async function generateUStVAAction(
  year: number,
  period: number,
  isQuarterly?: boolean,
): Promise<ActionState<any>> {
  const user = await getCurrentUser()

  if (!year || year < 2000 || year > 2100) {
    return { success: false, error: "Bitte ein gültiges Jahr angeben." }
  }

  try {
    const data = await generateUStVAData(user.id, year, period, isQuarterly)
    return { success: true, data }
  } catch (error: any) {
    return { success: false, error: error.message ?? "UStVA-Berechnung fehlgeschlagen." }
  }
}

export async function exportElsterXMLAction(
  year: number,
  period: number,
  isQuarterly?: boolean,
): Promise<ActionState<string>> {
  const user = await getCurrentUser()

  if (!year || year < 2000 || year > 2100) {
    return { success: false, error: "Bitte ein gültiges Jahr angeben." }
  }

  try {
    const data = await generateUStVAData(user.id, year, period, isQuarterly)

    // Firmendaten aus CompanyProfile laden
    const profile = await prisma.companyProfile.findUnique({ where: { userId: user.id } })
    const taxNumber = profile?.taxNumber ?? ""
    const companyName = profile?.companyName ?? user.name ?? "Unbekannt"

    if (!taxNumber) {
      return { success: false, error: "Bitte zuerst die Steuernummer im Firmenprofil hinterlegen." }
    }

    const zeitraum = isQuarterly
      ? String(40 + period) // 41-44 für Quartale
      : String(period).padStart(2, "0") // 01-12 für Monate

    const xml = generateElsterXML(data, taxNumber, companyName, { year, zeitraum })
    await logAuditEvent(user.id, "ustva.export_elster", undefined, { year, period, isQuarterly })
    return { success: true, data: xml }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Elster-XML-Export fehlgeschlagen." }
  }
}

// --- Anlagenbuchhaltung (Fixed Assets) ---

export async function listAssetsAction(): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  try {
    const assets = await prisma.fixedAsset.findMany({
      where: { userId: user.id },
      orderBy: [{ category: "asc" }, { acquisitionDate: "asc" }],
    })
    return {
      success: true,
      data: assets.map(a => ({
        ...a,
        acquisitionDate: a.acquisitionDate.toISOString(),
        disposalDate: a.disposalDate?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
    }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Laden der Anlagen." }
  }
}

export async function createAssetAction(data: {
  name: string
  description?: string
  inventoryNumber?: string
  category: string
  acquisitionDate: string
  acquisitionCost: number
  residualValue?: number
  usefulLifeYears?: number
  depreciationMethod?: string
}): Promise<ActionState<any>> {
  const user = await getCurrentUser()

  if (!data.name || !data.category || !data.acquisitionDate || !data.acquisitionCost) {
    return { success: false, error: "Name, Kategorie, Anschaffungsdatum und -kosten sind erforderlich." }
  }

  try {
    // Nutzungsdauer aus AfA-Tabelle ermitteln wenn nicht angegeben
    const usefulLife = data.usefulLifeYears ?? getUsefulLife(data.category) ?? 5
    const cost = data.acquisitionCost

    // Automatisch GWG-Methode wählen
    let method = data.depreciationMethod ?? "linear"
    if (isGWG(cost) && method === "linear") {
      method = "gwg"
    }

    const asset = await prisma.fixedAsset.create({
      data: {
        userId: user.id,
        name: data.name,
        description: data.description,
        inventoryNumber: data.inventoryNumber,
        category: data.category,
        acquisitionDate: new Date(data.acquisitionDate),
        acquisitionCost: cost,
        residualValue: data.residualValue ?? 0,
        usefulLifeYears: usefulLife,
        depreciationMethod: method,
      },
    })

    await logAuditEvent(user.id, "asset.create", asset.id, { name: asset.name, cost })
    return {
      success: true,
      data: {
        ...asset,
        acquisitionDate: asset.acquisitionDate.toISOString(),
        disposalDate: null,
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Anlegen der Anlage." }
  }
}

export async function updateAssetAction(
  id: string,
  data: {
    name?: string
    description?: string
    inventoryNumber?: string
    category?: string
    isActive?: boolean
    disposalDate?: string
    disposalProceeds?: number
    depreciationMethod?: string
    usefulLifeYears?: number
  },
): Promise<ActionState<any>> {
  const user = await getCurrentUser()

  try {
    const existing = await prisma.fixedAsset.findFirst({
      where: { id, userId: user.id },
    })

    if (!existing) {
      return { success: false, error: "Anlage nicht gefunden." }
    }

    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.description !== undefined) updateData.description = data.description
    if (data.inventoryNumber !== undefined) updateData.inventoryNumber = data.inventoryNumber
    if (data.category !== undefined) updateData.category = data.category
    if (data.isActive !== undefined) updateData.isActive = data.isActive
    if (data.disposalDate !== undefined) updateData.disposalDate = new Date(data.disposalDate)
    if (data.disposalProceeds !== undefined) updateData.disposalProceeds = data.disposalProceeds
    if (data.depreciationMethod !== undefined) updateData.depreciationMethod = data.depreciationMethod
    if (data.usefulLifeYears !== undefined) updateData.usefulLifeYears = data.usefulLifeYears

    const asset = await prisma.fixedAsset.update({
      where: { id },
      data: updateData,
    })

    await logAuditEvent(user.id, "asset.update", asset.id)
    return {
      success: true,
      data: {
        ...asset,
        acquisitionDate: asset.acquisitionDate.toISOString(),
        disposalDate: asset.disposalDate?.toISOString() ?? null,
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Aktualisieren der Anlage." }
  }
}

export async function deleteAssetAction(id: string): Promise<ActionState> {
  const user = await getCurrentUser()

  try {
    const existing = await prisma.fixedAsset.findFirst({
      where: { id, userId: user.id },
    })

    if (!existing) {
      return { success: false, error: "Anlage nicht gefunden." }
    }

    await prisma.fixedAsset.delete({ where: { id } })
    await logAuditEvent(user.id, "asset.delete", id, { name: existing.name })
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Löschen der Anlage." }
  }
}

export async function getDepreciationScheduleAction(
  assetId: string,
): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()

  try {
    const dbAsset = await prisma.fixedAsset.findFirst({
      where: { id: assetId, userId: user.id },
    })

    if (!dbAsset) {
      return { success: false, error: "Anlage nicht gefunden." }
    }

    const asset: Asset = {
      id: dbAsset.id,
      name: dbAsset.name,
      acquisitionDate: dbAsset.acquisitionDate,
      acquisitionCost: dbAsset.acquisitionCost,
      usefulLifeYears: dbAsset.usefulLifeYears,
      depreciationMethod: dbAsset.depreciationMethod as DepreciationMethod,
      residualValue: dbAsset.residualValue,
      category: dbAsset.category,
      inventoryNumber: dbAsset.inventoryNumber ?? undefined,
    }

    const schedule = generateDepreciationSchedule(asset)
    return { success: true, data: schedule }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Berechnen des AfA-Plans." }
  }
}

export async function getAssetRegisterAction(): Promise<ActionState<any>> {
  const user = await getCurrentUser()

  try {
    const register = await generateAssetRegister(user.id)
    return { success: true, data: register }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Erstellen des Anlagenspiegels." }
  }
}

// ─── Open Items (Offene Posten) Actions ──────────────────────────────

export async function getOpenItemsAction(
  type?: "debitor" | "kreditor",
  status?: string,
): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  try {
    const items = await getOpenItems(user.id, type, status)
    return { success: true, data: items }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Laden der offenen Posten." }
  }
}

export async function createOpenItemAction(data: {
  type: "debitor" | "kreditor"
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  merchant: string
  amount: number
  isB2B?: boolean
  notes?: string
}): Promise<ActionState<any>> {
  const user = await getCurrentUser()
  try {
    const item = await createOpenItem(user.id, {
      ...data,
      invoiceDate: new Date(data.invoiceDate),
      dueDate: new Date(data.dueDate),
    })
    return { success: true, data: item }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Erstellen des offenen Postens." }
  }
}

export async function markAsPaidAction(
  itemId: string,
  amount?: number,
): Promise<ActionState<any>> {
  const user = await getCurrentUser()
  try {
    const item = await markAsPaid(itemId, user.id, amount)
    return { success: true, data: item }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Erfassen der Zahlung." }
  }
}

export async function autoMatchPaymentsAction(): Promise<ActionState<{ matched: number; unmatched: number }>> {
  const user = await getCurrentUser()
  try {
    const result = await autoMatchPayments(user.id)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Auto-Abgleich." }
  }
}

export async function getAgingReportAction(): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  try {
    const report = await getAgingReport(user.id)
    return { success: true, data: report }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler bei der Fälligkeitsanalyse." }
  }
}

export async function getDebitSaldenlisteAction(): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  try {
    const data = await getDebitSaldenliste(user.id)
    return { success: true, data }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler bei der Debitorensaldenliste." }
  }
}

export async function getKreditorSaldenlisteAction(): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  try {
    const data = await getKreditorSaldenliste(user.id)
    return { success: true, data }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler bei der Kreditorensaldenliste." }
  }
}

// ─── Dunning (Mahnwesen) Actions ─────────────────────────────────────

export async function getDunningCandidatesAction(): Promise<ActionState<any[]>> {
  const user = await getCurrentUser()
  try {
    const candidates = await getDunningCandidates(user.id)
    return { success: true, data: candidates }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Laden der Mahnkandidaten." }
  }
}

export async function executeDunningAction(openItemId: string): Promise<ActionState<any>> {
  const user = await getCurrentUser()
  try {
    const entry = await executeDunning(openItemId, user.id)
    return { success: true, data: entry }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler bei der Mahnung." }
  }
}

export async function getDunningHistoryAction(openItemId: string): Promise<ActionState<any[]>> {
  try {
    const history = await getDunningHistory(openItemId)
    return { success: true, data: history }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler beim Laden der Mahnhistorie." }
  }
}

// ─── E-Bilanz Actions ────────────────────────────────────────────────

export async function generateEBilanzAction(year: number): Promise<ActionState<any>> {
  const user = await getCurrentUser()
  try {
    const report = await generateEBilanzData(user.id, year)
    return {
      success: true,
      data: {
        companyName: report.companyName,
        taxNumber: report.taxNumber,
        fiscalYearFrom: report.fiscalYearFrom.toISOString(),
        fiscalYearTo: report.fiscalYearTo.toISOString(),
        balanceSheet: report.balanceSheet,
        incomeStatement: report.incomeStatement,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message ?? "Fehler bei der E-Bilanz-Generierung." }
  }
}

export async function exportEBilanzXBRLAction(year: number): Promise<ActionState<string>> {
  const user = await getCurrentUser()
  try {
    const report = await generateEBilanzData(user.id, year)
    const xbrl = generateXBRLDocument(report)
    return { success: true, data: xbrl }
  } catch (error: any) {
    return { success: false, error: error.message ?? "XBRL-Export fehlgeschlagen." }
  }
}
