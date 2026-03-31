import { prisma } from "@/lib/db"
import { format } from "date-fns"
import type { Transaction, Category } from "@/prisma/client"

/**
 * DATEV EXTF_Buchungsstapel CSV export format.
 * Compatible with DATEV Unternehmen Online and direct import into DATEV.
 *
 * Format spec: DATEV-Format-Beschreibung (Buchungsstapel v12)
 * Encoding: Windows-1252 (handled via BOM + encoding)
 * Separator: Semicolon
 * Line ending: CR+LF
 */

export type ChartOfAccounts = "SKR03" | "SKR04"

// SKR03 account mappings
const SKR03_ACCOUNTS: Record<string, string> = {
  // Revenue
  income: "8400",           // Erlöse 19% USt
  income_7: "8300",         // Erlöse 7% USt
  income_0: "8100",         // Steuerfreie Erlöse
  // Expenses
  office: "6815",           // Büromaterial
  travel: "6670",           // Reisekosten Arbeitnehmer
  travel_self: "6650",      // Reisekosten Unternehmer
  software: "6830",         // Sonstige betriebliche Aufwendungen (Software/IT)
  hosting: "6830",          // IT-Kosten
  food: "6670",             // Bewirtungskosten
  insurance: "6430",        // Versicherungen
  tax: "7680",              // Sonstige Steuern
  salary: "6000",           // Löhne und Gehälter
  rent: "6310",             // Miete
  telecom: "6805",          // Telefon/Internet
  advertising: "6600",      // Werbekosten
  vehicle: "6520",          // Kfz-Kosten
  postage: "6800",          // Porto
  training: "6821",         // Fortbildung
  legal: "6825",            // Rechts- und Beratungskosten
  accounting: "6827",       // Buchführungskosten
  depreciation: "6220",     // AfA auf Sachanlagen
  interest: "7300",         // Zinsen und ähnliche Aufwendungen
  bank_fees: "6855",        // Nebenkosten des Geldverkehrs
  gifts: "6610",            // Geschenke abzugsfähig
  repair: "6470",           // Reparaturen
  cleaning: "6330",         // Reinigungskosten
  default_expense: "6300",  // Sonstige betriebliche Aufwendungen
  default_income: "8400",   // Erlöse 19% USt
  // Bank accounts
  bank: "1200",             // Bank
  cash: "1000",             // Kasse
}

// SKR04 account mappings
const SKR04_ACCOUNTS: Record<string, string> = {
  // Revenue
  income: "4400",           // Erlöse 19% USt
  income_7: "4300",         // Erlöse 7% USt
  income_0: "4100",         // Steuerfreie Erlöse
  // Expenses
  office: "6815",           // Büromaterial
  travel: "6670",           // Reisekosten Arbeitnehmer
  travel_self: "6650",      // Reisekosten Unternehmer
  software: "6830",         // IT-Kosten / Software
  hosting: "6830",          // IT-Kosten
  food: "6640",             // Bewirtungskosten
  insurance: "6430",        // Versicherungen
  tax: "7680",              // Sonstige Steuern
  salary: "6000",           // Löhne und Gehälter
  rent: "6310",             // Miete und Nebenkosten
  telecom: "6805",          // Telefon/Internet
  advertising: "6600",      // Werbekosten
  vehicle: "6520",          // Kfz-Kosten
  postage: "6800",          // Porto
  training: "6821",         // Fortbildung
  legal: "6825",            // Rechts- und Beratungskosten
  accounting: "6827",       // Buchführungskosten
  depreciation: "6220",     // AfA auf Sachanlagen
  interest: "7300",         // Zinsen und ähnliche Aufwendungen
  bank_fees: "6855",        // Nebenkosten des Geldverkehrs
  gifts: "6610",            // Geschenke abzugsfähig
  repair: "6470",           // Reparaturen
  cleaning: "6330",         // Reinigungskosten
  default_expense: "6300",  // Sonstige betriebliche Aufwendungen
  default_income: "4400",   // Erlöse 19% USt
  // Bank accounts
  bank: "1800",             // Bank
  cash: "1600",             // Kasse
}

function getAccountMap(chart: ChartOfAccounts): Record<string, string> {
  return chart === "SKR04" ? SKR04_ACCOUNTS : SKR03_ACCOUNTS
}

