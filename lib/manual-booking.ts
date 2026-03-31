import { prisma } from "@/lib/db"
import { logAuditEvent } from "@/models/audit-log"
import { Decimal } from "@/prisma/client/runtime/library"

export const SKR04_COMMON_ACCOUNTS = [
  { code: '1800', name: 'Bank', type: 'asset' },
  { code: '1000', name: 'Kasse', type: 'asset' },
  { code: '1200', name: 'Forderungen aus LuL', type: 'asset' },
  { code: '3300', name: 'Verbindlichkeiten aus LuL', type: 'liability' },
  { code: '4400', name: 'Erlöse 19% USt', type: 'income' },
  { code: '4300', name: 'Erlöse 7% USt', type: 'income' },
  { code: '5400', name: 'Sonstige betriebliche Erträge', type: 'income' },
  { code: '5000', name: 'Aufwendungen für Waren', type: 'expense' },
  { code: '6000', name: 'Löhne und Gehälter', type: 'expense' },
  { code: '6100', name: 'Soziale Abgaben', type: 'expense' },
  { code: '6300', name: 'Miete', type: 'expense' },
  { code: '6310', name: 'Nebenkosten', type: 'expense' },
  { code: '6400', name: 'Versicherungen', type: 'expense' },
  { code: '6500', name: 'Kfz-Kosten', type: 'expense' },
  { code: '6600', name: 'Werbekosten', type: 'expense' },
  { code: '6640', name: 'Reisekosten', type: 'expense' },
  { code: '6800', name: 'Porto', type: 'expense' },
  { code: '6815', name: 'Bürobedarf', type: 'expense' },
  { code: '6820', name: 'Telekommunikation', type: 'expense' },
  { code: '6830', name: 'Rechts-/Beratungskosten', type: 'expense' },
  { code: '6850', name: 'Buchführungskosten', type: 'expense' },
  { code: '7010', name: 'AfA Sachanlagen', type: 'expense' },
  { code: '7685', name: 'Zinsaufwendungen', type: 'expense' },
  { code: '1576', name: 'Vorsteuer 19%', type: 'asset' },
  { code: '1571', name: 'Vorsteuer 7%', type: 'asset' },
  { code: '3806', name: 'USt 19%', type: 'liability' },
  { code: '3801', name: 'USt 7%', type: 'liability' },
] as const

const VALID_ACCOUNT_CODES: Set<string> = new Set(SKR04_COMMON_ACCOUNTS.map(a => a.code))

export function isValidSKR04Account(code: string): boolean {
  // Accept any 4-digit numeric code; highlight common ones
  return /^\d{4}$/.test(code)
}

export function isCommonSKR04Account(code: string): boolean {
  return VALID_ACCOUNT_CODES.has(code)
}

/**
 * Auto-calculate tax amount from gross amount and tax rate.
 * Amount is gross (inclusive of tax). Formula: taxAmount = amount - (amount / (1 + rate/100))
 */
export function calculateTaxAmount(amountCents: number, taxRatePercent: number): number {
  if (taxRatePercent <= 0) return 0
  const net = amountCents / (1 + taxRatePercent / 100)
  return Math.round(amountCents - net)
}

// ─── Session CRUD ───────────────────────────────────────────────

export type CreateSessionData = {
  name: string
  description?: string
  periodMonth: number
  periodYear: number
}

export async function getBookingSessions(
  userId: string,
  year?: number,
  month?: number,
) {
  const where: any = { userId }
  if (year) where.periodYear = year
  if (month) where.periodMonth = month

  return prisma.bookingSession.findMany({
    where,
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }],
    include: {
      _count: { select: { entries: true } },
      entries: { select: { amount: true } },
    },
  })
}

export async function createBookingSession(userId: string, data: CreateSessionData) {
  if (data.periodMonth < 1 || data.periodMonth > 12) {
    throw new Error("Monat muss zwischen 1 und 12 liegen.")
  }
  if (data.periodYear < 2000 || data.periodYear > 2100) {
    throw new Error("Ungültiges Jahr.")
  }

  const session = await prisma.bookingSession.create({
    data: {
      userId,
      name: data.name,
      description: data.description,
      periodMonth: data.periodMonth,
      periodYear: data.periodYear,
    },
  })

  await logAuditEvent(userId, "booking_session.create", session.id)
  return session
}

