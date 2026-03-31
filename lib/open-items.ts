/**
 * Offene-Posten-Verwaltung (Debitoren/Kreditoren)
 * Track unpaid invoices, payments, aging, and Saldenlisten
 */

import { prisma } from "@/lib/db"

// ─── Types ───────────────────────────────────────────────────────────

export type OpenItem = {
  id: string
  type: "debitor" | "kreditor"
  invoiceNumber: string
  invoiceDate: Date
  dueDate: Date
  merchant: string
  merchantAddress?: string | null
  amount: number          // original amount in cents
  paidAmount: number      // already paid
  remainingAmount: number
  status: "open" | "partial" | "paid" | "overdue" | "dunned"
  daysPastDue: number
  dunningLevel: number    // 0, 1, 2, 3
  lastDunningDate?: Date | null
  dunningFees: number
  interestAccrued: number
  transactionId?: string | null
  notes?: string | null
  isB2B: boolean
  createdAt: Date
  updatedAt: Date
}

export type CreateOpenItemData = {
  type: "debitor" | "kreditor"
  invoiceNumber: string
  invoiceDate: Date
  dueDate: Date
  merchant: string
  merchantAddress?: string
  amount: number
  notes?: string
  isB2B?: boolean
  transactionId?: string
}

export type AgingBucket = {
  label: string
  minDays: number
  maxDays: number | null
  count: number
  totalAmount: number
}

export type SaldenlisteEntry = {
  merchant: string
  openCount: number
  totalAmount: number
  paidAmount: number
  remainingAmount: number
  oldestDueDate: Date
}

// ─── Helpers ─────────────────────────────────────────────────────────

function calcDaysPastDue(dueDate: Date, now?: Date): number {
  const today = now ?? new Date()
  const due = new Date(dueDate)
  const diff = today.getTime() - due.getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

function mapToOpenItem(item: any): OpenItem {
  const remaining = item.amount - item.paidAmount
  const daysPastDue = calcDaysPastDue(item.dueDate)
  return {
    id: item.id,
    type: item.type,
    invoiceNumber: item.invoiceNumber,
    invoiceDate: item.invoiceDate,
    dueDate: item.dueDate,
    merchant: item.merchant,
    merchantAddress: item.merchantAddress,
    amount: item.amount,
    paidAmount: item.paidAmount,
    remainingAmount: remaining,
    status: item.status,
    daysPastDue,
    dunningLevel: item.dunningLevel,
    lastDunningDate: item.lastDunningDate,
    dunningFees: item.dunningFees,
    interestAccrued: item.interestAccrued,
    transactionId: item.transactionId,
    notes: item.notes,
    isB2B: item.isB2B,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

// ─── CRUD Operations ─────────────────────────────────────────────────

export async function getOpenItems(
  userId: string,
  type?: "debitor" | "kreditor",
  status?: string,
): Promise<OpenItem[]> {
  const where: any = { userId }
  if (type) where.type = type
  if (status) where.status = status

  const items = await prisma.openItem.findMany({
    where,
    orderBy: { dueDate: "asc" },
  })

  return items.map(mapToOpenItem)
}

export async function createOpenItem(
  userId: string,
  data: CreateOpenItemData,
): Promise<OpenItem> {
  const item = await prisma.openItem.create({
    data: {
      userId,
      type: data.type,
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate,
      dueDate: data.dueDate,
      merchant: data.merchant,
      merchantAddress: data.merchantAddress,
      amount: data.amount,
      notes: data.notes,
      isB2B: data.isB2B ?? true,
      transactionId: data.transactionId,
      status: "open",
    },
  })

  return mapToOpenItem(item)
}

export async function markAsPaid(
  itemId: string,
  userId: string,
  amount?: number,
  paymentDate?: Date,
): Promise<OpenItem> {
  const item = await prisma.openItem.findFirst({
    where: { id: itemId, userId },
  })

  if (!item) throw new Error("Offener Posten nicht gefunden")

  const remaining = item.amount - item.paidAmount
  const paymentAmount = amount ?? remaining
  const newPaidAmount = item.paidAmount + paymentAmount
  const newRemaining = item.amount - newPaidAmount

  let newStatus: string
  if (newRemaining <= 0) {
    newStatus = "paid"
  } else if (newPaidAmount > 0) {
    newStatus = "partial"
  } else {
    newStatus = item.status
  }

  const updated = await prisma.openItem.update({
    where: { id: itemId },
    data: {
      paidAmount: newPaidAmount,
      status: newStatus,
    },
  })

  return mapToOpenItem(updated)
}

export async function matchPaymentToOpenItem(
  transactionId: string,
  openItemId: string,
): Promise<OpenItem> {
  const updated = await prisma.openItem.update({
    where: { id: openItemId },
    data: { transactionId },
  })

  return mapToOpenItem(updated)
}

// ─── Auto-Match ──────────────────────────────────────────────────────

export async function autoMatchPayments(userId: string): Promise<{
  matched: number
  unmatched: number
}> {
  // Get unmatched open items (debitor = we expect incoming payments)
  const openItems = await prisma.openItem.findMany({
    where: {
      userId,
      status: { in: ["open", "partial", "overdue", "dunned"] },
      transactionId: null,
    },
  })

  // Get recent income transactions without an open item link
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      type: "income",
      issuedAt: { not: null },
    },
    orderBy: { issuedAt: "desc" },
    take: 500,
  })

  // Find already linked transaction IDs
  const linkedTxIds = new Set(
    (await prisma.openItem.findMany({
      where: { userId, transactionId: { not: null } },
      select: { transactionId: true },
    })).map(i => i.transactionId)
  )

  let matched = 0

  for (const item of openItems) {
    const remaining = item.amount - item.paidAmount

    // Try to match by amount and merchant
    const match = transactions.find(tx => {
      if (linkedTxIds.has(tx.id)) return false
      const txAmount = Math.abs(tx.total ?? 0)
      const amountMatch = txAmount === remaining || txAmount === item.amount
      const merchantMatch = tx.merchant
        && item.merchant
        && tx.merchant.toLowerCase().includes(item.merchant.toLowerCase())

      // Also check if transaction text contains the invoice number
      const refMatch = tx.text
        && item.invoiceNumber
        && tx.text.includes(item.invoiceNumber)

      return amountMatch && (merchantMatch || refMatch)
    })

    if (match) {
      const payAmount = Math.abs(match.total ?? 0)
      const newPaid = item.paidAmount + payAmount
      const newStatus = newPaid >= item.amount ? "paid" : "partial"

      await prisma.openItem.update({
        where: { id: item.id },
        data: {
          transactionId: match.id,
          paidAmount: newPaid,
          status: newStatus,
        },
      })

      linkedTxIds.add(match.id)
      matched++
    }
  }

  return { matched, unmatched: openItems.length - matched }
}

