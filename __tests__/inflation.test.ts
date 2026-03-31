import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock prisma and recurring detection before importing
vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/fints/recurring-detection", () => ({
  detectRecurringTransactions: vi.fn(),
}))

import {
  CPI_DATA,
  getInflationRate,
  adjustForInflation,
  getCumulativeInflation,
  exceedsInflationThreshold,
  generateInflationReport,
} from "@/lib/inflation"
import { prisma } from "@/lib/db"
import { detectRecurringTransactions } from "@/lib/fints/recurring-detection"

const mockedDetect = vi.mocked(detectRecurringTransactions)
const mockedFindUnique = vi.mocked(prisma.transaction.findUnique)

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// getInflationRate
// ---------------------------------------------------------------------------
describe("getInflationRate", () => {
  it("returns correct inflation rate between 2020 and 2022", () => {
    // CPI 2020 = 100.0, CPI 2022 = 110.4
    const rate = getInflationRate(2020, 2022)
    expect(rate).toBeCloseTo(10.4, 1)
  })

  it("returns correct inflation rate between 2015 and 2020", () => {
    // CPI 2015 = 91.6, CPI 2020 = 100.0
    const rate = getInflationRate(2015, 2020)
    expect(rate).toBeCloseTo(((100.0 - 91.6) / 91.6) * 100, 1)
  })

  it("returns negative rate when deflation occurs (toYear < fromYear in CPI)", () => {
    // Going from 2022 to 2020 should give negative
    const rate = getInflationRate(2022, 2020)
    expect(rate).toBeLessThan(0)
  })

  it("returns 0 for same CPI year", () => {
    const rate = getInflationRate(2020, 2020)
    expect(rate).toBe(0)
  })

  it("throws for unknown fromYear", () => {
    expect(() => getInflationRate(1990, 2020)).toThrow("CPI data not available")
  })

  it("throws for unknown toYear", () => {
    expect(() => getInflationRate(2020, 2050)).toThrow("CPI data not available")
  })
})

// ---------------------------------------------------------------------------
// adjustForInflation
// ---------------------------------------------------------------------------
describe("adjustForInflation", () => {
  it("adjusts 10000 cents from 2020 to 2022", () => {
    // 10000 * (110.4 / 100.0) = 11040
    const adjusted = adjustForInflation(10000, 2020, 2022)
    expect(adjusted).toBe(11040)
  })

  it("returns same amount for same year", () => {
    const adjusted = adjustForInflation(5000, 2023, 2023)
    expect(adjusted).toBe(5000)
  })

  it("handles negative amounts (credits)", () => {
    const adjusted = adjustForInflation(-10000, 2020, 2022)
    expect(adjusted).toBe(-11040)
  })

  it("handles zero amount", () => {
    const adjusted = adjustForInflation(0, 2020, 2025)
    expect(adjusted).toBe(0)
  })

  it("rounds to nearest cent", () => {
    // 333 * (110.4 / 100.0) = 367.632 -> 368
    const adjusted = adjustForInflation(333, 2020, 2022)
    expect(adjusted).toBe(368)
  })

  it("throws for unknown year", () => {
    expect(() => adjustForInflation(1000, 2000, 2020)).toThrow("CPI data not available")
  })
})

// ---------------------------------------------------------------------------
// getCumulativeInflation
// ---------------------------------------------------------------------------
describe("getCumulativeInflation", () => {
  it("returns same result as getInflationRate", () => {
    const rate = getInflationRate(2020, 2025)
    const cumulative = getCumulativeInflation(2020, 2025)
    expect(cumulative).toBe(rate)
  })

  it("calculates cumulative inflation from 2015 to 2026", () => {
    const cumulative = getCumulativeInflation(2015, 2026)
    expect(cumulative).toBeCloseTo(((125.0 - 91.6) / 91.6) * 100, 1)
  })
})

// ---------------------------------------------------------------------------
// exceedsInflationThreshold
// ---------------------------------------------------------------------------
describe("exceedsInflationThreshold", () => {
  it("returns exceeded=true when inflation exceeds threshold", () => {
    // 2020 -> 2022 = 10.4% > 5%
    const result = exceedsInflationThreshold(10000, 2020, 2022, 5.0)
    expect(result.exceeded).toBe(true)
    expect(result.currentRate).toBeCloseTo(10.4, 1)
    expect(result.adjustedAmount).toBe(11040)
  })

  it("returns exceeded=false when inflation is below threshold", () => {
    // 2020 -> 2021 = 3.1% < 5%
    const result = exceedsInflationThreshold(10000, 2020, 2021, 5.0)
    expect(result.exceeded).toBe(false)
    expect(result.currentRate).toBeCloseTo(3.1, 1)
  })

  it("returns exceeded=false for same year", () => {
    const result = exceedsInflationThreshold(10000, 2023, 2023, 5.0)
    expect(result.exceeded).toBe(false)
    expect(result.currentRate).toBe(0)
    expect(result.adjustedAmount).toBe(10000)
  })

  it("uses default 5% threshold when not specified", () => {
    // 2020 -> 2022 = 10.4% > 5% default
    const result = exceedsInflationThreshold(10000, 2020, 2022)
    expect(result.exceeded).toBe(true)
  })

  it("handles high threshold that is not exceeded", () => {
    // 2020 -> 2021 = 3.1% < 50%
    const result = exceedsInflationThreshold(10000, 2020, 2021, 50.0)
    expect(result.exceeded).toBe(false)
  })

  it("handles zero threshold", () => {
    // Any positive inflation exceeds 0%
    const result = exceedsInflationThreshold(10000, 2020, 2021, 0)
    expect(result.exceeded).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// generateInflationReport
// ---------------------------------------------------------------------------
describe("generateInflationReport", () => {
  it("generates report from recurring transactions", async () => {
    mockedDetect.mockResolvedValue([
      {
        merchant: "Netflix",
        amount: 1299,
        frequency: "monthly",
        lastOccurrence: new Date("2026-03-01"),
        nextExpected: new Date("2026-04-01"),
        occurrences: 12,
        transactionIds: ["tx1", "tx2"],
        categoryCode: null,
      },
    ])

    mockedFindUnique.mockResolvedValue({
      id: "tx1",
      issuedAt: new Date("2022-03-01"),
    } as any)

    const report = await generateInflationReport("user-1", 5.0)

    expect(report.items).toHaveLength(1)
    expect(report.items[0].name).toBe("Netflix")
    expect(report.items[0].baseYear).toBe(2022)
    expect(report.items[0].baseAmount).toBe(1299)
    // 2022 -> 2026: (125.0 / 110.4) * 1299 = ~1472
    expect(report.items[0].currentAmount).toBeGreaterThan(1299)
    expect(report.items[0].shouldAdjust).toBe(true)
    expect(report.thresholdPercent).toBe(5.0)
    expect(report.totalBaseAmount).toBe(1299)
    expect(report.totalCurrentAmount).toBe(report.items[0].currentAmount)
  })

  it("returns empty report when no recurring transactions", async () => {
    mockedDetect.mockResolvedValue([])

    const report = await generateInflationReport("user-1")

    expect(report.items).toHaveLength(0)
    expect(report.totalBaseAmount).toBe(0)
    expect(report.totalCurrentAmount).toBe(0)
    expect(report.averageInflation).toBe(0)
  })
})
