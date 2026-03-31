import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

import { generateBWA, formatBWAAsCSV } from "@/lib/bwa"
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

describe("BWA category mapping", () => {
  it("maps office to verschiedeneKosten", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 5000, type: "expense", categoryCode: "office", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.verschiedeneKosten.currentMonth).toBe(5000)
  })

  it("maps rent to miete (Raumkosten)", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 80000, type: "expense", categoryCode: "rent", issuedAt: new Date("2025-03-01") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.miete.currentMonth).toBe(80000)
    expect(report.raumkosten.currentMonth).toBe(80000)
  })

  it("maps salary to loehneGehaelter (Personalkosten)", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 300000, type: "expense", categoryCode: "salary", issuedAt: new Date("2025-03-01") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.loehneGehaelter.currentMonth).toBe(300000)
    expect(report.personalkosten.currentMonth).toBe(300000)
  })

  it("maps income to umsatzerloese", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 100000, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-15") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.umsatzerloese.currentMonth).toBe(100000)
    expect(report.gesamtleistung.currentMonth).toBe(100000)
  })

  it("maps insurance to versicherungenBeitraege", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 10000, type: "expense", categoryCode: "insurance", issuedAt: new Date("2025-03-01") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.versicherungenBeitraege.currentMonth).toBe(10000)
  })

  it("maps vehicle to kfzKosten", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 15000, type: "expense", categoryCode: "vehicle", issuedAt: new Date("2025-03-05") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.kfzKosten.currentMonth).toBe(15000)
  })

  it("maps travel to werbeReisekosten", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 20000, type: "expense", categoryCode: "travel", issuedAt: new Date("2025-03-05") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.werbeReisekosten.currentMonth).toBe(20000)
  })

  it("maps interest to zinsen", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 5000, type: "expense", categoryCode: "interest", issuedAt: new Date("2025-03-01") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.zinsen.currentMonth).toBe(5000)
  })
})

describe("BWA percentage of revenue calculation", () => {
  it("calculates percent of revenue correctly", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 100000, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-10") }),
      makeTx({ total: 20000, type: "expense", categoryCode: "rent", issuedAt: new Date("2025-03-15") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.gesamtleistung.percentOfRevenue).toBe(100)
    expect(report.miete.percentOfRevenue).toBe(20)
  })

  it("handles zero revenue without division by zero", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 5000, type: "expense", categoryCode: "office", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.gesamtleistung.currentMonth).toBe(0)
    expect(report.verschiedeneKosten.percentOfRevenue).toBe(0)
    expect(report.gesamtleistung.percentOfRevenue).toBe(0)
  })
})

describe("BWA Rohertrag calculation", () => {
  it("calculates Rohertrag as Gesamtleistung - Materialaufwand", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 200000, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-01") }),
      makeTx({ total: 50000, type: "expense", categoryCode: "material", issuedAt: new Date("2025-03-05") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.gesamtleistung.currentMonth).toBe(200000)
    expect(report.materialaufwand.currentMonth).toBe(50000)
    expect(report.rohertrag.currentMonth).toBe(150000)
  })

  it("Rohertrag equals Gesamtleistung when no material costs", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 100000, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.rohertrag.currentMonth).toBe(report.gesamtleistung.currentMonth)
  })
})

