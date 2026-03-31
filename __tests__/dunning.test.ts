import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    openItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    dunningEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import {
  calculateDefaultInterest,
  BASISZINS,
  B2B_MARKUP,
  B2C_MARKUP,
  DEFAULT_DUNNING_CONFIG,
  getDunningCandidates,
  generateDunningLetter,
  executeDunning,
  getDunningHistory,
} from "@/lib/dunning"
import { prisma } from "@/lib/db"

const mockedOpenItemFindMany = vi.mocked(prisma.openItem.findMany)
const mockedOpenItemFindFirst = vi.mocked(prisma.openItem.findFirst)
const mockedTransaction = vi.mocked(prisma.$transaction)
const mockedDunningEntryFindMany = vi.mocked(prisma.dunningEntry.findMany)

function makeOpenItem(overrides: Record<string, any> = {}): any {
  const now = new Date()
  const dueDate = new Date(now)
  dueDate.setDate(dueDate.getDate() - 30)
  return {
    id: "oi-001",
    userId: "user-1",
    type: "debitor",
    invoiceNumber: "RE-2026-001",
    invoiceDate: new Date("2026-01-15"),
    dueDate,
    merchant: "ACME GmbH",
    merchantAddress: "Musterstraße 1, 12345 Berlin",
    amount: 11900,
    paidAmount: 0,
    status: "open",
    dunningLevel: 0,
    lastDunningDate: null,
    dunningFees: 0,
    interestAccrued: 0,
    transactionId: null,
    notes: null,
    isB2B: true,
    createdAt: new Date("2026-01-15"),
    updatedAt: new Date("2026-01-15"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("calculateDefaultInterest", () => {
  it("returns 0 for 0 days past due", () => {
    expect(calculateDefaultInterest(10000, 0, true)).toBe(0)
  })

  it("returns 0 for 0 amount", () => {
    expect(calculateDefaultInterest(0, 30, true)).toBe(0)
  })

  it("calculates B2B interest correctly (Basiszins + 9%)", () => {
    const amount = 100000 // 1000.00 EUR
    const days = 365
    const expectedRate = (BASISZINS + B2B_MARKUP) / 100
    const expected = Math.round(amount * expectedRate)
    const result = calculateDefaultInterest(amount, days, true)
    expect(result).toBe(expected)
  })

  it("calculates B2C interest correctly (Basiszins + 5%)", () => {
    const amount = 100000
    const days = 365
    const expectedRate = (BASISZINS + B2C_MARKUP) / 100
    const expected = Math.round(amount * expectedRate)
    const result = calculateDefaultInterest(amount, days, false)
    expect(result).toBe(expected)
  })

  it("B2B interest is higher than B2C interest", () => {
    const b2b = calculateDefaultInterest(10000, 90, true)
    const b2c = calculateDefaultInterest(10000, 90, false)
    expect(b2b).toBeGreaterThan(b2c)
  })

  it("interest scales linearly with days", () => {
    const interest30 = calculateDefaultInterest(10000, 30, true)
    const interest60 = calculateDefaultInterest(10000, 60, true)
    // Should be approximately double (within rounding tolerance)
    expect(Math.abs(interest60 - interest30 * 2)).toBeLessThanOrEqual(1)
  })
})

describe("DEFAULT_DUNNING_CONFIG", () => {
  it("has sensible German defaults", () => {
    expect(DEFAULT_DUNNING_CONFIG.paymentTermDays).toBe(30)
    expect(DEFAULT_DUNNING_CONFIG.firstReminderDays).toBe(14)
    expect(DEFAULT_DUNNING_CONFIG.secondReminderDays).toBe(28)
    expect(DEFAULT_DUNNING_CONFIG.thirdReminderDays).toBe(42)
    expect(DEFAULT_DUNNING_CONFIG.dunningFee1).toBe(0)
    expect(DEFAULT_DUNNING_CONFIG.dunningFee2).toBe(500)
    expect(DEFAULT_DUNNING_CONFIG.dunningFee3).toBe(1000)
  })
})

describe("getDunningCandidates", () => {
  it("finds items ready for first dunning after 14 days", async () => {
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() - 15) // 15 days past due
    mockedOpenItemFindMany.mockResolvedValue([makeOpenItem({ dueDate, dunningLevel: 0 })])

    const candidates = await getDunningCandidates("user-1")
    expect(candidates).toHaveLength(1)
    expect(candidates[0].nextLevel).toBe(1)
  })

  it("does not include items not yet past due threshold", async () => {
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() - 10) // Only 10 days past due
    mockedOpenItemFindMany.mockResolvedValue([makeOpenItem({ dueDate, dunningLevel: 0 })])

    const candidates = await getDunningCandidates("user-1")
    expect(candidates).toHaveLength(0)
  })

  it("skips items already at dunning level 3", async () => {
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() - 60)
    mockedOpenItemFindMany.mockResolvedValue([makeOpenItem({ dueDate, dunningLevel: 3 })])

    const candidates = await getDunningCandidates("user-1")
    expect(candidates).toHaveLength(0)
  })

  it("suggests correct fee for level 2", async () => {
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() - 30)
    mockedOpenItemFindMany.mockResolvedValue([makeOpenItem({ dueDate, dunningLevel: 1 })])

    const candidates = await getDunningCandidates("user-1")
    expect(candidates).toHaveLength(1)
    expect(candidates[0].nextLevel).toBe(2)
    expect(candidates[0].suggestedFee).toBe(500) // 5.00 EUR
  })
})

