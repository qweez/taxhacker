import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    fixedAsset: {
      findMany: vi.fn(),
    },
  },
}))

import {
  calculateLinearDepreciation,
  calculateDegressiveDepreciation,
  generateDepreciationSchedule,
  isGWG,
  isSammelposten,
  getUsefulLife,
  AfATable,
  generateAssetRegister,
} from "@/lib/asset-accounting"
import type { Asset } from "@/lib/asset-accounting"
import { prisma } from "@/lib/db"

beforeEach(() => {
  vi.clearAllMocks()
})

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-1",
    name: "MacBook Pro",
    acquisitionDate: new Date("2025-01-01"),
    acquisitionCost: 300000, // 3000 EUR
    usefulLifeYears: 3,
    depreciationMethod: "linear",
    residualValue: 0,
    category: "computer",
    ...overrides,
  }
}

describe("linear depreciation", () => {
  it("calculates 3000 EUR over 3 years = 1000 EUR/year", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 300000,
      usefulLifeYears: 3,
      residualValue: 0,
    })

    const y1 = calculateLinearDepreciation(asset, 2025)
    const y2 = calculateLinearDepreciation(asset, 2026)
    const y3 = calculateLinearDepreciation(asset, 2027)

    expect(y1).toBe(100000) // 1000 EUR in cents
    expect(y2).toBe(100000)
    expect(y3).toBe(100000)
  })

  it("returns 0 before acquisition year", () => {
    const asset = makeAsset({ acquisitionDate: new Date("2025-01-01") })

    expect(calculateLinearDepreciation(asset, 2024)).toBe(0)
  })

  it("returns 0 after end of useful life", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      usefulLifeYears: 3,
    })

    expect(calculateLinearDepreciation(asset, 2028)).toBe(0)
  })

  it("respects residual value", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 300000,
      usefulLifeYears: 3,
      residualValue: 30000, // 300 EUR
    })

    const y1 = calculateLinearDepreciation(asset, 2025)
    const y2 = calculateLinearDepreciation(asset, 2026)
    const y3 = calculateLinearDepreciation(asset, 2027)

    const total = y1 + y2 + y3
    expect(total).toBe(270000) // 3000 - 300 = 2700 EUR depreciable
  })
})

describe("partial year depreciation (acquisition mid-year)", () => {
  it("prorates first year based on acquisition month", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-07-01"), // July = month 7
      acquisitionCost: 120000, // 1200 EUR
      usefulLifeYears: 1,
      residualValue: 0,
    })

    const y1 = calculateLinearDepreciation(asset, 2025)
    // Full year: 120000, remaining months: July-Dec = 6 months
    // 120000 * 6/12 = 60000
    expect(y1).toBe(60000)
  })

  it("prorates to 1 month when acquired in December", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-12-15"),
      acquisitionCost: 120000,
      usefulLifeYears: 10,
      residualValue: 0,
    })

    const y1 = calculateLinearDepreciation(asset, 2025)
    // Yearly: 12000, 1 month: 12000 * 1/12 = 1000
    expect(y1).toBe(1000)
  })

  it("uses full year depreciation when acquired January 1", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 120000,
      usefulLifeYears: 10,
      residualValue: 0,
    })

    const y1 = calculateLinearDepreciation(asset, 2025)
    expect(y1).toBe(12000)
  })
})

describe("degressive depreciation", () => {
  it("applies percentage to book value", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 300000,
      usefulLifeYears: 3,
      depreciationMethod: "degressive",
      residualValue: 0,
    })

    const y1 = calculateDegressiveDepreciation(asset, 2025)
    // Linear rate: 100/3 = 33.33%, max degressive: min(25, 33.33*2.5) = 25%
    // Year 1: 300000 * 25% = 75000
    expect(y1).toBe(75000)
  })

  it("caps degressive rate at 25%", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 100000,
      usefulLifeYears: 2, // linear rate: 50%, 2.5x = 125%, capped at 25%
      depreciationMethod: "degressive",
      residualValue: 0,
    })

    const y1 = calculateDegressiveDepreciation(asset, 2025)
    // Max rate is 25%, so: 100000 * 25% = 25000
    expect(y1).toBe(25000)
  })

  it("caps degressive rate at 2.5x linear rate", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 100000,
      usefulLifeYears: 20, // linear: 5%, 2.5x = 12.5% (< 25%)
      depreciationMethod: "degressive",
      residualValue: 0,
    })

    const y1 = calculateDegressiveDepreciation(asset, 2025)
    // Rate: min(25, 5*2.5) = 12.5%
    // 100000 * 12.5% = 12500
    expect(y1).toBe(12500)
  })

  it("switches to linear when more favorable", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 100000,
      usefulLifeYears: 10,
      depreciationMethod: "degressive",
      residualValue: 0,
    })

    // After several years of degressive, linear should become larger
    const schedule = generateDepreciationSchedule(asset)

    // Schedule should fully depreciate the asset
    const totalDep = schedule.reduce((sum, e) => sum + e.depreciation, 0)
    expect(totalDep).toBe(100000)
  })
})

