import { prisma } from "@/lib/db"

export type RecurringPattern = {
  merchant: string
  amount: number // in cents
  frequency: "monthly" | "quarterly" | "yearly" | "weekly"
  lastOccurrence: Date
  nextExpected: Date
  occurrences: number
  transactionIds: string[]
  categoryCode: string | null
}

/**
 * Normalize merchant name for grouping:
 * trim, lowercase, remove common suffixes like GmbH, AG, etc.
 */
function normalizeMerchant(merchant: string): string {
  return merchant
    .trim()
    .toLowerCase()
    .replace(/\s+(gmbh|ag|se|kg|e\.v\.|ltd|inc|corp|ug|ohg|mbh|co\.?\s*kg|gmbh\s*&\s*co\.?\s*kg)\.?$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

type Frequency = RecurringPattern["frequency"]

/**
 * Determine frequency from a list of intervals (in days).
 * Returns null if no clear pattern is found.
 */
function detectFrequency(intervals: number[]): Frequency | null {
  if (intervals.length === 0) return null

  const median = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)]

  if (median >= 6 && median <= 8) return "weekly"
  if (median >= 28 && median <= 31) return "monthly"
  if (median >= 85 && median <= 95) return "quarterly"
  if (median >= 355 && median <= 375) return "yearly"

  // Check if most intervals cluster around a frequency
  const frequencies: { range: [number, number]; freq: Frequency }[] = [
    { range: [6, 8], freq: "weekly" },
    { range: [28, 31], freq: "monthly" },
    { range: [85, 95], freq: "quarterly" },
    { range: [355, 375], freq: "yearly" },
  ]

  for (const { range, freq } of frequencies) {
    const matching = intervals.filter(i => i >= range[0] && i <= range[1])
    if (matching.length >= intervals.length * 0.6) {
      return freq
    }
  }

  return null
}

/**
 * Check if amounts are identical or within 5% tolerance.
 */
function amountsMatch(amounts: number[]): boolean {
  if (amounts.length < 2) return true

  const baseAmount = amounts[0]
  if (baseAmount === 0) return amounts.every(a => a === 0)

  const tolerance = Math.abs(baseAmount) * 0.05

  return amounts.every(a => Math.abs(a - baseAmount) <= tolerance)
}

/**
 * Get the expected interval in days for a frequency.
 */
function frequencyDays(freq: Frequency): number {
  switch (freq) {
    case "weekly": return 7
    case "monthly": return 30
    case "quarterly": return 91
    case "yearly": return 365
  }
}

/**
 * Analyze transactions to find recurring patterns (Dauerauftraege / Abos).
 */
export async function detectRecurringTransactions(
  userId: string,
): Promise<RecurringPattern[]> {
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      merchant: { not: null },
      issuedAt: { not: null },
      total: { not: null },
    },
    orderBy: { issuedAt: "asc" },
    select: {
      id: true,
      merchant: true,
      total: true,
      issuedAt: true,
      categoryCode: true,
    },
  })

  // Group by normalized merchant name
  const groups = new Map<string, typeof transactions>()
  for (const tx of transactions) {
    if (!tx.merchant || !tx.issuedAt) continue
    const key = normalizeMerchant(tx.merchant)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(tx)
    groups.set(key, group)
  }

  const patterns: RecurringPattern[] = []

  for (const [, group] of groups) {
    // Need at least 3 transactions to detect a pattern
    if (group.length < 3) continue

    const amounts = group.map(t => t.total!)
    if (!amountsMatch(amounts)) continue

    // Calculate intervals between consecutive transactions
    const intervals: number[] = []
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1].issuedAt!
      const curr = group[i].issuedAt!
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
      intervals.push(diffDays)
    }

    const frequency = detectFrequency(intervals)
    if (!frequency) continue

    const lastTx = group[group.length - 1]
    const lastDate = lastTx.issuedAt!
    const nextExpected = new Date(lastDate)
    nextExpected.setDate(nextExpected.getDate() + frequencyDays(frequency))

    // Use the most common category code from the group
    const categoryCounts = new Map<string | null, number>()
    for (const tx of group) {
      const count = categoryCounts.get(tx.categoryCode) ?? 0
      categoryCounts.set(tx.categoryCode, count + 1)
    }
    let bestCategory: string | null = null
    let bestCount = 0
    for (const [cat, count] of categoryCounts) {
      if (count > bestCount) {
        bestCategory = cat
        bestCount = count
      }
    }

    // Use the average amount
    const avgAmount = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length)

    patterns.push({
      merchant: lastTx.merchant!,
      amount: avgAmount,
      frequency,
      lastOccurrence: lastDate,
      nextExpected,
      occurrences: group.length,
      transactionIds: group.map(t => t.id),
      categoryCode: bestCategory,
    })
  }

  // Sort by next expected date
  patterns.sort((a, b) => a.nextExpected.getTime() - b.nextExpected.getTime())

  return patterns
}
