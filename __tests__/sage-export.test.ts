import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

import { generateSageBuchungsstapel, transactionToSageBuchung, formatSageBuchungRow, SAGE_TAX_KEYS } from "@/lib/sage/buchungsstapel-export"
import { generateDebitoren, generateKreditoren, generateArtikelstamm } from "@/lib/sage/stammdaten-export"
import { generateGDPdUIndex, generateGDPdUExport } from "@/lib/sage/gdpdu-export"
import { prisma } from "@/lib/db"

const mockedFindMany = vi.mocked(prisma.transaction.findMany)

function makeTx(overrides: Record<string, any> = {}): any {
  return {
    id: "tx-001",
    userId: "user-1",
    externalId: "ext-001",
    name: "Test Transaction",
    merchant: "ACME Corp",
    total: 11900, // 119.00 EUR in cents
    currencyCode: "EUR",
    type: "expense",
    categoryCode: "office",
    issuedAt: new Date("2025-03-15"),
    text: null,
    category: null,
    ...overrides,
  }
}

describe("Buchungsstapel CSV format", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("produces correct header row", async () => {
    mockedFindMany.mockResolvedValue([])
    const csv = await generateSageBuchungsstapel("user-1")
    const header = csv.split("\r\n")[0]
    expect(header).toBe("Belegdatum;Belegnummer;Buchungstext;Sollkonto;Habenkonto;Betrag;USt;Kostenstelle")
  })

  it("uses semicolons as separators", async () => {
    mockedFindMany.mockResolvedValue([makeTx()])
    const csv = await generateSageBuchungsstapel("user-1")
    const dataRow = csv.split("\r\n")[1]
    expect(dataRow.split(";").length).toBe(8)
  })

  it("formats dates as DD.MM.YYYY", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ issuedAt: new Date("2025-07-20") })])
    const csv = await generateSageBuchungsstapel("user-1")
    const dataRow = csv.split("\r\n")[1]
    const fields = dataRow.split(";")
    expect(fields[0]).toBe("20.07.2025")
  })

  it("formats amounts with comma decimal", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ total: 12345 })])
    const csv = await generateSageBuchungsstapel("user-1")
    const dataRow = csv.split("\r\n")[1]
    const fields = dataRow.split(";")
    expect(fields[5]).toBe("123,45")
  })

  it("uses CR+LF line endings", async () => {
    mockedFindMany.mockResolvedValue([makeTx()])
    const csv = await generateSageBuchungsstapel("user-1")
    expect(csv).toContain("\r\n")
    const withoutCrLf = csv.replace(/\r\n/g, "")
    expect(withoutCrLf).not.toContain("\n")
  })

  it("skips transactions with zero total", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ id: "tx-1", total: 0 }),
      makeTx({ id: "tx-2", total: 5000 }),
    ])
    const csv = await generateSageBuchungsstapel("user-1")
    const rows = csv.split("\r\n")
    expect(rows.length).toBe(2) // header + 1 data row
  })
})

describe("Steuerschlüssel mapping", () => {
  it("maps 19% to key 3", () => {
    expect(SAGE_TAX_KEYS["19"]).toBe("3")
  })

  it("maps 7% to key 2", () => {
    expect(SAGE_TAX_KEYS["7"]).toBe("2")
  })

  it("maps 0% to key 0", () => {
    expect(SAGE_TAX_KEYS["0"]).toBe("0")
  })

  it("assigns tax key 0 for bank_fees", () => {
    const tx = makeTx({ categoryCode: "bank_fees" })
    const buchung = transactionToSageBuchung(tx)
    expect(buchung.Steuerschlüssel).toBe("0")
  })

  it("assigns tax key 2 for income_7", () => {
    const tx = makeTx({ type: "income", categoryCode: "income_7" })
    const buchung = transactionToSageBuchung(tx)
    expect(buchung.Steuerschlüssel).toBe("2")
  })

  it("defaults to tax key 3 (19%) for normal expenses", () => {
    const tx = makeTx({ categoryCode: "office" })
    const buchung = transactionToSageBuchung(tx)
    expect(buchung.Steuerschlüssel).toBe("3")
  })
})

describe("Soll/Haben determination", () => {
  it("expense: Sollkonto is expense account, Habenkonto is bank", () => {
    const tx = makeTx({ type: "expense", categoryCode: "office" })
    const buchung = transactionToSageBuchung(tx)
    expect(buchung.Sollkonto).toBe("6815") // office SKR04
    expect(buchung.Habenkonto).toBe("1800") // bank SKR04
  })

  it("income: Sollkonto is bank, Habenkonto is revenue account", () => {
    const tx = makeTx({ type: "income", categoryCode: "income" })
    const buchung = transactionToSageBuchung(tx)
    expect(buchung.Sollkonto).toBe("1800") // bank SKR04
    expect(buchung.Habenkonto).toBe("4400") // income SKR04
  })
})

describe("Amount formatting", () => {
  it("always produces positive amounts", () => {
    const tx = makeTx({ total: -5000 })
    const buchung = transactionToSageBuchung(tx)
    expect(buchung.Betrag).toBe("50,00")
  })

  it("handles small amounts correctly", () => {
    const tx = makeTx({ total: 99 })
    const buchung = transactionToSageBuchung(tx)
    expect(buchung.Betrag).toBe("0,99")
  })

  it("handles large amounts correctly", () => {
    const tx = makeTx({ total: 999999 })
    const buchung = transactionToSageBuchung(tx)
    expect(buchung.Betrag).toBe("9999,99")
  })
})

