import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

import { generateUStVAData, generateElsterXML } from "@/lib/elster-ustva"
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

describe("KZ 81 - Steuerpflichtige Umsätze 19%", () => {
  it("calculates netto base for 19% income", async () => {
    // 11900 brutto at 19% = 10000 netto
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 11900, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz81).toBe(10000) // netto from 11900 brutto at 19%
  })

  it("accumulates multiple 19% income transactions", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 11900, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-10") }),
      makeTx({ total: 23800, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-15") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz81).toBe(30000) // 10000 + 20000
  })
})

describe("KZ 86 - Steuerpflichtige Umsätze 7%", () => {
  it("calculates netto base for 7% income", async () => {
    // 10700 brutto at 7% = 10000 netto
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 10700, type: "income", categoryCode: "income_7", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz86).toBe(10000)
    expect(data.kz81).toBe(0) // no 19% income
  })
})

describe("KZ 66 - Vorsteuer aus Rechnungen", () => {
  it("calculates Vorsteuer from 19% expense", async () => {
    // 11900 brutto at 19% = 1900 USt
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 11900, type: "expense", categoryCode: "office", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz66).toBe(1900)
  })

  it("calculates Vorsteuer from 7% expense", async () => {
    // 10700 brutto at 7% = 700 USt
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 10700, type: "expense", categoryCode: "food", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz66).toBe(700)
  })

  it("excludes exempt categories from Vorsteuer", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 50000, type: "expense", categoryCode: "insurance", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz66).toBe(0) // insurance is exempt
  })
})

describe("KZ 83 - Vorauszahlung", () => {
  it("calculates positive Vorauszahlung when USt > Vorsteuer", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 11900, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-10") }),
      makeTx({ total: 5950, type: "expense", categoryCode: "office", issuedAt: new Date("2025-03-15") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    // USt: 1900 (from 11900 income), Vorsteuer: 950 (from 5950 expense)
    // KZ 83 = 1900 - 950 = 950
    expect(data.kz83).toBe(1900 - 950)
  })

  it("calculates negative Vorauszahlung (Erstattung) when Vorsteuer > USt", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 5950, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-10") }),
      makeTx({ total: 11900, type: "expense", categoryCode: "office", issuedAt: new Date("2025-03-15") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz83).toBeLessThan(0) // Erstattungsanspruch
  })
})

describe("KZ 76 - Abziehbare Vorsteuer", () => {
  it("sums all Vorsteuer categories", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 11900, type: "expense", categoryCode: "office", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz76).toBe(data.kz66 + data.kz61 + data.kz62 + data.kz67)
  })
})

describe("quarterly vs monthly period", () => {
  it("uses single month date range for monthly", async () => {
    mockedFindMany.mockResolvedValue([])

    await generateUStVAData("user-1", 2025, 3, false)

    const call = mockedFindMany.mock.calls[0][0] as any
    const gte = call.where.issuedAt.gte as Date
    const lte = call.where.issuedAt.lte as Date

    expect(gte.getMonth()).toBe(2) // March (0-indexed)
    expect(lte.getMonth()).toBe(2) // Still March
  })

  it("uses three-month date range for quarterly", async () => {
    mockedFindMany.mockResolvedValue([])

    await generateUStVAData("user-1", 2025, 1, true) // Q1

    const call = mockedFindMany.mock.calls[0][0] as any
    const gte = call.where.issuedAt.gte as Date
    const lte = call.where.issuedAt.lte as Date

    expect(gte.getMonth()).toBe(0) // January
    expect(lte.getMonth()).toBe(2) // March (end of Q1)
  })

  it("handles Q2 correctly", async () => {
    mockedFindMany.mockResolvedValue([])

    await generateUStVAData("user-1", 2025, 2, true) // Q2

    const call = mockedFindMany.mock.calls[0][0] as any
    const gte = call.where.issuedAt.gte as Date
    const lte = call.where.issuedAt.lte as Date

    expect(gte.getMonth()).toBe(3) // April
    expect(lte.getMonth()).toBe(5) // June
  })
})

describe("with no transactions", () => {
  it("returns all zeros", async () => {
    mockedFindMany.mockResolvedValue([])

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz81).toBe(0)
    expect(data.kz86).toBe(0)
    expect(data.kz66).toBe(0)
    expect(data.kz76).toBe(0)
    expect(data.kz83).toBe(0)
  })
})

