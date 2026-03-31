import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/db"
import { generateUStSummary } from "@/lib/fints/ust-summary"

const dateFrom = new Date("2025-01-01")
const dateTo = new Date("2025-03-31")

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    userId: "user-1",
    total: 11900,
    type: "income",
    categoryCode: null,
    category: null,
    issuedAt: new Date("2025-02-15"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("generateUStSummary", () => {
  it("classifies income transactions into outputTax rate19", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: 11900, type: "income", categoryCode: "income" }),
    ] as any)

    const summary = await generateUStSummary("user-1", dateFrom, dateTo)

    // brutto = 11900, netto = round(11900 / 1.19) = 10000, ust = 1900
    expect(summary.outputTax.rate19.brutto).toBe(11900)
    expect(summary.outputTax.rate19.netto).toBe(10000)
    expect(summary.outputTax.rate19.ust).toBe(1900)
    expect(summary.outputTax.rate19.count).toBe(1)
  })

  it("classifies expense transactions into inputTax rate19", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: -11900, type: "expense", categoryCode: "office" }),
    ] as any)

    const summary = await generateUStSummary("user-1", dateFrom, dateTo)

    // brutto = abs(-11900) = 11900, netto = 10000, vorsteuer = 1900
    expect(summary.inputTax.rate19.brutto).toBe(11900)
    expect(summary.inputTax.rate19.netto).toBe(10000)
    expect(summary.inputTax.rate19.vorsteuer).toBe(1900)
    expect(summary.inputTax.rate19.count).toBe(1)
  })

  it("maps food category to 7% rate", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: -10700, type: "expense", categoryCode: "food" }),
    ] as any)

    const summary = await generateUStSummary("user-1", dateFrom, dateTo)

    // brutto = 10700, netto = round(10700 / 1.07) = 10000, vorsteuer = 700
    expect(summary.inputTax.rate7.brutto).toBe(10700)
    expect(summary.inputTax.rate7.netto).toBe(10000)
    expect(summary.inputTax.rate7.vorsteuer).toBe(700)
    expect(summary.inputTax.rate7.count).toBe(1)
  })

  it("maps insurance category to 0% rate (exempt)", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: 5000, type: "income", categoryCode: "insurance" }),
    ] as any)

    const summary = await generateUStSummary("user-1", dateFrom, dateTo)

    // Exempt: rate=0, goes to outputTax.rate0
    expect(summary.outputTax.rate0.brutto).toBe(5000)
    expect(summary.outputTax.rate0.netto).toBe(5000)
    expect(summary.outputTax.rate0.count).toBe(1)
    // No USt at 19% or 7%
    expect(summary.outputTax.rate19.count).toBe(0)
    expect(summary.outputTax.rate7.count).toBe(0)
  })

  it("calculates Zahllast as outputTax USt minus inputTax Vorsteuer", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      makeTx({ total: 11900, type: "income", categoryCode: "income" }),   // USt = 1900
      makeTx({ total: -5950, type: "expense", categoryCode: "office" }),  // Vorsteuer = 950
    ] as any)

    const summary = await generateUStSummary("user-1", dateFrom, dateTo)

    expect(summary.outputTax.rate19.ust).toBe(1900)
    expect(summary.inputTax.rate19.vorsteuer).toBe(950)
    expect(summary.zahllast).toBe(1900 - 950)
  })

  it("returns zero values for empty transactions", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([])

    const summary = await generateUStSummary("user-1", dateFrom, dateTo)

    expect(summary.outputTax.rate19.brutto).toBe(0)
    expect(summary.outputTax.rate19.ust).toBe(0)
    expect(summary.outputTax.rate19.count).toBe(0)
    expect(summary.outputTax.rate7.count).toBe(0)
    expect(summary.outputTax.rate0.count).toBe(0)
    expect(summary.inputTax.rate19.count).toBe(0)
    expect(summary.inputTax.rate7.count).toBe(0)
    expect(summary.zahllast).toBe(0)
  })
})