// ─── Aging Report ────────────────────────────────────────────────────

export async function getAgingReport(userId: string): Promise<AgingBucket[]> {
  const items = await prisma.openItem.findMany({
    where: {
      userId,
      status: { in: ["open", "partial", "overdue", "dunned"] },
    },
  })

  const buckets: AgingBucket[] = [
    { label: "0-30 Tage", minDays: 0, maxDays: 30, count: 0, totalAmount: 0 },
    { label: "31-60 Tage", minDays: 31, maxDays: 60, count: 0, totalAmount: 0 },
    { label: "61-90 Tage", minDays: 61, maxDays: 90, count: 0, totalAmount: 0 },
    { label: "90+ Tage", minDays: 91, maxDays: null, count: 0, totalAmount: 0 },
  ]

  for (const item of items) {
    const daysPast = calcDaysPastDue(item.dueDate)
    const remaining = item.amount - item.paidAmount

    for (const bucket of buckets) {
      const inRange = daysPast >= bucket.minDays
        && (bucket.maxDays === null || daysPast <= bucket.maxDays)
      if (inRange) {
        bucket.count++
        bucket.totalAmount += remaining
        break
      }
    }
  }

  return buckets
}

// ─── Saldenlisten ────────────────────────────────────────────────────

async function getSaldenliste(
  userId: string,
  type: "debitor" | "kreditor",
): Promise<SaldenlisteEntry[]> {
  const items = await prisma.openItem.findMany({
    where: {
      userId,
      type,
      status: { not: "paid" },
    },
    orderBy: { merchant: "asc" },
  })

  const merchantMap = new Map<string, SaldenlisteEntry>()

  for (const item of items) {
    const key = item.merchant.toLowerCase()
    const existing = merchantMap.get(key)
    const remaining = item.amount - item.paidAmount

    if (existing) {
      existing.openCount++
      existing.totalAmount += item.amount
      existing.paidAmount += item.paidAmount
      existing.remainingAmount += remaining
      if (item.dueDate < existing.oldestDueDate) {
        existing.oldestDueDate = item.dueDate
      }
    } else {
      merchantMap.set(key, {
        merchant: item.merchant,
        openCount: 1,
        totalAmount: item.amount,
        paidAmount: item.paidAmount,
        remainingAmount: remaining,
        oldestDueDate: item.dueDate,
      })
    }
  }

  return Array.from(merchantMap.values()).sort((a, b) =>
    b.remainingAmount - a.remainingAmount
  )
}

export async function getDebitSaldenliste(userId: string): Promise<SaldenlisteEntry[]> {
  return getSaldenliste(userId, "debitor")
}

export async function getKreditorSaldenliste(userId: string): Promise<SaldenlisteEntry[]> {
  return getSaldenliste(userId, "kreditor")
}

// Re-export helper for tests
export { calcDaysPastDue }
