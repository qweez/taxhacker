import { prisma } from "@/lib/db"
import { detectRecurringTransactions } from "@/lib/fints/recurring-detection"

// German CPI (Verbraucherpreisindex) data - base year 2020 = 100
// Source: Statistisches Bundesamt (Destatis)
export const CPI_DATA: Record<number, number> = {
  2015: 91.6,
  2016: 92.1,
  2017: 93.5,
  2018: 95.1,
  2019: 96.5,
  2020: 100.0,
  2021: 103.1,
  2022: 110.4,
  2023: 117.4,
  2024: 120.1,
  2025: 122.8,
  2026: 125.0, // estimate
}

const DEFAULT_THRESHOLD_PERCENT = 5.0

/**
 * Calculate inflation rate between two years as a percentage.
 * Returns the percentage change from fromYear to toYear.
 */
export function getInflationRate(fromYear: number, toYear: number): number {
  const fromCPI = CPI_DATA[fromYear]
  const toCPI = CPI_DATA[toYear]

  if (fromCPI === undefined || toCPI === undefined) {
    throw new Error(`CPI data not available for year ${fromCPI === undefined ? fromYear : toYear}`)
  }

  if (fromCPI === 0) {
    throw new Error("Base year CPI cannot be zero")
  }

  return ((toCPI - fromCPI) / fromCPI) * 100
}

/**
 * Adjust an amount (in cents) for inflation from one year to another.
 * Returns the inflation-adjusted amount in cents (rounded).
 */
export function adjustForInflation(amountCents: number, fromYear: number, toYear: number): number {
  if (fromYear === toYear) return amountCents

  const fromCPI = CPI_DATA[fromYear]
  const toCPI = CPI_DATA[toYear]

  if (fromCPI === undefined || toCPI === undefined) {
    throw new Error(`CPI data not available for year ${fromCPI === undefined ? fromYear : toYear}`)
  }

  if (fromCPI === 0) {
    throw new Error("Base year CPI cannot be zero")
  }

  return Math.round(amountCents * (toCPI / fromCPI))
}

/**
 * Calculate cumulative inflation over a period as a percentage.
 * This is the total percentage increase from fromYear to toYear.
 */
export function getCumulativeInflation(fromYear: number, toYear: number): number {
  return getInflationRate(fromYear, toYear)
}

/**
 * Check if inflation exceeds a threshold since base year.
 */
export function exceedsInflationThreshold(
  baseAmountCents: number,
  baseYear: number,
  currentYear: number,
  thresholdPercent: number = DEFAULT_THRESHOLD_PERCENT,
): { exceeded: boolean; currentRate: number; adjustedAmount: number } {
  if (baseYear === currentYear) {
    return { exceeded: false, currentRate: 0, adjustedAmount: baseAmountCents }
  }

  const currentRate = getCumulativeInflation(baseYear, currentYear)
  const adjustedAmount = adjustForInflation(baseAmountCents, baseYear, currentYear)

  return {
    exceeded: Math.abs(currentRate) >= thresholdPercent,
    currentRate,
    adjustedAmount,
  }
}

export type InflationReportItem = {
  name: string
  merchant: string | null
  baseAmount: number // cents
  baseYear: number
  currentAmount: number // inflation-adjusted cents
  inflationRate: number // percentage
  difference: number // cents
  shouldAdjust: boolean // exceeds threshold
}

export type InflationReport = {
  items: InflationReportItem[]
  totalBaseAmount: number
  totalCurrentAmount: number
  totalDifference: number
  averageInflation: number
  generatedAt: Date
  thresholdPercent: number
}

/**
 * Generate inflation report for all recurring costs of a user.
 * Detects recurring transactions, determines the base year from the first occurrence,
 * and calculates inflation-adjusted amounts.
 */
export async function generateInflationReport(
  userId: string,
  thresholdPercent: number = DEFAULT_THRESHOLD_PERCENT,
): Promise<InflationReport> {
  const currentYear = new Date().getFullYear()
  const patterns = await detectRecurringTransactions(userId)

  const items: InflationReportItem[] = []

  for (const pattern of patterns) {
    // Determine base year from the earliest transaction
    const earliestTxId = pattern.transactionIds[0]
    let baseYear = currentYear

    if (earliestTxId) {
      const earliestTx = await prisma.transaction.findUnique({
        where: { id: earliestTxId },
        select: { issuedAt: true },
      })
      if (earliestTx?.issuedAt) {
        baseYear = earliestTx.issuedAt.getFullYear()
      }
    }

    // Clamp base year to available CPI data range
    const cpiYears = Object.keys(CPI_DATA).map(Number).sort((a, b) => a - b)
    const minYear = cpiYears[0]
    const maxYear = cpiYears[cpiYears.length - 1]
    const clampedBaseYear = Math.max(minYear, Math.min(maxYear, baseYear))
    const clampedCurrentYear = Math.max(minYear, Math.min(maxYear, currentYear))

    if (clampedBaseYear === clampedCurrentYear) {
      // No inflation calculation possible for same year
      items.push({
        name: pattern.merchant,
        merchant: pattern.merchant,
        baseAmount: pattern.amount,
        baseYear: clampedBaseYear,
        currentAmount: pattern.amount,
        inflationRate: 0,
        difference: 0,
        shouldAdjust: false,
      })
      continue
    }

    const { exceeded, currentRate, adjustedAmount } = exceedsInflationThreshold(
      pattern.amount,
      clampedBaseYear,
      clampedCurrentYear,
      thresholdPercent,
    )

    items.push({
      name: pattern.merchant,
      merchant: pattern.merchant,
      baseAmount: pattern.amount,
      baseYear: clampedBaseYear,
      currentAmount: adjustedAmount,
      inflationRate: currentRate,
      difference: adjustedAmount - pattern.amount,
      shouldAdjust: exceeded,
    })
  }

  const totalBaseAmount = items.reduce((sum, item) => sum + item.baseAmount, 0)
  const totalCurrentAmount = items.reduce((sum, item) => sum + item.currentAmount, 0)
  const totalDifference = totalCurrentAmount - totalBaseAmount
  const averageInflation =
    items.length > 0
      ? items.reduce((sum, item) => sum + item.inflationRate, 0) / items.length
      : 0

  return {
    items,
    totalBaseAmount,
    totalCurrentAmount,
    totalDifference,
    averageInflation,
    generatedAt: new Date(),
    thresholdPercent,
  }
}
