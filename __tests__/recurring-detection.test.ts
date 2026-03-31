import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock prisma before importing the module under test
// ---------------------------------------------------------------------------
vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

import { detectRecurringTransactions, type RecurringPattern } from "@/lib/fints/recurring-detection"
import { prisma } from "@/lib/db"

const mockedFindMany = vi.mocked(prisma.transaction.findMany)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake transaction row */
function fakeTx(
  merchant: string,
  total: number,
  issuedAt: Date,
  categoryCode: string | null = null,
  id?: string,
) {
  return {
    id: id ?? crypto.randomUUID(),
    merchant,
    total,
    issuedAt,
    categoryCode,
  }
}

/** Generate N transactions spaced `intervalDays` days apart */
function generateSeries(
  merchant: string,
  total: number,
  count: number,
  intervalDays: number,
  startDate = new Date("2024-01-15"),
  categoryCode: string | null = null,
) {
  const txs = []
  for (let i = 0; i < count; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i * intervalDays)
    txs.push(fakeTx(merchant, total, date, categoryCode))
  }
  return txs
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Monthly detection
// ---------------------------------------------------------------------------
describe("monthly detection", () => {
  it("detects transactions spaced ~30 days apart as monthly", async () => {
    const txs = generateSeries("Netflix GmbH", -1299, 4, 30)
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")

    expect(patterns).toHaveLength(1)
    expect(patterns[0].frequency).toBe("monthly")
    expect(patterns[0].merchant).toBe("Netflix GmbH")
    expect(patterns[0].amount).toBe(-1299)
    expect(patterns[0].occurrences).toBe(4)
  })

  it("detects transactions spaced 31 days apart as monthly", async () => {
    const txs = generateSeries("Spotify AB", -999, 3, 31)
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toHaveLength(1)
    expect(patterns[0].frequency).toBe("monthly")
  })
})

// ---------------------------------------------------------------------------
// Quarterly detection
// ---------------------------------------------------------------------------
describe("quarterly detection", () => {
  it("detects transactions spaced ~91 days apart as quarterly", async () => {
    const txs = generateSeries("Versicherung AG", -15000, 4, 91)
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")

    expect(patterns).toHaveLength(1)
    expect(patterns[0].frequency).toBe("quarterly")
    expect(patterns[0].occurrences).toBe(4)
  })

  it("detects 90-day spacing as quarterly", async () => {
    const txs = generateSeries("Insurance Corp", -5000, 3, 90)
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toHaveLength(1)
    expect(patterns[0].frequency).toBe("quarterly")
  })
})

// ---------------------------------------------------------------------------
// Merchant normalization
// ---------------------------------------------------------------------------
describe("merchant normalization", () => {
  it("groups merchants with different casing together", async () => {
    const txs = [
      fakeTx("Netflix GmbH", -1299, new Date("2024-01-15")),
      fakeTx("netflix gmbh", -1299, new Date("2024-02-14")),
      fakeTx("NETFLIX GMBH", -1299, new Date("2024-03-15")),
    ]
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")

    // All three should be grouped into one pattern
    expect(patterns).toHaveLength(1)
    expect(patterns[0].occurrences).toBe(3)
  })

  it("trims whitespace when grouping", async () => {
    const txs = [
      fakeTx("  Spotify  ", -999, new Date("2024-01-15")),
      fakeTx("Spotify", -999, new Date("2024-02-14")),
      fakeTx("spotify ", -999, new Date("2024-03-15")),
    ]
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toHaveLength(1)
    expect(patterns[0].occurrences).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Amount tolerance (5%)
// ---------------------------------------------------------------------------
describe("amount tolerance", () => {
  it("groups transactions within 5% variance", async () => {
    // Base amount 10000 cents. 5% = 500 cents tolerance
    const txs = [
      fakeTx("Provider X", -10000, new Date("2024-01-15")),
      fakeTx("Provider X", -10200, new Date("2024-02-14")), // +2%
      fakeTx("Provider X", -9900, new Date("2024-03-15")),  // -1%
      fakeTx("Provider X", -10400, new Date("2024-04-14")), // +4%
    ]
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toHaveLength(1)
    expect(patterns[0].frequency).toBe("monthly")
    expect(patterns[0].occurrences).toBe(4)
  })

  it("excludes groups where amounts differ by more than 5%", async () => {
    const txs = [
      fakeTx("Random Shop", -10000, new Date("2024-01-15")),
      fakeTx("Random Shop", -15000, new Date("2024-02-14")), // +50%
      fakeTx("Random Shop", -10000, new Date("2024-03-15")),
    ]
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Minimum occurrence threshold
// ---------------------------------------------------------------------------
describe("minimum occurrences", () => {
  it("excludes groups with fewer than 3 transactions", async () => {
    const txs = generateSeries("SinglePay Inc", -2000, 2, 30)
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toHaveLength(0)
  })

  it("includes groups with exactly 3 transactions", async () => {
    const txs = generateSeries("TriplePay Inc", -2000, 3, 30)
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toHaveLength(1)
    expect(patterns[0].occurrences).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// nextExpected date calculation
// ---------------------------------------------------------------------------
describe("nextExpected date", () => {
  it("calculates nextExpected as last occurrence + frequency interval for monthly", async () => {
    const start = new Date("2024-01-15")
    const txs = generateSeries("Monthly Co", -5000, 3, 30, start)
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toHaveLength(1)

    const lastDate = txs[txs.length - 1].issuedAt
    const expected = new Date(lastDate)
    expected.setDate(expected.getDate() + 30) // monthly = 30 days

    expect(patterns[0].nextExpected.getTime()).toBe(expected.getTime())
  })

  it("calculates nextExpected for quarterly frequency", async () => {
    const start = new Date("2024-01-01")
    const txs = generateSeries("Quarterly Co", -8000, 3, 91, start)
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toHaveLength(1)

    const lastDate = txs[txs.length - 1].issuedAt
    const expected = new Date(lastDate)
    expected.setDate(expected.getDate() + 91) // quarterly = 91 days

    expect(patterns[0].nextExpected.getTime()).toBe(expected.getTime())
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("edge cases", () => {
  it("returns empty array when no transactions exist", async () => {
    mockedFindMany.mockResolvedValue([])

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toEqual([])
  })

  it("returns empty array when transactions have no pattern", async () => {
    const txs = [
      fakeTx("Random A", -1000, new Date("2024-01-01")),
      fakeTx("Random B", -2000, new Date("2024-02-15")),
      fakeTx("Random C", -3000, new Date("2024-05-20")),
    ]
    mockedFindMany.mockResolvedValue(txs)

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns).toHaveLength(0)
  })

  it("sorts results by nextExpected ascending", async () => {
    // Two recurring series: one starting later
    const series1 = generateSeries("Alpha Co", -1000, 3, 30, new Date("2024-01-01"))
    const series2 = generateSeries("Beta Co", -2000, 3, 30, new Date("2024-06-01"))
    mockedFindMany.mockResolvedValue([...series1, ...series2])

    const patterns = await detectRecurringTransactions("user-1")
    expect(patterns.length).toBe(2)
    expect(patterns[0].nextExpected.getTime()).toBeLessThan(patterns[1].nextExpected.getTime())
  })
})