describe("Debitoren number ranges", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("starts Debitorennummer at 10000", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ merchant: "Kunde A", type: "income" })])
    const csv = await generateDebitoren("user-1")
    const rows = csv.split("\r\n")
    const fields = rows[1].split(";")
    expect(fields[0]).toBe("10000")
  })

  it("increments Debitorennummer sequentially", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ merchant: "Kunde A", type: "income" }),
      makeTx({ merchant: "Kunde B", type: "income" }),
      makeTx({ merchant: "Kunde C", type: "income" }),
    ])
    const csv = await generateDebitoren("user-1")
    const rows = csv.split("\r\n")
    expect(rows[1].split(";")[0]).toBe("10000")
    expect(rows[2].split(";")[0]).toBe("10001")
    expect(rows[3].split(";")[0]).toBe("10002")
  })
})

describe("Kreditoren number ranges", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("starts Kreditorennummer at 70000", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ merchant: "Lieferant A", type: "expense" })])
    const csv = await generateKreditoren("user-1")
    const rows = csv.split("\r\n")
    const fields = rows[1].split(";")
    expect(fields[0]).toBe("70000")
  })

  it("has correct header for Kreditoren", async () => {
    mockedFindMany.mockResolvedValue([])
    const csv = await generateKreditoren("user-1")
    const header = csv.split("\r\n")[0]
    expect(header).toBe("Kreditorennummer;Name1;Name2;Straße;PLZ;Ort;Land;UStIdNr;Zahlungsziel")
  })
})

describe("GDPdU index.xml structure", () => {
  it("generates valid XML with version 1.0", () => {
    const xml = generateGDPdUIndex([])
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain("<Version>1.0</Version>")
  })

  it("includes DataSupplier information", () => {
    const xml = generateGDPdUIndex([])
    expect(xml).toContain("<DataSupplier>")
    expect(xml).toContain("<Name>TaxHacker</Name>")
  })

  it("includes table definitions with column details", () => {
    const tables = [{
      name: "TestTable",
      description: "Test",
      filename: "test.csv",
      columns: [
        { name: "Col1", description: "Column 1", type: "AlphaNumeric" as const, maxLength: 10 },
        { name: "Col2", description: "Column 2", type: "Numeric" as const },
        { name: "Col3", description: "Column 3", type: "Date" as const, dateFormat: "DD.MM.YYYY" },
      ],
    }]
    const xml = generateGDPdUIndex(tables)
    expect(xml).toContain("<Name>TestTable</Name>")
    expect(xml).toContain("<URL>test.csv</URL>")
    expect(xml).toContain("<Name>Col1</Name>")
    expect(xml).toContain("<AlphaNumeric/>")
    expect(xml).toContain("<DecimalSymbol>,</DecimalSymbol>")
    expect(xml).toContain("<Format>DD.MM.YYYY</Format>")
  })

  it("uses semicolon as ColumnDelimiter", () => {
    const tables = [{
      name: "T",
      description: "T",
      filename: "t.csv",
      columns: [],
    }]
    const xml = generateGDPdUIndex(tables)
    expect(xml).toContain("<ColumnDelimiter>;</ColumnDelimiter>")
  })
})

describe("GDPdU full export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns all four files", async () => {
    mockedFindMany.mockResolvedValue([])
    const pkg = await generateGDPdUExport("user-1", new Date("2025-01-01"), new Date("2025-12-31"))
    expect(pkg).toHaveProperty("index.xml")
    expect(pkg).toHaveProperty("buchungen.csv")
    expect(pkg).toHaveProperty("debitoren.csv")
    expect(pkg).toHaveProperty("kreditoren.csv")
  })

  it("index.xml references all CSV files", async () => {
    mockedFindMany.mockResolvedValue([])
    const pkg = await generateGDPdUExport("user-1", new Date("2025-01-01"), new Date("2025-12-31"))
    expect(pkg["index.xml"]).toContain("buchungen.csv")
    expect(pkg["index.xml"]).toContain("debitoren.csv")
    expect(pkg["index.xml"]).toContain("kreditoren.csv")
  })
})

describe("Empty data handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("Buchungsstapel returns only header when no transactions", async () => {
    mockedFindMany.mockResolvedValue([])
    const csv = await generateSageBuchungsstapel("user-1")
    const rows = csv.split("\r\n")
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain("Belegdatum")
  })

  it("Debitoren returns only header when no income merchants", async () => {
    mockedFindMany.mockResolvedValue([])
    const csv = await generateDebitoren("user-1")
    const rows = csv.split("\r\n")
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain("Debitorennummer")
  })

  it("Kreditoren returns only header when no expense merchants", async () => {
    mockedFindMany.mockResolvedValue([])
    const csv = await generateKreditoren("user-1")
    const rows = csv.split("\r\n")
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain("Kreditorennummer")
  })

  it("Artikelstamm returns only header when no items", async () => {
    mockedFindMany.mockResolvedValue([])
    const csv = await generateArtikelstamm("user-1")
    const rows = csv.split("\r\n")
    expect(rows.length).toBe(1)
    expect(rows[0]).toContain("Artikelnummer")
  })

  it("skips merchants that are null", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ merchant: null, type: "income" }),
    ])
    const csv = await generateDebitoren("user-1")
    const rows = csv.split("\r\n")
    expect(rows.length).toBe(1) // header only
  })
})

describe("formatSageBuchungRow", () => {
  it("produces semicolon-separated string with 8 fields", () => {
    const tx = makeTx({ type: "expense", categoryCode: "office" })
    const buchung = transactionToSageBuchung(tx)
    const row = formatSageBuchungRow(buchung)
    expect(row.split(";").length).toBe(8)
  })

  it("escapes fields containing semicolons", () => {
    const tx = makeTx({ merchant: "Test;Company", name: "Item" })
    const buchung = transactionToSageBuchung(tx)
    const row = formatSageBuchungRow(buchung)
    expect(row).toContain('"Test;Company - Item"')
  })
})
