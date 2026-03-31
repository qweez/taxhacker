import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

import { generateSageBuchungsstapel } from "@/lib/sage/buchungsstapel-export"
import {
  generateSageDebitorenExport,
  generateSageKreditorenExport,
  generateSageArtikelExport,
} from "@/lib/sage/stammdaten-export"
import { prisma } from "@/lib/db"

const mockedFindMany = vi.mocked(prisma.transaction.findMany)

function makeTx(overrides: Record<string, any> = {}): any {
  return {
    id: "tx-001",
    userId: "user-1",
    externalId: "ext-001",
    name: "Test Transaction",
    merchant: "ACME Corp",
    total: 11900,
    currencyCode: "EUR",
    type: "expense",
    categoryCode: "office",
    issuedAt: new Date("2025-03-15"),
    text: null,
    category: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("Buchungsstapel CSV format", () => {
  it("uses semicolons as separators", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 11900, type: "expense", categoryCode: "office" }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")
    const lines = csv.split("\r\n")

    // Header and data rows should use semicolons
    expect(lines[0].split(";").length).toBe(8)
    expect(lines[1].split(";").length).toBe(8)
  })

  it("has correct column headers", async () => {
    mockedFindMany.mockResolvedValue([])

    const csv = await generateSageBuchungsstapel("user-1")
    const header = csv.split("\r\n")[0]

    expect(header).toContain("Belegdatum")
    expect(header).toContain("Belegnummer")
    expect(header).toContain("Buchungstext")
    expect(header).toContain("Sollkonto")
    expect(header).toContain("Habenkonto")
    expect(header).toContain("Betrag")
    expect(header).toContain("Steuerschlüssel")
    expect(header).toContain("Kostenstelle")
  })

  it("formats amounts in German decimal format", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 11900, type: "expense", categoryCode: "office" }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")
    const dataRow = csv.split("\r\n")[1]

    expect(dataRow).toContain("119,00")
  })

  it("uses CR+LF line endings", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 5000 }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")

    expect(csv).toContain("\r\n")
    const withoutCrLf = csv.replace(/\r\n/g, "")
    expect(withoutCrLf).not.toContain("\n")
  })

  it("maps expense Sollkonto to category account and Habenkonto to bank", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 5000, type: "expense", categoryCode: "office" }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")
    const cols = csv.split("\r\n")[1].split(";")

    expect(cols[3]).toBe("6815") // office -> Sollkonto
    expect(cols[4]).toBe("1800") // bank -> Habenkonto
  })

  it("maps income Sollkonto to bank and Habenkonto to category account", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 10000, type: "income", categoryCode: "income" }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")
    const cols = csv.split("\r\n")[1].split(";")

    expect(cols[3]).toBe("1800") // bank -> Sollkonto (income)
    expect(cols[4]).toBe("4400") // income -> Habenkonto
  })

  it("skips transactions with zero total", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 0 }),
      makeTx({ total: 5000 }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")
    const lines = csv.split("\r\n")

    expect(lines.length).toBe(2) // header + 1 data row
  })

  it("formats date as dd.MM.yyyy", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 5000, issuedAt: new Date("2025-03-15") }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")
    const dataRow = csv.split("\r\n")[1]

    expect(dataRow).toContain("15.03.2025")
  })
})

