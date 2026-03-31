import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

// Must import after mock setup
import { generateDatevExport } from "@/lib/fints/datev-export"
import { prisma } from "@/lib/db"

const mockedFindMany = vi.mocked(prisma.transaction.findMany)

function makeTx(overrides: Record<string, any> = {}) {
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

describe("SKR03 account mapping", () => {
  it("maps income to 8400", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ type: "income", categoryCode: "income", total: 5000 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR03")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")
    expect(dataRow[6]).toBe("8400")
  })

  it("maps office to 6815", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ categoryCode: "office", total: 5000 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR03")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")
    expect(dataRow[6]).toBe("6815")
  })

  it("uses bank account 1200 as counter account", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ total: 5000 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR03")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")
    expect(dataRow[7]).toBe("1200")
  })
})

describe("SKR04 account mapping", () => {
  it("maps income to 4400", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ type: "income", categoryCode: "income", total: 5000 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")
    expect(dataRow[6]).toBe("4400")
  })

  it("maps bank counter account to 1800", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ total: 5000 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")
    expect(dataRow[7]).toBe("1800")
  })

  it("maps food to 6640 (different from SKR03)", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ categoryCode: "food", total: 3000 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")
    expect(dataRow[6]).toBe("6640")
  })
})

describe("formatDatevAmount", () => {
  it("converts cents to German decimal format", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ total: 11900 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")
    expect(dataRow[0]).toBe("119,00")
  })

  it("handles small amounts", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ total: 99 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")
    expect(dataRow[0]).toBe("0,99")
  })

  it("uses absolute value for negative amounts", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ total: -5000 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")
    expect(dataRow[0]).toBe("50,00")
  })
})

describe("transactionToDatevRow", () => {
  it("produces correct column positions", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({
        total: 23800,
        type: "expense",
        categoryCode: "office",
        currencyCode: "EUR",
        issuedAt: new Date("2025-07-20"),
      }),
    ])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")

    expect(dataRow[0]).toBe("238,00")        // Umsatz
    expect(dataRow[1]).toBe("S")             // Soll (expense)
    expect(dataRow[2]).toBe("EUR")           // WKZ
    expect(dataRow[6]).toBe("6815")          // Konto (office in SKR04)
    expect(dataRow[7]).toBe("1800")          // Gegenkonto (bank in SKR04)
    expect(dataRow[9]).toBe("2007")          // Belegdatum ddMM
    expect(dataRow[13]).toContain("ACME Corp") // Buchungstext
    expect(dataRow[97]).toBe("AA")           // Buchungstyp
    expect(dataRow[114]).toBe("0")           // Festschreibung
  })

  it("sets H for income transactions", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ type: "income", categoryCode: "income", total: 10000 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const rows = csv.split("\r\n")
    const dataRow = rows[2].split(";")
    expect(dataRow[1]).toBe("H")
  })
})

describe("DATEV header", () => {
  it("contains correct SKR field for SKR03", async () => {
    mockedFindMany.mockResolvedValue([])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR03")
    const headerRow = csv.split("\r\n")[0].split(";")
    expect(headerRow[27]).toBe("03")
  })

  it("contains correct SKR field for SKR04", async () => {
    mockedFindMany.mockResolvedValue([])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const headerRow = csv.split("\r\n")[0].split(";")
    expect(headerRow[27]).toBe("04")
  })

  it("includes Beraternummer and Mandantennummer", async () => {
    mockedFindMany.mockResolvedValue([])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04", "99999", "12345")
    const headerRow = csv.split("\r\n")[0].split(";")
    expect(headerRow[10]).toBe("99999")  // Beraternummer
    expect(headerRow[11]).toBe("12345")  // Mandantennummer
  })

  it("uses default Beraternummer and Mandantennummer when not provided", async () => {
    mockedFindMany.mockResolvedValue([])
    const csv = await generateDatevExport("user-1")
    const headerRow = csv.split("\r\n")[0].split(";")
    expect(headerRow[10]).toBe("10000")
    expect(headerRow[11]).toBe("10001")
  })
})

describe("full export with mock transactions", () => {
  it("produces header, column headers, and data rows", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ id: "tx-1", total: 5000, type: "expense", categoryCode: "office" }),
      makeTx({ id: "tx-2", total: 20000, type: "income", categoryCode: "income" }),
    ])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const rows = csv.split("\r\n")

    expect(rows.length).toBe(4) // header + column headers + 2 data rows
    expect(rows[0]).toContain("EXTF")
    expect(rows[1]).toContain("Umsatz (ohne Soll/Haben-Kz)")
  })

  it("skips transactions with zero total", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ id: "tx-1", total: 0 }),
      makeTx({ id: "tx-2", total: 5000 }),
    ])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")
    const rows = csv.split("\r\n")
    expect(rows.length).toBe(3) // header + column headers + 1 data row
  })
})

describe("CR+LF line endings", () => {
  it("uses CR+LF between all lines", async () => {
    mockedFindMany.mockResolvedValue([makeTx({ total: 5000 })])
    const csv = await generateDatevExport("user-1", undefined, undefined, "SKR04")

    // Should contain \r\n
    expect(csv).toContain("\r\n")
    // Should NOT contain bare \n without preceding \r
    const withoutCrLf = csv.replace(/\r\n/g, "")
    expect(withoutCrLf).not.toContain("\n")
  })
})
