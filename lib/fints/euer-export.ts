import { prisma } from "@/lib/db"

/**
 * EUeR (Einnahmenueberschussrechnung) export for German small businesses
 * and freelancers (Kleinunternehmer, Freiberufler).
 *
 * Maps transaction categories to Kennzahlen (KZ) from the official
 * Anlage EUeR tax form. Amounts are stored in cents internally and
 * converted to euros for output.
 */

export type EUERData = {
  year: number
  // Betriebseinnahmen (KZ 111-199)
  einnahmen: {
    kz111: number // Umsatzerloese (Betriebseinnahmen als umsatzsteuerlicher Kleinunternehmer)
    kz112: number // Umsatzerloese zum allgemeinen Steuersatz (19%)
    kz113: number // Umsatzerloese zum ermaessigten Steuersatz (7%)
    kz114: number // Steuerfreie Umsaetze
    kz120: number // Vereinnahmte USt
    kz125: number // Vom Finanzamt erstattete USt
    kz185: number // Summe Betriebseinnahmen
  }
  // Betriebsausgaben (KZ 200-399)
  ausgaben: {
    kz210: number // Waren, Rohstoffe, Hilfsstoffe
    kz220: number // Bezogene Fremdleistungen
    kz230: number // Gehaelter/Loehne
    kz240: number // Soziale Abgaben
    kz250: number // AfA
    kz260: number // Raumkosten (Miete)
    kz270: number // Sonstige Grundstuecksaufwendungen
    kz280: number // Kfz-Kosten
    kz285: number // Reisekosten
    kz290: number // Bewirtungskosten (70% abzugsfaehig)
    kz295: number // Geschenke
    kz300: number // Telefon/Internet
    kz310: number // Porto
    kz315: number // Buerobedarf
    kz320: number // Rechts- und Beratungskosten
    kz325: number // Versicherungen
    kz330: number // Beitraege
    kz340: number // Werbekosten
    kz345: number // Schulungen/Fortbildung
    kz350: number // Nebenkosten Geldverkehr (Bankgebuehren)
    kz355: number // Sonstige Betriebsausgaben
    kz359: number // Gezahlte Vorsteuer
    kz360: number // An das Finanzamt gezahlte USt
    kz399: number // Summe Betriebsausgaben
  }
  // Ergebnis
  gewinnVerlust: number // KZ 185 - KZ 399
}

/**
 * Maps category codes used in the transaction system to EUeR Kennzahlen.
 * Expense categories map to KZ in the Betriebsausgaben section.
 * Income categories map to KZ 112 (standard rate 19%).
 */
const CATEGORY_TO_KZ: Record<string, string> = {
  // Income
  income: "kz112",
  // Expenses
  salary: "kz230",
  rent: "kz260",
  vehicle: "kz280",
  travel: "kz285",
  food: "kz290",
  gifts: "kz295",
  telecom: "kz300",
  postage: "kz310",
  office: "kz315",
  legal: "kz320",
  accounting: "kz320",
  insurance: "kz325",
  advertising: "kz340",
  training: "kz345",
  bank_fees: "kz350",
  software: "kz355",
  hosting: "kz355",
  default_expense: "kz355",
}

/**
 * Retrieves all transactions for a user within a given year and computes
 * the full EUeR (Anlage EUeR) data structure.
 *
 * Amounts are in cents (matching the database storage).
 */
export async function generateEUER(
  userId: string,
  year: number,
): Promise<EUERData> {
  const dateFrom = new Date(year, 0, 1)
  const dateTo = new Date(year, 11, 31, 23, 59, 59, 999)

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      issuedAt: { gte: dateFrom, lte: dateTo },
    },
    include: { category: true },
    orderBy: { issuedAt: "asc" },
  })

  const data: EUERData = {
    year,
    einnahmen: {
      kz111: 0,
      kz112: 0,
      kz113: 0,
      kz114: 0,
      kz120: 0,
      kz125: 0,
      kz185: 0,
    },
    ausgaben: {
      kz210: 0,
      kz220: 0,
      kz230: 0,
      kz240: 0,
      kz250: 0,
      kz260: 0,
      kz270: 0,
      kz280: 0,
      kz285: 0,
      kz290: 0,
      kz295: 0,
      kz300: 0,
      kz310: 0,
      kz315: 0,
      kz320: 0,
      kz325: 0,
      kz330: 0,
      kz340: 0,
      kz345: 0,
      kz350: 0,
      kz355: 0,
      kz359: 0,
      kz360: 0,
      kz399: 0,
    },
    gewinnVerlust: 0,
  }

  for (const tx of transactions) {
    const amount = Math.abs(tx.total ?? 0)
    if (amount === 0) continue

    const categoryCode = tx.categoryCode?.toLowerCase() ?? ""

    if (tx.type === "income") {
      // Map income transactions to the appropriate KZ
      const kz = CATEGORY_TO_KZ[categoryCode] ?? "kz112"
      if (kz in data.einnahmen) {
        data.einnahmen[kz as keyof typeof data.einnahmen] += amount
      } else {
        // Fallback: general income at 19%
        data.einnahmen.kz112 += amount
      }
    } else {
      // Expense transactions
      const kz = CATEGORY_TO_KZ[categoryCode] ?? "kz355"
      if (kz in data.ausgaben) {
        if (kz === "kz290") {
          // Bewirtungskosten: only 70% is tax-deductible
          data.ausgaben.kz290 += Math.round(amount * 0.7)
        } else {
          data.ausgaben[kz as keyof typeof data.ausgaben] += amount
        }
      } else {
        // Fallback: sonstige Betriebsausgaben
        data.ausgaben.kz355 += amount
      }
    }
  }

  // Compute sums
  data.einnahmen.kz185 =
    data.einnahmen.kz111 +
    data.einnahmen.kz112 +
    data.einnahmen.kz113 +
    data.einnahmen.kz114 +
    data.einnahmen.kz120 +
    data.einnahmen.kz125

  data.ausgaben.kz399 =
    data.ausgaben.kz210 +
    data.ausgaben.kz220 +
    data.ausgaben.kz230 +
    data.ausgaben.kz240 +
    data.ausgaben.kz250 +
    data.ausgaben.kz260 +
    data.ausgaben.kz270 +
    data.ausgaben.kz280 +
    data.ausgaben.kz285 +
    data.ausgaben.kz290 +
    data.ausgaben.kz295 +
    data.ausgaben.kz300 +
    data.ausgaben.kz310 +
    data.ausgaben.kz315 +
    data.ausgaben.kz320 +
    data.ausgaben.kz325 +
    data.ausgaben.kz330 +
    data.ausgaben.kz340 +
    data.ausgaben.kz345 +
    data.ausgaben.kz350 +
    data.ausgaben.kz355 +
    data.ausgaben.kz359 +
    data.ausgaben.kz360

  data.gewinnVerlust = data.einnahmen.kz185 - data.ausgaben.kz399

  return data
}