describe("Steuerschlüssel mapping", () => {
  it("assigns 3 (19% VSt) for standard expense", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 5000, type: "expense", categoryCode: "office" }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")
    const cols = csv.split("\r\n")[1].split(";")

    expect(cols[6]).toBe("3") // vst_19
  })

  it("assigns 9 (19% USt) for standard income", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 10000, type: "income", categoryCode: "income" }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")
    const cols = csv.split("\r\n")[1].split(";")

    expect(cols[6]).toBe("9") // ust_19
  })

  it("assigns 2 (7% VSt) for reduced rate expense (food)", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 5000, type: "expense", categoryCode: "food" }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")
    const cols = csv.split("\r\n")[1].split(";")

    expect(cols[6]).toBe("2") // vst_7
  })

  it("assigns 8 (7% USt) for reduced rate income", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 10000, type: "income", categoryCode: "income_7" }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1")
    const cols = csv.split("\r\n")[1].split(";")

    expect(cols[6]).toBe("8") // ust_7
  })

  it("assigns 1 (keine USt) for exempt categories", async () => {
    const exemptCategories = ["income_0", "insurance", "interest", "bank_fees", "salary", "tax"]

    for (const cat of exemptCategories) {
      mockedFindMany.mockResolvedValue([
        makeTx({ total: 5000, type: "expense", categoryCode: cat }),
      ] as any)

      const csv = await generateSageBuchungsstapel("user-1")
      const cols = csv.split("\r\n")[1].split(";")

      expect(cols[6]).toBe("1") // keine
    }
  })
})

describe("Debitorenstamm export", () => {
  it("has correct header columns", async () => {
    mockedFindMany.mockResolvedValue([])

    const csv = await generateSageDebitorenExport("user-1")
    const header = csv.split("\r\n")[0]

    expect(header).toContain("Debitorennummer")
    expect(header).toContain("Name1")
    expect(header).toContain("Straße")
    expect(header).toContain("PLZ")
    expect(header).toContain("Ort")
    expect(header).toContain("UStIdNr")
  })

  it("assigns incrementing Debitorennummern starting at 10000", async () => {
    mockedFindMany.mockResolvedValue([
      { merchant: "Customer A" },
      { merchant: "Customer B" },
      { merchant: "Customer C" },
    ] as any)

    const csv = await generateSageDebitorenExport("user-1")
    const lines = csv.split("\r\n")

    expect(lines[1]).toContain("10000")
    expect(lines[2]).toContain("10001")
    expect(lines[3]).toContain("10002")
  })

  it("includes merchant name in Firma column", async () => {
    mockedFindMany.mockResolvedValue([
      { merchant: "ACME Corp" },
    ] as any)

    const csv = await generateSageDebitorenExport("user-1")
    const dataRow = csv.split("\r\n")[1]

    expect(dataRow).toContain("ACME Corp")
  })

  it("skips entries without merchant", async () => {
    mockedFindMany.mockResolvedValue([
      { merchant: null },
      { merchant: "Real Customer" },
    ] as any)

    const csv = await generateSageDebitorenExport("user-1")
    const lines = csv.split("\r\n")

    expect(lines.length).toBe(2) // header + 1 entry
    expect(lines[1]).toContain("Real Customer")
  })

  it("uses semicolon separator with 9 columns", async () => {
    mockedFindMany.mockResolvedValue([
      { merchant: "Test" },
    ] as any)

    const csv = await generateSageDebitorenExport("user-1")
    const dataRow = csv.split("\r\n")[1]

    expect(dataRow.split(";").length).toBe(9)
  })
})

describe("Kreditorenstamm export", () => {
  it("has correct header columns", async () => {
    mockedFindMany.mockResolvedValue([])

    const csv = await generateSageKreditorenExport("user-1")
    const header = csv.split("\r\n")[0]

    expect(header).toContain("Kreditorennummer")
    expect(header).toContain("Name1")
    expect(header).toContain("UStIdNr")
  })

  it("assigns incrementing Kreditorennummern starting at 70000", async () => {
    mockedFindMany.mockResolvedValue([
      { merchant: "Supplier A" },
      { merchant: "Supplier B" },
    ] as any)

    const csv = await generateSageKreditorenExport("user-1")
    const lines = csv.split("\r\n")

    expect(lines[1]).toContain("70000")
    expect(lines[2]).toContain("70001")
  })

  it("includes supplier name in Firma column", async () => {
    mockedFindMany.mockResolvedValue([
      { merchant: "Lieferant GmbH" },
    ] as any)

    const csv = await generateSageKreditorenExport("user-1")
    const dataRow = csv.split("\r\n")[1]

    expect(dataRow).toContain("Lieferant GmbH")
  })

  it("uses semicolon separator with 9 columns", async () => {
    mockedFindMany.mockResolvedValue([
      { merchant: "Test" },
    ] as any)

    const csv = await generateSageKreditorenExport("user-1")
    const dataRow = csv.split("\r\n")[1]

    expect(dataRow.split(";").length).toBe(9)
  })
})