describe("with mixed tax rates", () => {
  it("correctly separates 19% and 7% income", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 11900, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-05") }),
      makeTx({ total: 10700, type: "income", categoryCode: "income_7", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz81).toBe(10000) // 19% netto
    expect(data.kz86).toBe(10000) // 7% netto
  })

  it("accumulates Vorsteuer from expenses with different rates", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 11900, type: "expense", categoryCode: "office", issuedAt: new Date("2025-03-05") }),
      makeTx({ total: 10700, type: "expense", categoryCode: "food", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const data = await generateUStVAData("user-1", 2025, 3)

    expect(data.kz66).toBe(1900 + 700)
  })
})

describe("Elster XML generation", () => {
  const sampleData = {
    kz81: 10000, kz86: 5000,
    kz35: 0, kz36: 0,
    kz66: 1900, kz61: 0, kz62: 0, kz67: 0,
    kz76: 1900, kz83: 1600,
  }

  it("produces valid XML with correct root element", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Test GmbH", { year: 2025, zeitraum: "03" })

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain("<Elster")
    expect(xml).toContain("</Elster>")
  })

  it("includes correct namespace", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Test GmbH", { year: 2025, zeitraum: "03" })

    expect(xml).toContain('xmlns="http://www.elster.de/elsterxml/schema/v11"')
  })

  it("includes UStVA-specific namespace", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Test GmbH", { year: 2025, zeitraum: "03" })

    expect(xml).toContain('xmlns="http://finkonsens.de/elster/elsteranmeldung/ustva/v2021"')
  })

  it("includes DatenArt as UStVA", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Test GmbH", { year: 2025, zeitraum: "03" })

    expect(xml).toContain("<DatenArt>UStVA</DatenArt>")
  })

  it("includes Verfahren as ElsterAnmeldung", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Test GmbH", { year: 2025, zeitraum: "03" })

    expect(xml).toContain("<Verfahren>ElsterAnmeldung</Verfahren>")
  })

  it("includes year and Zeitraum", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Test GmbH", { year: 2025, zeitraum: "03" })

    expect(xml).toContain("<Jahr>2025</Jahr>")
    expect(xml).toContain("<Zeitraum>03</Zeitraum>")
  })

  it("includes quarterly Zeitraum for Q1", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Test GmbH", { year: 2025, zeitraum: "41" })

    expect(xml).toContain("<Zeitraum>41</Zeitraum>")
  })

  it("includes Kennzahlen with Euro values (rounded)", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Test GmbH", { year: 2025, zeitraum: "03" })

    expect(xml).toContain("<Kz81>100</Kz81>") // 10000 cents = 100 EUR
    expect(xml).toContain("<Kz86>50</Kz86>")  // 5000 cents = 50 EUR
    expect(xml).toContain("<Kz66>19</Kz66>")  // 1900 cents = 19 EUR
    expect(xml).toContain("<Kz83>16</Kz83>")  // 1600 cents = 16 EUR
  })

  it("omits zero Kennzahlen", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Test GmbH", { year: 2025, zeitraum: "03" })

    expect(xml).not.toContain("<Kz35>")
    expect(xml).not.toContain("<Kz36>")
    expect(xml).not.toContain("<Kz61>")
    expect(xml).not.toContain("<Kz62>")
    expect(xml).not.toContain("<Kz67>")
  })

  it("includes company name", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Test GmbH", { year: 2025, zeitraum: "03" })

    expect(xml).toContain("<Name>Test GmbH</Name>")
    expect(xml).toContain("<DatenLieferant>Test GmbH</DatenLieferant>")
  })

  it("escapes XML special characters in company name", () => {
    const xml = generateElsterXML(sampleData, "1234567890", "Müller & Co <GmbH>", { year: 2025, zeitraum: "03" })

    expect(xml).toContain("Müller &amp; Co &lt;GmbH&gt;")
  })
})

describe("Steuernummer format conversion", () => {
  it("strips non-numeric characters from Steuernummer", () => {
    const xml = generateElsterXML(
      { kz81: 100, kz86: 0, kz35: 0, kz36: 0, kz66: 0, kz61: 0, kz62: 0, kz67: 0, kz76: 0, kz83: 100 },
      "123/456/78901",
      "Test",
      { year: 2025, zeitraum: "03" },
    )

    expect(xml).toContain("<Steuernummer>12345678901</Steuernummer>")
  })

  it("passes through numeric-only Steuernummer unchanged", () => {
    const xml = generateElsterXML(
      { kz81: 100, kz86: 0, kz35: 0, kz36: 0, kz66: 0, kz61: 0, kz62: 0, kz67: 0, kz76: 0, kz83: 100 },
      "1234567890123",
      "Test",
      { year: 2025, zeitraum: "03" },
    )

    expect(xml).toContain("<Steuernummer>1234567890123</Steuernummer>")
  })
})
