import { prisma } from "@/lib/db"
import { format } from "date-fns"
import type { Transaction, Category } from "@/prisma/client"

/**
 * DATEV EXTF_Buchungsstapel CSV export format.
 * Compatible with DATEV Unternehmen Online, Sage, Lexware, and most German tax advisors.
 *
 * Format spec: DATEV-Format-Beschreibung (Buchungsstapel v12)
 */

const DATEV_HEADER_ROW = [
  "EXTF", "700", "21", "Buchungsstapel", "12", // format info
  "", "", "", "", // created date, imported, origin, exported
  "", // consultant number
  "", // client number
  "", // fiscal year start
  "4", // account length
  "", "", // date from, date to
  "", // description
  "", "", "", // dictation shortcut, booking type, intent
  "", // locking
  "", // currency
  "", "", // reserved
  "", // derivation
  "", "", "", "", // reserved
  "taxhacker-fints-export", // application info
]

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

// Standard DATEV account mapping (SKR03)
const CATEGORY_TO_DATEV_ACCOUNT: Record<string, string> = {
  // Revenue accounts
  income: "8400",
  // Expense accounts (common ones)
  office: "6815",
  travel: "6670",
  software: "6830",
  hosting: "6830",
  food: "6670",
  insurance: "6430",
  tax: "7680",
  salary: "6000",
  rent: "6310",
  telecom: "6805",
  advertising: "6600",
  // Default
  default_expense: "6300",
  default_income: "8400",
}

function getDatevAccount(tx: Transaction & { category?: Category | null }): string {
  if (tx.categoryCode) {
    const mapped = CATEGORY_TO_DATEV_ACCOUNT[tx.categoryCode.toLowerCase()]
    if (mapped) return mapped
  }
  return tx.type === "income"
    ? CATEGORY_TO_DATEV_ACCOUNT.default_income
    : CATEGORY_TO_DATEV_ACCOUNT.default_expense
}

function formatDatevAmount(cents: number): string {
  const amount = Math.abs(cents) / 100
  return amount.toFixed(2).replace(".", ",")
}

function formatDatevDate(date: Date): string {
  return format(date, "ddMM")
}

function escapeField(value: string): string {
  if (value.includes('"') || value.includes(";") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function transactionToDatevRow(tx: Transaction & { category?: Category | null }): string[] {
  const amount = formatDatevAmount(tx.total || 0)
  const sollHaben = tx.type === "income" ? "H" : "S"
  const account = getDatevAccount(tx)
  const counterAccount = "1200" // Default: Bank account (SKR03)
  const belegDatum = tx.issuedAt ? formatDatevDate(tx.issuedAt) : ""
  const buchungstext = escapeField(
    [tx.merchant, tx.name].filter(Boolean).join(" - ").slice(0, 60)
  )

  // Build row with all DATEV columns (most empty)
  const row = new Array(DATEV_COLUMN_HEADERS.length).fill("")
  row[0] = amount
  row[1] = sollHaben
  row[2] = tx.currencyCode || "EUR"
  row[6] = account
  row[7] = counterAccount
  row[9] = belegDatum
  row[10] = tx.externalId?.slice(0, 36) || tx.id.slice(0, 36)
  row[13] = buchungstext

  return row
}

export async function generateDatevExport(
  userId: string,
  dateFrom?: Date,
  dateTo?: Date,
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

  const lines: string[] = []

  // Header row
  const header = [...DATEV_HEADER_ROW]
  if (dateFrom) header[14] = format(dateFrom, "yyyyMMdd")
  if (dateTo) header[15] = format(dateTo, "yyyyMMdd")
  header[8] = format(new Date(), "yyyyMMddHHmmss") + "000"
  lines.push(header.join(";"))

  // Column headers
  lines.push(DATEV_COLUMN_HEADERS.join(";"))

  // Data rows
  for (const tx of transactions) {
    if (!tx.total) continue
    const row = transactionToDatevRow(tx)
    lines.push(row.join(";"))
  }

  return lines.join("\r\n")
}