export async function updateBookingSession(
  sessionId: string,
  userId: string,
  data: Partial<CreateSessionData>,
) {
  const session = await prisma.bookingSession.findFirst({
    where: { id: sessionId, userId },
  })
  if (!session) throw new Error("Buchungssitzung nicht gefunden.")
  if (session.status === "locked") throw new Error("Festgeschriebene Sitzung kann nicht bearbeitet werden.")

  const updated = await prisma.bookingSession.update({
    where: { id: sessionId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.periodMonth !== undefined && { periodMonth: data.periodMonth }),
      ...(data.periodYear !== undefined && { periodYear: data.periodYear }),
    },
  })

  await logAuditEvent(userId, "booking_session.update", sessionId)
  return updated
}

export async function deleteBookingSession(sessionId: string, userId: string) {
  const session = await prisma.bookingSession.findFirst({
    where: { id: sessionId, userId },
  })
  if (!session) throw new Error("Buchungssitzung nicht gefunden.")
  if (session.status === "locked") throw new Error("Festgeschriebene Sitzung kann nicht gelöscht werden.")

  await prisma.bookingSession.delete({ where: { id: sessionId } })
  await logAuditEvent(userId, "booking_session.delete", sessionId)
}

export async function lockBookingSession(sessionId: string, userId: string) {
  const session = await prisma.bookingSession.findFirst({
    where: { id: sessionId, userId },
  })
  if (!session) throw new Error("Buchungssitzung nicht gefunden.")
  if (session.status === "locked") throw new Error("Sitzung ist bereits festgeschrieben.")

  const updated = await prisma.bookingSession.update({
    where: { id: sessionId },
    data: {
      status: "locked",
      lockedAt: new Date(),
    },
  })

  await logAuditEvent(userId, "booking_session.lock", sessionId)
  return updated
}

// ─── Entry CRUD ─────────────────────────────────────────────────

export type CreateEntryData = {
  bookingDate: Date
  receiptNumber?: string
  receiptDate?: Date
  description: string
  debitAccount: string
  creditAccount: string
  amount: number // cents
  taxRate?: number // e.g. 19, 7, 0
  taxAmount?: number // cents, auto-calculated if omitted
  costCenter?: string
  merchant?: string
  notes?: string
  isTemplate?: boolean
  templateName?: string
}

function ensureSessionOpen(session: { status: string }) {
  if (session.status === "locked") {
    throw new Error("Festgeschriebene Sitzung kann nicht bearbeitet werden.")
  }
}

export async function getBookingEntries(sessionId: string, userId: string) {
  const session = await prisma.bookingSession.findFirst({
    where: { id: sessionId, userId },
  })
  if (!session) throw new Error("Buchungssitzung nicht gefunden.")

  return prisma.manualBookingEntry.findMany({
    where: { sessionId, userId },
    orderBy: [{ bookingDate: "asc" }, { createdAt: "asc" }],
  })
}

export async function createBookingEntry(
  sessionId: string,
  userId: string,
  data: CreateEntryData,
) {
  const session = await prisma.bookingSession.findFirst({
    where: { id: sessionId, userId },
  })
  if (!session) throw new Error("Buchungssitzung nicht gefunden.")
  ensureSessionOpen(session)

  if (!isValidSKR04Account(data.debitAccount)) {
    throw new Error(`Ungültiges Sollkonto: ${data.debitAccount}`)
  }
  if (!isValidSKR04Account(data.creditAccount)) {
    throw new Error(`Ungültiges Habenkonto: ${data.creditAccount}`)
  }
  if (data.amount <= 0) {
    throw new Error("Betrag muss positiv sein.")
  }

  const taxRate = data.taxRate ?? null
  let taxAmount = data.taxAmount ?? null
  if (taxRate !== null && taxRate > 0 && taxAmount === null) {
    taxAmount = calculateTaxAmount(data.amount, taxRate)
  }

  const entry = await prisma.manualBookingEntry.create({
    data: {
      sessionId,
      userId,
      bookingDate: data.bookingDate,
      receiptNumber: data.receiptNumber,
      receiptDate: data.receiptDate,
      description: data.description,
      debitAccount: data.debitAccount,
      creditAccount: data.creditAccount,
      amount: data.amount,
      taxRate: taxRate !== null ? new Decimal(taxRate) : null,
      taxAmount,
      costCenter: data.costCenter,
      merchant: data.merchant,
      notes: data.notes,
      isTemplate: data.isTemplate ?? false,
      templateName: data.templateName,
    },
  })

  await logAuditEvent(userId, "booking_entry.create", entry.id)
  return entry
}

