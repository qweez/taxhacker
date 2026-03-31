import { prisma } from "@/lib/db"

export type UStSummary = {
  period: { from: Date; to: Date }
  outputTax: { // Ausgangsrechnungen
    rate19: { netto: number; ust: number; brutto: number; count: number }
    rate7: { netto: number; ust: number; brutto: number; count: number }
    rate0: { netto: number; brutto: number; count: number }
  }
  inputTax: { // Eingangsrechnungen (Vorsteuer)
    rate19: { netto: number; vorsteuer: number; brutto: number; count: number }
    rate7: { netto: number; vorsteuer: number; brutto: number; count: number }
  }
  zahllast: number // outputTax.ust - inputTax.vorsteuer
}

// Categories that use the reduced 7% rate
const REDUCED_RATE_CATEGORIES = new Set([
  "income_7",
  "food", // Lebensmittel (Grundnahrungsmittel)
])

// Categories that are tax-exempt (0%)
const EXEMPT_CATEGORIES = new Set([
  "income_0",
  "insurance",
  "interest",
  "bank_fees",
  "salary",
  "tax",
])

/**
 * Determine the USt rate for a transaction based on its category.
 * Returns 19, 7, or 0.
 */
function getUStRate(categoryCode: string | null, type: string | null): number {
  if (categoryCode) {
    const code = categoryCode.toLowerCase()
    if (EXEMPT_CATEGORIES.has(code)) return 0
    if (REDUCED_RATE_CATEGORIES.has(code)) return 7
  }
  // Default: 19% for both income and expenses
  return 19
}

/**
 * Calculate netto from brutto given a USt rate.
 * brutto = netto * (1 + rate/100)
 * netto = brutto / (1 + rate/100)
 * All values in cents (integers).
 */
function nettoFromBrutto(bruttoCents: number, rate: number): number {
  if (rate === 0) return bruttoCents
  return Math.round(bruttoCents / (1 + rate / 100))
}

function ustFromBrutto(bruttoCents: number, rate: number): number {
  if (rate === 0) return 0
  const netto = nettoFromBrutto(bruttoCents, rate)
  return bruttoCents - netto
}

/**
 * Generate a USt summary for the USt-Voranmeldung.
 * Queries all transactions for the given user and period,
 * groups them by tax rate, and calculates Netto, USt/Vorsteuer, Brutto.
 *
 * All amounts are in cents.
 */
export async function generateUStSummary(
  userId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<UStSummary> {
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      issuedAt: {
        gte: dateFrom,
        lte: dateTo,
      },
    },
    include: { category: true },
    orderBy: { issuedAt: "asc" },
  })

  const summary: UStSummary = {
    period: { from: dateFrom, to: dateTo },
    outputTax: {
      rate19: { netto: 0, ust: 0, brutto: 0, count: 0 },
      rate7: { netto: 0, ust: 0, brutto: 0, count: 0 },
      rate0: { netto: 0, brutto: 0, count: 0 },
    },
    inputTax: {
      rate19: { netto: 0, vorsteuer: 0, brutto: 0, count: 0 },
      rate7: { netto: 0, vorsteuer: 0, brutto: 0, count: 0 },
    },
    zahllast: 0,
  }

  for (const tx of transactions) {
    if (!tx.total) continue

    const brutto = Math.abs(tx.total)
    const rate = getUStRate(tx.categoryCode, tx.type)
    const netto = nettoFromBrutto(brutto, rate)
    const ust = ustFromBrutto(brutto, rate)

    if (tx.type === "income") {
      // Ausgangsrechnungen (output tax)
      if (rate === 19) {
        summary.outputTax.rate19.netto += netto
        summary.outputTax.rate19.ust += ust
        summary.outputTax.rate19.brutto += brutto
        summary.outputTax.rate19.count++
      } else if (rate === 7) {
        summary.outputTax.rate7.netto += netto
        summary.outputTax.rate7.ust += ust
        summary.outputTax.rate7.brutto += brutto
        summary.outputTax.rate7.count++
      } else {
        summary.outputTax.rate0.netto += brutto
        summary.outputTax.rate0.brutto += brutto
        summary.outputTax.rate0.count++
      }
    } else {
      // Eingangsrechnungen (input tax / Vorsteuer)
      if (rate === 19) {
        summary.inputTax.rate19.netto += netto
        summary.inputTax.rate19.vorsteuer += ust
        summary.inputTax.rate19.brutto += brutto
        summary.inputTax.rate19.count++
      } else if (rate === 7) {
        summary.inputTax.rate7.netto += netto
        summary.inputTax.rate7.vorsteuer += ust
        summary.inputTax.rate7.brutto += brutto
        summary.inputTax.rate7.count++
      }
      // rate 0 expenses have no Vorsteuer, so we skip them
    }
  }

  // Zahllast = USt aus Ausgangsrechnungen - Vorsteuer aus Eingangsrechnungen
  const totalOutputUst = summary.outputTax.rate19.ust + summary.outputTax.rate7.ust
  const totalInputVorsteuer = summary.inputTax.rate19.vorsteuer + summary.inputTax.rate7.vorsteuer
  summary.zahllast = totalOutputUst - totalInputVorsteuer

  return summary
}