describe("BWA Betriebsergebnis (EBIT) calculation", () => {
  it("calculates EBIT as Gesamtleistung - Gesamtkosten", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 500000, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-01") }),
      makeTx({ total: 80000, type: "expense", categoryCode: "rent", issuedAt: new Date("2025-03-05") }),
      makeTx({ total: 200000, type: "expense", categoryCode: "salary", issuedAt: new Date("2025-03-05") }),
      makeTx({ total: 10000, type: "expense", categoryCode: "office", issuedAt: new Date("2025-03-10") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    const expectedGesamtkosten = 80000 + 200000 + 10000
    expect(report.gesamtkosten.currentMonth).toBe(expectedGesamtkosten)
    expect(report.betriebsergebnis.currentMonth).toBe(500000 - expectedGesamtkosten)
  })

  it("shows negative EBIT when costs exceed revenue", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 100000, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-01") }),
      makeTx({ total: 200000, type: "expense", categoryCode: "salary", issuedAt: new Date("2025-03-05") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.betriebsergebnis.currentMonth).toBeLessThan(0)
  })
})

describe("BWA monthly vs YTD aggregation", () => {
  it("separates current month and YTD correctly", async () => {
    mockedFindMany.mockResolvedValue([
      // January transaction (YTD only)
      makeTx({ total: 50000, type: "income", categoryCode: "income", issuedAt: new Date("2025-01-15") }),
      // February transaction (previous month + YTD)
      makeTx({ total: 60000, type: "income", categoryCode: "income", issuedAt: new Date("2025-02-15") }),
      // March transaction (current month + YTD)
      makeTx({ total: 70000, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-15") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.umsatzerloese.currentMonth).toBe(70000)
    expect(report.umsatzerloese.previousMonth).toBe(60000)
    expect(report.umsatzerloese.ytd).toBe(180000) // 50000 + 60000 + 70000
  })
})

describe("BWA with empty transaction list", () => {
  it("returns all zeros when there are no transactions", async () => {
    mockedFindMany.mockResolvedValue([])

    const report = await generateBWA("user-1", 2025, 3)

    expect(report.umsatzerloese.currentMonth).toBe(0)
    expect(report.gesamtleistung.currentMonth).toBe(0)
    expect(report.rohertrag.currentMonth).toBe(0)
    expect(report.betriebsergebnis.currentMonth).toBe(0)
    expect(report.gesamtkosten.currentMonth).toBe(0)
    expect(report.vorlaeufgesErgebnis.currentMonth).toBe(0)
    expect(report.year).toBe(2025)
    expect(report.month).toBe(3)
  })
})

describe("formatBWAAsCSV", () => {
  it("produces semicolon-separated CSV with header row", async () => {
    mockedFindMany.mockResolvedValue([
      makeTx({ total: 100000, type: "income", categoryCode: "income", issuedAt: new Date("2025-03-10") }),
      makeTx({ total: 20000, type: "expense", categoryCode: "office", issuedAt: new Date("2025-03-15") }),
    ] as any)

    const report = await generateBWA("user-1", 2025, 3)
    const csv = formatBWAAsCSV(report)

    // Header contains column names
    expect(csv).toContain("Position")
    expect(csv).toContain("März 2025")
    expect(csv).toContain("YTD 2025")
    expect(csv).toContain("% vom Umsatz")
  })

  it("uses CR+LF line endings", async () => {
    mockedFindMany.mockResolvedValue([])

    const report = await generateBWA("user-1", 2025, 3)
    const csv = formatBWAAsCSV(report)

    expect(csv).toContain("\r\n")
  })

  it("includes BWA section headers", async () => {
    mockedFindMany.mockResolvedValue([])

    const report = await generateBWA("user-1", 2025, 3)
    const csv = formatBWAAsCSV(report)

    expect(csv).toContain("GESAMTLEISTUNG")
    expect(csv).toContain("ROHERTRAG")
    expect(csv).toContain("KOSTEN")
    expect(csv).toContain("Betriebsergebnis (EBIT)")
    expect(csv).toContain("VORLÄUFIGES ERGEBNIS")
  })

  it("includes all key BWA positions", async () => {
    mockedFindMany.mockResolvedValue([])

    const report = await generateBWA("user-1", 2025, 3)
    const csv = formatBWAAsCSV(report)

    expect(csv).toContain("Umsatzerlöse")
    expect(csv).toContain("Personalkosten gesamt")
    expect(csv).toContain("Raumkosten gesamt")
    expect(csv).toContain("Verschiedene Kosten")
    expect(csv).toContain("GESAMTKOSTEN")
  })
})