const DATEV_COLUMN_HEADERS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Kurs",
  "Basis-Umsatz",
  "WKZ Basis-Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Belegfeld 2",
  "Skonto",
  "Buchungstext",
  "Postensperre",
  "Diverse Adressnummer",
  "Geschäftspartnerbank",
  "Sachverhalt",
  "Zinssperre",
  "Beleglink",
  "Beleginfo - Art 1",
  "Beleginfo - Inhalt 1",
  "Beleginfo - Art 2",
  "Beleginfo - Inhalt 2",
  "Beleginfo - Art 3",
  "Beleginfo - Inhalt 3",
  "Beleginfo - Art 4",
  "Beleginfo - Inhalt 4",
  "Beleginfo - Art 5",
  "Beleginfo - Inhalt 5",
  "Beleginfo - Art 6",
  "Beleginfo - Inhalt 6",
  "Beleginfo - Art 7",
  "Beleginfo - Inhalt 7",
  "Beleginfo - Art 8",
  "Beleginfo - Inhalt 8",
  "KOST1 - Kostenstelle",
  "KOST2 - Kostenstelle",
  "Kost-Menge",
  "EU-Land u. UStID",
  "EU-Steuersatz",
  "Abw. Versteuerungsart",
  "Sachverhalt L+L",
  "Funktionsergänzung L+L",
  "BU 49 Hauptfunktionstyp",
  "BU 49 Hauptfunktionsnummer",
  "BU 49 Funktionsergänzung",
  "Zusatzinformation - Art 1",
  "Zusatzinformation - Inhalt 1",
  "Zusatzinformation - Art 2",
  "Zusatzinformation - Inhalt 2",
  "Zusatzinformation - Art 3",
  "Zusatzinformation - Inhalt 3",
  "Zusatzinformation - Art 4",
  "Zusatzinformation - Inhalt 4",
  "Zusatzinformation - Art 5",
  "Zusatzinformation - Inhalt 5",
  "Zusatzinformation - Art 6",
  "Zusatzinformation - Inhalt 6",
  "Zusatzinformation - Art 7",
  "Zusatzinformation - Inhalt 7",
  "Zusatzinformation - Art 8",
  "Zusatzinformation - Inhalt 8",
  "Zusatzinformation - Art 9",
  "Zusatzinformation - Inhalt 9",
  "Zusatzinformation - Art 10",
  "Zusatzinformation - Inhalt 10",
  "Zusatzinformation - Art 11",
  "Zusatzinformation - Inhalt 11",
  "Zusatzinformation - Art 12",
  "Zusatzinformation - Inhalt 12",
  "Zusatzinformation - Art 13",
  "Zusatzinformation - Inhalt 13",
  "Zusatzinformation - Art 14",
  "Zusatzinformation - Inhalt 14",
  "Zusatzinformation - Art 15",
  "Zusatzinformation - Inhalt 15",
  "Zusatzinformation - Art 16",
  "Zusatzinformation - Inhalt 16",
  "Zusatzinformation - Art 17",
  "Zusatzinformation - Inhalt 17",
  "Zusatzinformation - Art 18",
  "Zusatzinformation - Inhalt 18",
  "Zusatzinformation - Art 19",
  "Zusatzinformation - Inhalt 19",
  "Zusatzinformation - Art 20",
  "Zusatzinformation - Inhalt 20",
  "Stück",
  "Gewicht",
  "Zahlweise",
  "Forderungsart",
  "Veranlagungsjahr",
  "Zugeordnete Fälligkeit",
  "Skontotyp",
  "Auftragsnummer",
  "Buchungstyp",
  "USt-Schlüssel (Anzahlungen)",
  "EU-Land (Anzahlungen)",
  "Sachverhalt L+L (Anzahlungen)",
  "EU-Steuersatz (Anzahlungen)",
  "Erlöskonto (Anzahlungen)",
  "Herkunft-Kz",
  "Buchungs GUID",
  "KOST-Datum",
  "SEPA-Mandatsreferenz",
  "Skontosperre",
  "Gesellschaftername",
  "Beteiligtennummer",
  "Identifikationsnummer",
  "Zeichnernummer",
  "Postensperre bis",
  "Bezeichnung SoBil-Sachverhalt",
  "Kennzeichen SoBil-Buchung",
  "Festschreibung",
  "Leistungsdatum",
  "Datum Zuord. Steuerperiode",
  "Fälligkeit",
  "Generalumkehr (GU)",
  "Steuersatz",
  "Land",
]

function getDatevAccount(
  tx: Transaction & { category?: Category | null },
  accounts: Record<string, string>,
): string {
  if (tx.categoryCode) {
    const mapped = accounts[tx.categoryCode.toLowerCase()]
    if (mapped) return mapped
  }
  return tx.type === "income"
    ? accounts.default_income
    : accounts.default_expense
}

function formatDatevAmount(cents: number): string {
  const amount = Math.abs(cents) / 100
  return amount.toFixed(2).replace(".", ",")
}

function formatDatevDate(date: Date): string {
  // DATEV expects ddMM format for Belegdatum
  return format(date, "ddMM")
}