export async function updateBookingEntry(
  entryId: string,
  userId: string,
  data: Partial<CreateEntryData>,
) {
  const entry = await prisma.manualBookingEntry.findFirst({
    where: { id: entryId, userId },
    include: { session: true },
  })
  if (!entry) throw new Error("Buchungseintrag nicht gefunden.")
  ensureSessionOpen(entry.session)

  if (data.debitAccount && !isValidSKR04Account(data.debitAccount)) {
    throw new Error(`Ungültiges Sollkonto: ${data.debitAccount}`)
  }
  if (data.creditAccount && !isValidSKR04Account(data.creditAccount)) {
    throw new Error(`Ungültiges Habenkonto: ${data.creditAccount}`)
  }

  // Recalculate tax if rate or amount changed
  let taxAmount = data.taxAmount
  if (taxAmount === undefined && data.taxRate !== undefined) {
    const amount = data.amount ?? entry.amount
    taxAmount = data.taxRate > 0 ? calculateTaxAmount(amount, data.taxRate) : 0
  }

  const updated = await prisma.manualBookingEntry.update({
    where: { id: entryId },
    data: {
      ...(data.bookingDate !== undefined && { bookingDate: data.bookingDate }),
      ...(data.receiptNumber !== undefined && { receiptNumber: data.receiptNumber }),
      ...(data.receiptDate !== undefined && { receiptDate: data.receiptDate }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.debitAccount !== undefined && { debitAccount: data.debitAccount }),
      ...(data.creditAccount !== undefined && { creditAccount: data.creditAccount }),
      ...(data.amount !== undefined && { amount: data.amount }),
      ...(data.taxRate !== undefined && { taxRate: data.taxRate !== null ? new Decimal(data.taxRate) : null }),
      ...(taxAmount !== undefined && { taxAmount }),
      ...(data.costCenter !== undefined && { costCenter: data.costCenter }),
      ...(data.merchant !== undefined && { merchant: data.merchant }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.isTemplate !== undefined && { isTemplate: data.isTemplate }),
      ...(data.templateName !== undefined && { templateName: data.templateName }),
    },
  })

  await logAuditEvent(userId, "booking_entry.update", entryId)
  return updated
}

export async function deleteBookingEntry(entryId: string, userId: string) {
  const entry = await prisma.manualBookingEntry.findFirst({
    where: { id: entryId, userId },
    include: { session: true },
  })
  if (!entry) throw new Error("Buchungseintrag nicht gefunden.")
  ensureSessionOpen(entry.session)

  await prisma.manualBookingEntry.delete({ where: { id: entryId } })
  await logAuditEvent(userId, "booking_entry.delete", entryId)
}

export async function duplicateBookingEntry(entryId: string, userId: string) {
  const entry = await prisma.manualBookingEntry.findFirst({
    where: { id: entryId, userId },
    include: { session: true },
  })
  if (!entry) throw new Error("Buchungseintrag nicht gefunden.")
  ensureSessionOpen(entry.session)

  const duplicate = await prisma.manualBookingEntry.create({
    data: {
      sessionId: entry.sessionId,
      userId,
      bookingDate: entry.bookingDate,
      receiptNumber: null, // Don't duplicate receipt number
      receiptDate: entry.receiptDate,
      description: entry.description,
      debitAccount: entry.debitAccount,
      creditAccount: entry.creditAccount,
      amount: entry.amount,
      taxRate: entry.taxRate,
      taxAmount: entry.taxAmount,
      costCenter: entry.costCenter,
      merchant: entry.merchant,
      notes: entry.notes,
      isTemplate: false,
      templateName: null,
      transactionId: null,
    },
  })

  await logAuditEvent(userId, "booking_entry.duplicate", duplicate.id, { sourceId: entryId })
  return duplicate
}

// ─── Posting (Session -> Transactions) ──────────────────────────

