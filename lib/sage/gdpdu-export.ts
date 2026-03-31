import { generateSageBuchungsstapel } from "@/lib/sage/buchungsstapel-export"
import { generateDebitoren, generateKreditoren } from "@/lib/sage/stammdaten-export"

/**
 * GDPdU (Grundsätze zum Datenzugriff und zur Prüfbarkeit digitaler Unterlagen)
 * / GoBD compliant export for tax audits.
 *
 * Also used by Sage Warenwirtschaft 7.1 for data import/export.
 * Generates an index.xml describing the data structure plus CSV data files.
 *
 * Specification: GDPdU v1.0
 */

export type GDPdUTable = {
  name: string
  description: string
  filename: string
  columns: GDPdUColumn[]
}

export type GDPdUColumn = {
  name: string
  description: string
  type: "AlphaNumeric" | "Numeric" | "Date"
  maxLength?: number
  dateFormat?: string
}

const BUCHUNGEN_TABLE: GDPdUTable = {
  name: "Buchungen",
  description: "Buchungsstapel - Alle Geschäftsvorfälle",
  filename: "buchungen.csv",
  columns: [
    { name: "Belegdatum", description: "Datum des Belegs", type: "Date", dateFormat: "DD.MM.YYYY" },
    { name: "Belegnummer", description: "Eindeutige Belegnummer", type: "AlphaNumeric", maxLength: 20 },
    { name: "Buchungstext", description: "Beschreibung der Buchung", type: "AlphaNumeric", maxLength: 60 },
    { name: "Sollkonto", description: "Sollkonto (SKR04)", type: "AlphaNumeric", maxLength: 6 },
    { name: "Habenkonto", description: "Habenkonto (SKR04)", type: "AlphaNumeric", maxLength: 6 },
    { name: "Betrag", description: "Buchungsbetrag in EUR", type: "Numeric" },
    { name: "USt", description: "Steuerschlüssel", type: "AlphaNumeric", maxLength: 2 },
    { name: "Kostenstelle", description: "Kostenstelle", type: "AlphaNumeric", maxLength: 10 },
  ],
}

const DEBITOREN_TABLE: GDPdUTable = {
  name: "Debitoren",
  description: "Debitorenstammdaten (Kunden)",
  filename: "debitoren.csv",
  columns: [
    { name: "Debitorennummer", description: "Debitorennummer", type: "AlphaNumeric", maxLength: 10 },
    { name: "Name1", description: "Name Zeile 1", type: "AlphaNumeric", maxLength: 50 },
    { name: "Name2", description: "Name Zeile 2", type: "AlphaNumeric", maxLength: 50 },
    { name: "Straße", description: "Straße und Hausnummer", type: "AlphaNumeric", maxLength: 50 },
    { name: "PLZ", description: "Postleitzahl", type: "AlphaNumeric", maxLength: 10 },
    { name: "Ort", description: "Ort", type: "AlphaNumeric", maxLength: 50 },
    { name: "Land", description: "Länderkennzeichen", type: "AlphaNumeric", maxLength: 3 },
    { name: "UStIdNr", description: "Umsatzsteuer-Identifikationsnummer", type: "AlphaNumeric", maxLength: 20 },
    { name: "Zahlungsziel", description: "Zahlungsziel in Tagen", type: "Numeric" },
  ],
}