function escapeField(value: string): string {
  if (value.includes('"') || value.includes(";") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function transactionToDatevRow(
  tx: Transaction & { category?: Category | null },
  accounts: Record<string, string>,
): string[] {
  const amount = formatDatevAmount(tx.total || 0)
  const sollHaben = tx.type === "income" ? "H" : "S"
  const account = getDatevAccount(tx, accounts)
  const counterAccount = accounts.bank // Bank account as counter
  const belegDatum = tx.issuedAt ? formatDatevDate(tx.issuedAt) : ""
  const buchungstext = escapeField(
    [tx.merchant, tx.name].filter(Boolean).join(" - ").slice(0, 60)
  )
  // Belegfeld 1: unique reference for the booking (max 36 chars)
  const belegfeld1 = escapeField((tx.externalId || tx.id).slice(0, 36))

  // Build row with all DATEV columns (most empty)
  const row = new Array(DATEV_COLUMN_HEADERS.length).fill("")
  row[0] = amount                   // Umsatz
  row[1] = sollHaben                // S/H
  row[2] = tx.currencyCode || "EUR" // WKZ
  row[6] = account                  // Konto (Aufwand/Erlös)
  row[7] = counterAccount           // Gegenkonto (Bank)
  row[9] = belegDatum               // Belegdatum
  row[10] = belegfeld1              // Belegfeld 1
  row[13] = buchungstext            // Buchungstext
  row[97] = "AA"                    // Buchungstyp: Automatische Abrechnung

  // SEPA-Mandatsreferenz if available from FinTS
  if (tx.text) {
    const mandatMatch = tx.text.match(/Mandat:\s*(\S+)/)
    if (mandatMatch) {
      row[103] = escapeField(mandatMatch[1].slice(0, 35)) // SEPA-Mandatsreferenz
    }
  }

  // Festschreibung: 0 = not locked (allows Steuerberater to edit)
  row[114] = "0"

  return row
}

/**
 * Build the DATEV EXTF header row.
 * This header is mandatory for DATEV import and contains metadata.
 */
function buildDatevHeader(
  chart: ChartOfAccounts,
  dateFrom?: Date,
  dateTo?: Date,
  consultantNumber?: string,
  clientNumber?: string,
): string[] {
  const now = new Date()
  const fiscalYearStart = dateFrom
    ? format(new Date(dateFrom.getFullYear(), 0, 1), "yyyyMMdd")
    : format(new Date(now.getFullYear(), 0, 1), "yyyyMMdd")

  return [
    "EXTF",                                     // 1: Format
    "700",                                      // 2: Version
    "21",                                       // 3: Category (21 = Buchungsstapel)
    "Buchungsstapel",                           // 4: Format name
    "12",                                       // 5: Format version
    format(now, "yyyyMMddHHmmss") + "000",      // 6: Created timestamp
    "",                                         // 7: Imported (empty)
    "RE",                                       // 8: Origin/Source ("RE" = Rechnungswesen)
    "",                                         // 9: Exported by
    "",                                         // 10: Imported by
    consultantNumber || "10000",                // 11: Beraternummer (required)
    clientNumber || "10001",                    // 12: Mandantennummer (required)
    fiscalYearStart,                            // 13: WJ-Beginn (fiscal year start)
    "4",                                        // 14: Sachkontenlänge (4 digits)
    dateFrom ? format(dateFrom, "yyyyMMdd") : "",  // 15: Datum von
    dateTo ? format(dateTo, "yyyyMMdd") : "",      // 16: Datum bis
    "",                                         // 17: Bezeichnung
    "",                                         // 18: Diktatkürzel
    "1",                                        // 19: Buchungstyp (1 = Finanzbuchführung)
    "0",                                        // 20: Rechnungslegungszweck (0 = unbestimmt)
    "0",                                        // 21: Festschreibung (0 = nein)
    "EUR",                                      // 22: WKZ
    "",                                         // 23: Reserved
    "",                                         // 24: Derivat
    "",                                         // 25: Reserved
    "",                                         // 26: Reserved
    "",                                         // 27: Reserved
    chart === "SKR04" ? "04" : "03",            // 28: SKR (Kontenrahmen)
    "",                                         // 29: Branchen-Lösung
    "",                                         // 30: Reserved
    "taxhacker-fints-export",                   // 31: Anwendungsinfo
  ]
}

export async function generateDatevExport(
  userId: string,
  dateFrom?: Date,
  dateTo?: Date,
  chart: ChartOfAccounts = "SKR04",
  consultantNumber?: string,
  clientNumber?: string,
): Promise<string> {
  const where: any = { userId }

  if (dateFrom || dateTo) {
    where.issuedAt = {}
    if (dateFrom) where.issuedAt.gte = dateFrom
    if (dateTo) where.issuedAt.lte = dateTo
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true },
    orderBy: { issuedAt: "asc" },
  })

  const accounts = getAccountMap(chart)
  const lines: string[] = []

  // Header row (mandatory for DATEV import)
  const header = buildDatevHeader(chart, dateFrom, dateTo, consultantNumber, clientNumber)
  lines.push(header.join(";"))

  // Column headers
  lines.push(DATEV_COLUMN_HEADERS.join(";"))

  // Data rows
  for (const tx of transactions) {
    if (!tx.total) continue
    const row = transactionToDatevRow(tx, accounts)
    lines.push(row.join(";"))
  }

  // DATEV requires CR+LF line endings
  return lines.join("\r\n")
}
