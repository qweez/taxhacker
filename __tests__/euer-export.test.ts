import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/db"
import { generateEUER, formatEUERAsCSV } from "@/lib/fints/euer-export"

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    userId: "user-1",
    total: 10000,
    type: "income",
    categoryCode: "income",
    category: null,
    issuedAt: new Date("2025-06-15"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("generateEUER", () => {
  it("maps income category to KZ 112", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: 50000, type: "income", categoryCode: "income" }),
    ] as any)

    const data = await generateEUER("user-1", 2025)

    expect(data.einnahmen.kz112).toBe(50000)
  })

  it("maps rent category to KZ 260", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: -80000, type: "expense", categoryCode: "rent" }),
    ] as any)

    const data = await generateEUER("user-1", 2025)

    expect(data.ausgaben.kz260).toBe(80000)
  })

  it("maps telecom category to KZ 300", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: -5000, type: "expense", categoryCode: "telecom" }),
    ] as any)

    const data = await generateEUER("user-1", 2025)

    expect(data.ausgaben.kz300).toBe(5000)
  })

  it("maps insurance to KZ 325, bank_fees to KZ 350, salary to KZ 230", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: -20000, type: "expense", categoryCode: "insurance" }),
      makeTx({ total: -500, type: "expense", categoryCode: "bank_fees" }),
      makeTx({ total: -300000, type: "expense", categoryCode: "salary" }),
    ] as any)

    const data = await generateEUER("user-1", 2025)

    expect(data.ausgaben.kz325).toBe(20000)
    expect(data.ausgaben.kz350).toBe(500)
    expect(data.ausgaben.kz230).toBe(300000)
  })

  it("applies Bewirtungskosten 70% rule (KZ 290)", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: -10000, type: "expense", categoryCode: "food" }),
    ] as any)

    const data = await generateEUER("user-1", 2025)

    // 70% of 10000 = 7000
    expect(data.ausgaben.kz290).toBe(7000)
  })

  it("computes Summe Betriebseinnahmen (KZ 185)", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: 50000, type: "income", categoryCode: "income" }),
      makeTx({ total: 30000, type: "income", categoryCode: "income" }),
    ] as any)

    const data = await generateEUER("user-1", 2025)

    expect(data.einnahmen.kz112).toBe(80000)
    expect(data.einnahmen.kz185).toBe(80000)
  })

  it("computes Summe Betriebsausgaben (KZ 399)", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: -80000, type: "expense", categoryCode: "rent" }),
      makeTx({ total: -5000, type: "expense", categoryCode: "telecom" }),
    ] as any)

    const data = await generateEUER("user-1", 2025)

    expect(data.ausgaben.kz260).toBe(80000)
    expect(data.ausgaben.kz300).toBe(5000)
    expect(data.ausgaben.kz399).toBe(85000)
  })

  it("calculates Gewinn/Verlust as KZ 185 - KZ 399", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: 100000, type: "income", categoryCode: "income" }),
      makeTx({ total: -30000, type: "expense", categoryCode: "rent" }),
    ] as any)

    const data = await generateEUER("user-1", 2025)

    expect(data.einnahmen.kz185).toBe(100000)
    expect(data.ausgaben.kz399).toBe(30000)
    expect(data.gewinnVerlust).toBe(70000)
  })

  it("returns zero values when there are no transactions", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([])

    const data = await generateEUER("user-1", 2025)

    expect(data.einnahmen.kz185).toBe(0)
    expect(data.ausgaben.kz399).toBe(0)
    expect(data.gewinnVerlust).toBe(0)
  })
})

describe("formatEUERAsCSV", () => {
  it("produces semicolon-separated output with header row", () => {
    const data = {
      year: 2025,
      einnahmen: {
        kz111: 0, kz112: 100000, kz113: 0, kz114: 0,
        kz120: 0, kz125: 0, kz185: 100000,
      },
      ausgaben: {
        kz210: 0, kz220: 0, kz230: 0, kz240: 0, kz250: 0,
        kz260: 30000, kz270: 0, kz280: 0, kz285: 0, kz290: 0,
        kz295: 0, kz300: 5000, kz310: 0, kz315: 0, kz320: 0,
        kz325: 0, kz330: 0, kz340: 0, kz345: 0, kz350: 0,
        kz355: 0, kz359: 0, kz360: 0, kz399: 35000,
      },
      gewinnVerlust: 65000,
    }

    const csv = formatEUERAsCSV(data)
    const lines = csv.split("\r\n")

    // First line is the title
    expect(lines[0]).toBe("Anlage EUER 2025")

    // Header row
    expect(lines[2]).toBe("KZ;Bezeichnung;Betrag (EUR)")

    // Check a specific income line: KZ 112
    const kz112Line = lines.find((l) => l.startsWith("112;"))
    expect(kz112Line).toContain("112;")
    expect(kz112Line).toContain("1000,00")

    // Check expense line: KZ 260
    const kz260Line = lines.find((l) => l.startsWith("260;"))
    expect(kz260Line).toContain("300,00")

    // Check Gewinn line
    const gewinnLine = lines.find((l) => l.includes("Gewinn / Verlust"))
    expect(gewinnLine).toContain("650,00")

    // All data lines use semicolons as separators
    const dataLines = lines.filter((l) => l.includes(";"))
    for (const line of dataLines) {
      expect(line.split(";").length).toBeGreaterThanOrEqual(2)
    }
  })

  it("shows Verlust label when gewinnVerlust is negative", () => {
    const data = {
      year: 2025,
      einnahmen: {
        kz111: 0, kz112: 10000, kz113: 0, kz114: 0,
        kz120: 0, kz125: 0, kz185: 10000,
      },
      ausgaben: {
        kz210: 0, kz220: 0, kz230: 0, kz240: 0, kz250: 0,
        kz260: 50000, kz270: 0, kz280: 0, kz285: 0, kz290: 0,
        kz295: 0, kz300: 0, kz310: 0, kz315: 0, kz320: 0,
        kz325: 0, kz330: 0, kz340: 0, kz345: 0, kz350: 0,
        kz355: 0, kz359: 0, kz360: 0, kz399: 50000,
      },
      gewinnVerlust: -40000,
    }

    const csv = formatEUERAsCSV(data)
    expect(csv).toContain("Verlust")
  })
})