const KREDITOREN_TABLE: GDPdUTable = {
  name: "Kreditoren",
  description: "Kreditorenstammdaten (Lieferanten)",
  filename: "kreditoren.csv",
  columns: [
    { name: "Kreditorennummer", description: "Kreditorennummer", type: "AlphaNumeric", maxLength: 10 },
    { name: "Name1", description: "Name Zeile 1", type: "AlphaNumeric", maxLength: 50 },
    { name: "Name2", description: "Name Zeile 2", type: "AlphaNumeric", maxLength: 50 },
    { name: "Straße", description: "Straße und Hausnummer", type: "AlphaNumeric", maxLength: 50 },
    { name: "PLZ", description: "Postleitzahl", type: "AlphaNumeric", maxLength: 10 },
    { name: "Ort", description: "Ort", type: "AlphaNumeric", maxLength: 50 },
    { name: "Land", description: "Länderkennzeichen", type: "AlphaNumeric", maxLength: 3 },
    { name: "UStIdNr", description: "Umsatzsteuer-Identifikationsnummer", type: "AlphaNumeric", maxLength: 20 },
    { name: "Zahlungsziel", description: "Zahlungsziel in Tagen", type: "Numeric" },
  ],
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function columnToXml(col: GDPdUColumn, indent: string): string {
  const lines: string[] = []
  lines.push(`${indent}<VariableColumn>`)
  lines.push(`${indent}  <Name>${escapeXml(col.name)}</Name>`)
  lines.push(`${indent}  <Description>${escapeXml(col.description)}</Description>`)

  if (col.type === "Numeric") {
    lines.push(`${indent}  <Numeric>`)
    lines.push(`${indent}    <DecimalSymbol>,</DecimalSymbol>`)
    lines.push(`${indent}    <DigitGroupingSymbol></DigitGroupingSymbol>`)
    lines.push(`${indent}  </Numeric>`)
  } else if (col.type === "Date") {
    lines.push(`${indent}  <Date>`)
    lines.push(`${indent}    <Format>${col.dateFormat || "DD.MM.YYYY"}</Format>`)
    lines.push(`${indent}  </Date>`)
  } else {
    lines.push(`${indent}  <AlphaNumeric/>`)
    if (col.maxLength) {
      lines.push(`${indent}  <MaxLength>${col.maxLength}</MaxLength>`)
    }
  }

  lines.push(`${indent}</VariableColumn>`)
  return lines.join("\n")
}

export function generateGDPdUIndex(tables: GDPdUTable[]): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">')
  lines.push("<DataSet>")
  lines.push("  <Version>1.0</Version>")
  lines.push("  <DataSupplier>")
  lines.push("    <Name>TaxHacker</Name>")
  lines.push("    <Location>Sage 7.1 kompatibel</Location>")
  lines.push("    <Comment>GDPdU/GoBD-konformer Datenexport</Comment>")
  lines.push("  </DataSupplier>")
  lines.push("  <Media>")
  lines.push("    <Name>Datenexport</Name>")

  for (const table of tables) {
    lines.push("    <Table>")
    lines.push(`      <URL>${escapeXml(table.filename)}</URL>`)
    lines.push(`      <Name>${escapeXml(table.name)}</Name>`)
    lines.push(`      <Description>${escapeXml(table.description)}</Description>`)
    lines.push("      <Validity>")
    lines.push("        <Range>")
    lines.push("          <From>20000101</From>")
    lines.push("          <To>20991231</To>")
    lines.push("        </Range>")
    lines.push("      </Validity>")
    lines.push("      <DecimalSymbol>,</DecimalSymbol>")
    lines.push("      <DigitGroupingSymbol></DigitGroupingSymbol>")
    lines.push("      <VariableLength>")
    lines.push("        <ColumnDelimiter>;</ColumnDelimiter>")
    lines.push("        <RecordDelimiter>&#13;&#10;</RecordDelimiter>")
    lines.push("        <TextEncapsulator>&quot;</TextEncapsulator>")

    for (const col of table.columns) {
      lines.push(columnToXml(col, "        "))
    }

    lines.push("      </VariableLength>")
    lines.push("    </Table>")
  }

  lines.push("  </Media>")
  lines.push("</DataSet>")

  return lines.join("\n")
}

export type GDPdUPackage = {
  "index.xml": string
  "buchungen.csv": string
  "debitoren.csv": string
  "kreditoren.csv": string
}

export async function generateGDPdUExport(
  userId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<GDPdUPackage> {
  const [buchungen, debitoren, kreditoren] = await Promise.all([
    generateSageBuchungsstapel(userId, dateFrom, dateTo),
    generateDebitoren(userId),
    generateKreditoren(userId),
  ])

  const tables = [BUCHUNGEN_TABLE, DEBITOREN_TABLE, KREDITOREN_TABLE]
  const indexXml = generateGDPdUIndex(tables)

  return {
    "index.xml": indexXml,
    "buchungen.csv": buchungen,
    "debitoren.csv": debitoren,
    "kreditoren.csv": kreditoren,
  }
}