/** Human-readable labels for each KZ row */
const KZ_LABELS: Record<string, string> = {
  // Einnahmen
  kz111: "Betriebseinnahmen als umsatzsteuerlicher Kleinunternehmer",
  kz112: "Umsatzerloese zum allgemeinen Steuersatz (19%)",
  kz113: "Umsatzerloese zum ermaessigten Steuersatz (7%)",
  kz114: "Steuerfreie Umsaetze",
  kz120: "Vereinnahmte Umsatzsteuer",
  kz125: "Vom Finanzamt erstattete Umsatzsteuer",
  kz185: "Summe Betriebseinnahmen",
  // Ausgaben
  kz210: "Waren, Rohstoffe, Hilfsstoffe",
  kz220: "Bezogene Fremdleistungen",
  kz230: "Gehaelter / Loehne",
  kz240: "Soziale Abgaben",
  kz250: "Abschreibungen (AfA)",
  kz260: "Raumkosten / Miete",
  kz270: "Sonstige Grundstuecksaufwendungen",
  kz280: "Kfz-Kosten",
  kz285: "Reisekosten",
  kz290: "Bewirtungskosten (70% abzugsfaehig)",
  kz295: "Geschenke",
  kz300: "Telefon / Internet",
  kz310: "Porto",
  kz315: "Buerobedarf",
  kz320: "Rechts- und Beratungskosten",
  kz325: "Versicherungen",
  kz330: "Beitraege",
  kz340: "Werbekosten",
  kz345: "Schulungen / Fortbildung",
  kz350: "Nebenkosten des Geldverkehrs",
  kz355: "Sonstige Betriebsausgaben",
  kz359: "Gezahlte Vorsteuer",
  kz360: "An das Finanzamt gezahlte USt",
  kz399: "Summe Betriebsausgaben",
}

function formatEuroCsv(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",")
}

/**
 * Formats EUeR data as a semicolon-separated CSV suitable for
 * spreadsheet import or as a preparation document for the Steuerberater.
 */
export function formatEUERAsCSV(data: EUERData): string {
  const lines: string[] = []

  lines.push(`Anlage EUER ${data.year}`)
  lines.push("")
  lines.push("KZ;Bezeichnung;Betrag (EUR)")
  lines.push("")

  // Betriebseinnahmen
  lines.push(";;Betriebseinnahmen")
  const einnahmenKeys: (keyof typeof data.einnahmen)[] = [
    "kz111", "kz112", "kz113", "kz114", "kz120", "kz125", "kz185",
  ]
  for (const key of einnahmenKeys) {
    const kzNum = key.replace("kz", "")
    const label = KZ_LABELS[key] ?? key
    const value = data.einnahmen[key]
    lines.push(`${kzNum};${label};${formatEuroCsv(value)}`)
  }

  lines.push("")

  // Betriebsausgaben
  lines.push(";;Betriebsausgaben")
  const ausgabenKeys: (keyof typeof data.ausgaben)[] = [
    "kz210", "kz220", "kz230", "kz240", "kz250", "kz260", "kz270",
    "kz280", "kz285", "kz290", "kz295", "kz300", "kz310", "kz315",
    "kz320", "kz325", "kz330", "kz340", "kz345", "kz350", "kz355",
    "kz359", "kz360", "kz399",
  ]
  for (const key of ausgabenKeys) {
    const kzNum = key.replace("kz", "")
    const label = KZ_LABELS[key] ?? key
    const value = data.ausgaben[key]
    lines.push(`${kzNum};${label};${formatEuroCsv(value)}`)
  }

  lines.push("")

  // Gewinn / Verlust
  const resultLabel = data.gewinnVerlust >= 0 ? "Gewinn" : "Verlust"
  lines.push(`;;${resultLabel}`)
  lines.push(`;Gewinn / Verlust (KZ 185 - KZ 399);${formatEuroCsv(data.gewinnVerlust)}`)

  return lines.join("\r\n")
}