describe("GWG classification", () => {
  it("classifies <= 800 EUR netto as GWG", () => {
    expect(isGWG(80000)).toBe(true)  // exactly 800 EUR
    expect(isGWG(79999)).toBe(true)  // just under 800
    expect(isGWG(1)).toBe(true)      // very small
    expect(isGWG(0)).toBe(true)      // zero
  })

  it("rejects > 800 EUR netto as not GWG", () => {
    expect(isGWG(80001)).toBe(false)
    expect(isGWG(100000)).toBe(false)
  })

  it("sofort abschreibbar in acquisition year", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-06-15"),
      acquisitionCost: 60000, // 600 EUR
      usefulLifeYears: 3,
      depreciationMethod: "gwg",
      residualValue: 0,
    })

    const y1 = calculateLinearDepreciation(asset, 2025)
    expect(y1).toBe(60000) // full amount in year 1

    const y2 = calculateLinearDepreciation(asset, 2026)
    expect(y2).toBe(0)
  })
})

describe("Sammelposten classification", () => {
  it("classifies 250.01 - 800 EUR as Sammelposten-eligible", () => {
    expect(isSammelposten(25002)).toBe(true)
    expect(isSammelposten(50000)).toBe(true)
    expect(isSammelposten(80000)).toBe(true)
  })

  it("excludes amounts <= 250.01 EUR", () => {
    expect(isSammelposten(25001)).toBe(false)
    expect(isSammelposten(25000)).toBe(false)
    expect(isSammelposten(10000)).toBe(false)
  })

  it("excludes amounts > 800 EUR", () => {
    expect(isSammelposten(80001)).toBe(false)
    expect(isSammelposten(100000)).toBe(false)
  })

  it("depreciates Sammelposten over 5 years equally", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 50000, // 500 EUR
      usefulLifeYears: 3, // ignored for Sammelposten
      depreciationMethod: "sammelposten",
      residualValue: 0,
    })

    const y1 = calculateLinearDepreciation(asset, 2025)
    const y2 = calculateLinearDepreciation(asset, 2026)
    const y3 = calculateLinearDepreciation(asset, 2027)
    const y4 = calculateLinearDepreciation(asset, 2028)
    const y5 = calculateLinearDepreciation(asset, 2029)
    const y6 = calculateLinearDepreciation(asset, 2030)

    expect(y1).toBe(10000) // 50000 / 5
    expect(y2).toBe(10000)
    expect(y3).toBe(10000)
    expect(y4).toBe(10000)
    expect(y5).toBe(10000)
    expect(y6).toBe(0) // nothing after 5 years
  })
})