describe("generateDunningLetter", () => {
  const baseItem = {
    invoiceNumber: "RE-2026-001",
    invoiceDate: new Date("2026-01-15"),
    dueDate: new Date("2026-02-14"),
    merchant: "ACME GmbH",
    merchantAddress: "Musterstraße 1",
    amount: 11900,
    paidAmount: 0,
    isB2B: true,
    dunningFees: 0,
    interestAccrued: 0,
  }

  it("level 1 is a friendly reminder (Zahlungserinnerung)", () => {
    const letter = generateDunningLetter(baseItem, 1)
    expect(letter).toContain("Zahlungserinnerung")
    expect(letter).toContain("RE-2026-001")
    expect(letter).toContain("Versehen")
    expect(letter).not.toContain("Inkasso")
  })

  it("level 2 includes Mahngebühr", () => {
    const letter = generateDunningLetter(baseItem, 2)
    expect(letter).toContain("2. Mahnung")
    expect(letter).toContain("Mahngebühr")
    expect(letter).toContain("5,00 €")
  })

  it("level 3 includes Inkasso-Androhung and §288 BGB", () => {
    const letter = generateDunningLetter(baseItem, 3)
    expect(letter).toContain("Letzte Mahnung")
    expect(letter).toContain("Inkasso")
    expect(letter).toContain("§288")
    expect(letter).toContain("Verzugszinsen")
  })

  it("level 3 references correct interest rate for B2B", () => {
    const letter = generateDunningLetter(baseItem, 3)
    const expectedRate = (BASISZINS + B2B_MARKUP).toFixed(2).replace(".", ",")
    expect(letter).toContain(expectedRate)
    expect(letter).toContain("9 Prozentpunkte")
  })

  it("level 3 references correct interest rate for B2C", () => {
    const letter = generateDunningLetter({ ...baseItem, isB2B: false }, 3)
    const expectedRate = (BASISZINS + B2C_MARKUP).toFixed(2).replace(".", ",")
    expect(letter).toContain(expectedRate)
    expect(letter).toContain("5 Prozentpunkte")
  })
})

describe("executeDunning", () => {
  it("advances dunning level and records entry", async () => {
    const item = makeOpenItem({ dunningLevel: 0 })
    mockedOpenItemFindFirst.mockResolvedValue(item)

    const mockEntry = {
      id: "de-001",
      openItemId: "oi-001",
      level: 1,
      date: new Date(),
      fee: 0,
      interest: expect.any(Number),
      letterText: expect.any(String),
      sentVia: null,
      createdAt: new Date(),
    }

    mockedTransaction.mockResolvedValue([mockEntry, {}])

    const result = await executeDunning("oi-001", "user-1")
    expect(result.level).toBe(1)
    expect(mockedTransaction).toHaveBeenCalled()
  })

  it("throws for non-existent item", async () => {
    mockedOpenItemFindFirst.mockResolvedValue(null)
    await expect(executeDunning("oi-999", "user-1")).rejects.toThrow("Offener Posten nicht gefunden")
  })

  it("throws when max dunning level reached", async () => {
    mockedOpenItemFindFirst.mockResolvedValue(makeOpenItem({ dunningLevel: 3 }))
    await expect(executeDunning("oi-001", "user-1")).rejects.toThrow("Maximale Mahnstufe")
  })
})

describe("getDunningHistory", () => {
  it("returns sorted entries", async () => {
    mockedDunningEntryFindMany.mockResolvedValue([
      { id: "de-1", level: 1, date: new Date("2026-03-01"), fee: 0, interest: 50, letterText: "...", sentVia: null, createdAt: new Date() } as any,
      { id: "de-2", level: 2, date: new Date("2026-03-15"), fee: 500, interest: 100, letterText: "...", sentVia: "email", createdAt: new Date() } as any,
    ])

    const history = await getDunningHistory("oi-001")
    expect(history).toHaveLength(2)
    expect(history[0].level).toBe(1)
    expect(history[1].level).toBe(2)
    expect(history[1].sentVia).toBe("email")
  })
})