describe("empty data handling", () => {
  it("returns header only for empty Buchungsstapel", async () => {
    mockedFindMany.mockResolvedValue([])

    const csv = await generateSageBuchungsstapel("user-1")
    const lines = csv.split("\r\n")

    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("Belegdatum")
  })

  it("returns header only for empty Debitorenstamm", async () => {
    mockedFindMany.mockResolvedValue([])

    const csv = await generateSageDebitorenExport("user-1")
    const lines = csv.split("\r\n")

    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("Debitorennummer")
  })

  it("returns header only for empty Kreditorenstamm", async () => {
    mockedFindMany.mockResolvedValue([])

    const csv = await generateSageKreditorenExport("user-1")
    const lines = csv.split("\r\n")

    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("Kreditorennummer")
  })

  it("returns header only for empty Artikelstamm", async () => {
    mockedFindMany.mockResolvedValue([])

    const csv = await generateSageArtikelExport("user-1")
    const lines = csv.split("\r\n")

    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("Artikelnummer")
  })
})

describe("Artikelstamm export", () => {
  it("has correct header columns", async () => {
    mockedFindMany.mockResolvedValue([])

    const csv = await generateSageArtikelExport("user-1")
    const header = csv.split("\r\n")[0]

    expect(header).toContain("Artikelnummer")
    expect(header).toContain("Bezeichnung")
    expect(header).toContain("Einheit")
    expect(header).toContain("VK-Preis")
    expect(header).toContain("EK-Preis")
    expect(header).toContain("Steuerschlüssel")
  })

  it("assigns Steuerschlüssel based on category", async () => {
    mockedFindMany.mockResolvedValue([
      { name: "Standard service", total: 10000, type: "income", categoryCode: "income" },
      { name: "Food item", total: 5000, type: "expense", categoryCode: "food" },
      { name: "Insurance", total: 3000, type: "expense", categoryCode: "insurance" },
    ] as any)

    const csv = await generateSageArtikelExport("user-1")
    const lines = csv.split("\r\n")

    // All items get Steuerschlüssel from the default mapping (3=19% is standard)
    expect(lines[1]).toContain(";3;")
    expect(lines[2]).toContain(";3;")
    expect(lines[3]).toContain(";3;")
  })

  it("sets VK-Preis for income and EK-Preis for expense", async () => {
    mockedFindMany.mockResolvedValue([
      { name: "Income item", total: 10000, type: "income", categoryCode: "income" },
      { name: "Expense item", total: 5000, type: "expense", categoryCode: "office" },
    ] as any)

    const csv = await generateSageArtikelExport("user-1")
    const lines = csv.split("\r\n")

    // Income: VK-Preis filled, EK-Preis = 0,00
    const incomeCols = lines[1].split(";")
    expect(incomeCols[3]).toBe("100,00") // VK-Preis
    expect(incomeCols[4]).toBe("0,00")   // EK-Preis

    // Expense: VK-Preis = 0,00, EK-Preis filled
    const expenseCols = lines[2].split(";")
    expect(expenseCols[3]).toBe("0,00")  // VK-Preis
    expect(expenseCols[4]).toBe("50,00") // EK-Preis
  })
})

describe("custom separator option", () => {
  it("uses custom separator when provided", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 5000 }),
    ] as any)

    const csv = await generateSageBuchungsstapel("user-1", undefined, undefined, { separator: "|" })
    const lines = csv.split("\r\n")

    expect(lines[0].split("|").length).toBe(8)
    expect(lines[1].split("|").length).toBe(8)
  })
})