describe("depreciation schedule generation", () => {
  it("generates correct number of entries for linear depreciation", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 300000,
      usefulLifeYears: 3,
      residualValue: 0,
    })

    const schedule = generateDepreciationSchedule(asset)

    expect(schedule.length).toBe(3)
    expect(schedule[0].year).toBe(2025)
    expect(schedule[2].year).toBe(2027)
  })

  it("tracks start/end values and accumulated depreciation", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 300000,
      usefulLifeYears: 3,
      residualValue: 0,
    })

    const schedule = generateDepreciationSchedule(asset)

    expect(schedule[0].startValue).toBe(300000)
    expect(schedule[0].depreciation).toBe(100000)
    expect(schedule[0].endValue).toBe(200000)
    expect(schedule[0].accumulatedDepreciation).toBe(100000)

    expect(schedule[1].startValue).toBe(200000)
    expect(schedule[1].endValue).toBe(100000)
    expect(schedule[1].accumulatedDepreciation).toBe(200000)

    expect(schedule[2].endValue).toBe(0)
    expect(schedule[2].accumulatedDepreciation).toBe(300000)
  })

  it("generates single entry for GWG", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-06-15"),
      acquisitionCost: 50000,
      depreciationMethod: "gwg",
      residualValue: 0,
    })

    const schedule = generateDepreciationSchedule(asset)

    expect(schedule.length).toBe(1)
    expect(schedule[0].depreciation).toBe(50000)
    expect(schedule[0].endValue).toBe(0)
  })

  it("generates 5 entries for Sammelposten", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 50000,
      depreciationMethod: "sammelposten",
      residualValue: 0,
    })

    const schedule = generateDepreciationSchedule(asset)

    expect(schedule.length).toBe(5)
    expect(schedule[4].endValue).toBe(0)
  })
})

describe("useful life lookup from AfA-Tabelle", () => {
  it("returns 3 for computer", () => {
    expect(getUsefulLife("computer")).toBe(3)
  })

  it("returns 6 for pkw", () => {
    expect(getUsefulLife("pkw")).toBe(6)
  })

  it("returns 13 for bueromoebel", () => {
    expect(getUsefulLife("bueromoebel")).toBe(13)
  })

  it("returns 20 for photovoltaik", () => {
    expect(getUsefulLife("photovoltaik")).toBe(20)
  })

  it("returns null for unknown category", () => {
    expect(getUsefulLife("unknown_item")).toBeNull()
  })

  it("normalizes input (strips non-alphanumeric chars)", () => {
    expect(getUsefulLife("Büro-Möbel")).toBe(13) // becomes bueromoebel
  })

  it("is case insensitive", () => {
    expect(getUsefulLife("Computer")).toBe(3)
    expect(getUsefulLife("COMPUTER")).toBe(3)
  })
})

describe("asset disposal", () => {
  it("generates asset register with disposal tracking", async () => {
    vi.mocked(prisma.fixedAsset.findMany).mockResolvedValue([
      {
        id: "asset-1",
        userId: "user-1",
        name: "Old Laptop",
        acquisitionDate: new Date("2022-01-01"),
        acquisitionCost: 200000,
        usefulLifeYears: 3,
        depreciationMethod: "linear",
        residualValue: 0,
        category: "computer",
        inventoryNumber: "INV-001",
        disposalDate: new Date("2024-06-15"),
        isActive: false,
      },
    ] as any)

    const register = await generateAssetRegister("user-1")

    expect(register.entries.length).toBe(1)
    expect(register.entries[0].isActive).toBe(false)
    // Disposed asset: full depreciation applied
    expect(register.entries[0].accumulatedDepreciation).toBe(200000)
    expect(register.entries[0].bookValue).toBe(0)
  })
})

describe("residual value handling", () => {
  it("stops depreciation at residual value", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 100000,
      usefulLifeYears: 3,
      residualValue: 10000, // 100 EUR
    })

    const schedule = generateDepreciationSchedule(asset)

    const lastEntry = schedule[schedule.length - 1]
    expect(lastEntry.endValue).toBe(10000)
    expect(lastEntry.accumulatedDepreciation).toBe(90000)
  })
})

describe("edge cases", () => {
  it("handles 0 cost asset", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 0,
      usefulLifeYears: 3,
      residualValue: 0,
    })

    const y1 = calculateLinearDepreciation(asset, 2025)
    expect(y1).toBe(0)
  })

  it("handles 0 useful life by treating as immediate write-off (schedule)", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 50000,
      usefulLifeYears: 0,
      depreciationMethod: "gwg",
      residualValue: 0,
    })

    // GWG with 0 years still fully depreciates in year 1
    const y1 = calculateLinearDepreciation(asset, 2025)
    expect(y1).toBe(50000)
  })

  it("handles asset with cost equal to residual value", () => {
    const asset = makeAsset({
      acquisitionDate: new Date("2025-01-01"),
      acquisitionCost: 50000,
      usefulLifeYears: 3,
      residualValue: 50000,
    })

    const y1 = calculateLinearDepreciation(asset, 2025)
    expect(y1).toBe(0) // nothing to depreciate
  })
})
