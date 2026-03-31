import { prisma } from "@/lib/db"
import type { RecurringInvoice } from "@/prisma/client"

export type RecurringInvoiceData = {
  name: string
  merchant?: string | null
  description?: string | null
  amount: number
  currencyCode?: string
  type?: string
  categoryCode?: string | null
  projectCode?: string | null
  frequency?: string
  startDate: Date | string
  endDate?: Date | string | null
  nextDueDate?: Date | string
  autoGenerate?: boolean
  notifyBeforeDays?: number | null
  inflationAdjusted?: boolean
  baseAmount?: number | null
  baseYear?: number | null
}

export async function getRecurringInvoices(userId: string): Promise<RecurringInvoice[]> {
  return await prisma.recurringInvoice.findMany({
    where: { userId },
    orderBy: { nextDueDate: "asc" },
  })
}

export async function createRecurringInvoice(
  userId: string,
  data: RecurringInvoiceData,
): Promise<RecurringInvoice> {
  const startDate = new Date(data.startDate)
  const nextDueDate = data.nextDueDate ? new Date(data.nextDueDate) : startDate

  return await prisma.recurringInvoice.create({
    data: {
      userId,
      name: data.name,
      merchant: data.merchant ?? null,
      description: data.description ?? null,
      amount: data.amount,
      currencyCode: data.currencyCode ?? "EUR",
      type: data.type ?? "expense",
      categoryCode: data.categoryCode ?? null,
      projectCode: data.projectCode ?? null,
      frequency: data.frequency ?? "monthly",
      startDate,
      endDate: data.endDate ? new Date(data.endDate) : null,
      nextDueDate,
      autoGenerate: data.autoGenerate ?? false,
      notifyBeforeDays: data.notifyBeforeDays ?? 3,
      inflationAdjusted: data.inflationAdjusted ?? false,
      baseAmount: data.baseAmount ?? null,
      baseYear: data.baseYear ?? null,
    },
  })
}

export async function updateRecurringInvoice(
  id: string,
  userId: string,
  data: Partial<RecurringInvoiceData>,
): Promise<RecurringInvoice> {
  const updateData: Record<string, unknown> = {}

  if (data.name !== undefined) updateData.name = data.name
  if (data.merchant !== undefined) updateData.merchant = data.merchant
  if (data.description !== undefined) updateData.description = data.description
  if (data.amount !== undefined) updateData.amount = data.amount
  if (data.currencyCode !== undefined) updateData.currencyCode = data.currencyCode
  if (data.type !== undefined) updateData.type = data.type
  if (data.categoryCode !== undefined) updateData.categoryCode = data.categoryCode
  if (data.projectCode !== undefined) updateData.projectCode = data.projectCode
  if (data.frequency !== undefined) updateData.frequency = data.frequency
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null
  if (data.nextDueDate !== undefined) updateData.nextDueDate = new Date(data.nextDueDate)
  if (data.autoGenerate !== undefined) updateData.autoGenerate = data.autoGenerate
  if (data.notifyBeforeDays !== undefined) updateData.notifyBeforeDays = data.notifyBeforeDays
  if (data.inflationAdjusted !== undefined) updateData.inflationAdjusted = data.inflationAdjusted
  if (data.baseAmount !== undefined) updateData.baseAmount = data.baseAmount
  if (data.baseYear !== undefined) updateData.baseYear = data.baseYear

  return await prisma.recurringInvoice.update({
    where: { id, userId },
    data: updateData,
  })
}

export async function deleteRecurringInvoice(id: string, userId: string): Promise<void> {
  await prisma.recurringInvoice.delete({
    where: { id, userId },
  })
}

/**
 * Calculate next due date based on frequency.
 */
export function calculateNextDueDate(currentDate: Date, frequency: string): Date {
  const next = new Date(currentDate)

  switch (frequency) {
    case "weekly":
      next.setDate(next.getDate() + 7)
      break
    case "monthly":
      next.setMonth(next.getMonth() + 1)
      break
    case "quarterly":
      next.setMonth(next.getMonth() + 3)
      break
    case "yearly":
      next.setFullYear(next.getFullYear() + 1)
      break
    default:
      next.setMonth(next.getMonth() + 1)
  }

  return next
}

/**
 * Simple inflation adjustment: ~2% per year from base year.
 */
function applyInflationAdjustment(baseAmount: number, baseYear: number): number {
  const currentYear = new Date().getFullYear()
  const years = currentYear - baseYear
  if (years <= 0) return baseAmount
  // Compound 2% annual inflation
  return Math.round(baseAmount * Math.pow(1.02, years))
}

/**
 * Generate due transactions for all active recurring invoices.
 */
export async function generateDueTransactions(
  userId: string,
): Promise<{ generated: number; skipped: number }> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const dueInvoices = await prisma.recurringInvoice.findMany({
    where: {
      userId,
      isActive: true,
      nextDueDate: { lte: today },
    },
  })

  let generated = 0
  let skipped = 0

  for (const invoice of dueInvoices) {
    // Check if end_date has passed
    if (invoice.endDate && new Date(invoice.endDate) < today) {
      await prisma.recurringInvoice.update({
        where: { id: invoice.id },
        data: { isActive: false },
      })
      skipped++
      continue
    }

    // Determine amount (inflation adjusted or base)
    let amount = invoice.amount
    if (invoice.inflationAdjusted && invoice.baseAmount && invoice.baseYear) {
      amount = applyInflationAdjustment(invoice.baseAmount, invoice.baseYear)
    }

    // Create transaction
    await prisma.transaction.create({
      data: {
        userId: invoice.userId,
        name: invoice.name,
        merchant: invoice.merchant,
        description: invoice.description,
        total: amount,
        currencyCode: invoice.currencyCode,
        type: invoice.type,
        categoryCode: invoice.categoryCode,
        projectCode: invoice.projectCode,
        issuedAt: invoice.nextDueDate,
        sourceType: "recurring",
      },
    })

    // Update next due date and last generated
    const nextDue = calculateNextDueDate(new Date(invoice.nextDueDate), invoice.frequency)

    const updateData: Record<string, unknown> = {
      nextDueDate: nextDue,
      lastGeneratedAt: new Date(),
    }

    // If next due date is past end_date, deactivate
    if (invoice.endDate && nextDue > new Date(invoice.endDate)) {
      updateData.isActive = false
    }

    await prisma.recurringInvoice.update({
      where: { id: invoice.id },
      data: updateData,
    })

    generated++
  }

  return { generated, skipped }
}

/**
 * Get upcoming due invoices (next N days).
 */
export async function getUpcomingDueInvoices(
  userId: string,
  daysAhead: number = 7,
): Promise<RecurringInvoice[]> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const futureDate = new Date(today)
  futureDate.setDate(futureDate.getDate() + daysAhead)

  return await prisma.recurringInvoice.findMany({
    where: {
      userId,
      isActive: true,
      nextDueDate: {
        gte: today,
        lte: futureDate,
      },
    },
    orderBy: { nextDueDate: "asc" },
  })
}