export async function postBookingSession(sessionId: string, userId: string) {
  const session = await prisma.bookingSession.findFirst({
    where: { id: sessionId, userId },
    include: { entries: { orderBy: { bookingDate: "asc" } } },
  })
  if (!session) throw new Error("Buchungssitzung nicht gefunden.")
  if (session.status === "locked") throw new Error("Sitzung ist bereits festgeschrieben.")
  if (session.entries.length === 0) throw new Error("Sitzung hat keine Buchungseinträge.")

  // Check balance: sum of all amounts should be equal (double-entry means each entry is balanced)
  // In our model each entry is a single debit/credit pair, so they are inherently balanced.

  const createdTransactions: any[] = []

  for (const entry of session.entries) {
    if (entry.transactionId) continue // already posted

    const transaction = await prisma.transaction.create({
      data: {
        userId,
        name: entry.description,
        description: `${entry.debitAccount} an ${entry.creditAccount}`,
        merchant: entry.merchant,
        total: entry.amount,
        currencyCode: "EUR",
        type: determineTransactionType(entry.debitAccount, entry.creditAccount),
        issuedAt: entry.bookingDate,
        sourceType: "manual",
        note: entry.notes,
        isLocked: true,
        lockedAt: new Date(),
      },
    })

    await prisma.manualBookingEntry.update({
      where: { id: entry.id },
      data: { transactionId: transaction.id },
    })

    createdTransactions.push(transaction)
  }

  // Lock the session
  await prisma.bookingSession.update({
    where: { id: sessionId },
    data: {
      status: "locked",
      lockedAt: new Date(),
    },
  })

  await logAuditEvent(userId, "booking_session.post", sessionId, {
    transactionCount: createdTransactions.length,
    transactionIds: createdTransactions.map(t => t.id),
  })

  return {
    session: { ...session, status: "locked" },
    transactionCount: createdTransactions.length,
    transactionIds: createdTransactions.map(t => t.id),
  }
}

function determineTransactionType(debitAccount: string, creditAccount: string): string {
  // Income accounts (4xxx) as credit = income
  if (/^4\d{3}$/.test(creditAccount)) return "income"
  // Expense accounts (5xxx-7xxx) as debit = expense
  if (/^[567]\d{3}$/.test(debitAccount)) return "expense"
  return "expense"
}

// ─── Templates ──────────────────────────────────────────────────

export async function getBookingTemplates(userId: string) {
  return prisma.manualBookingEntry.findMany({
    where: { userId, isTemplate: true },
    orderBy: { templateName: "asc" },
  })
}

export async function createFromTemplate(
  templateId: string,
  sessionId: string,
  userId: string,
  overrides?: Partial<CreateEntryData>,
) {
  const template = await prisma.manualBookingEntry.findFirst({
    where: { id: templateId, userId, isTemplate: true },
  })
  if (!template) throw new Error("Vorlage nicht gefunden.")

  const session = await prisma.bookingSession.findFirst({
    where: { id: sessionId, userId },
  })
  if (!session) throw new Error("Buchungssitzung nicht gefunden.")
  ensureSessionOpen(session)

  const entryData: CreateEntryData = {
    bookingDate: overrides?.bookingDate ?? new Date(),
    receiptNumber: overrides?.receiptNumber ?? template.receiptNumber ?? undefined,
    receiptDate: overrides?.receiptDate ?? template.receiptDate ?? undefined,
    description: overrides?.description ?? template.description,
    debitAccount: overrides?.debitAccount ?? template.debitAccount,
    creditAccount: overrides?.creditAccount ?? template.creditAccount,
    amount: overrides?.amount ?? template.amount,
    taxRate: overrides?.taxRate ?? (template.taxRate ? Number(template.taxRate) : undefined),
    taxAmount: overrides?.taxAmount ?? template.taxAmount ?? undefined,
    costCenter: overrides?.costCenter ?? template.costCenter ?? undefined,
    merchant: overrides?.merchant ?? template.merchant ?? undefined,
    notes: overrides?.notes ?? template.notes ?? undefined,
  }

  return createBookingEntry(sessionId, userId, entryData)
}

// ─── Balance Check ──────────────────────────────────────────────

export function checkSessionBalance(entries: { amount: number }[]) {
  // In our double-entry model, each entry represents a balanced debit/credit pair
  // The "Soll-Summe" and "Haben-Summe" are both equal to the sum of all amounts
  const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0)
  return {
    debitTotal: totalAmount,
    creditTotal: totalAmount,
    difference: 0,
    isBalanced: true,
  }
}
