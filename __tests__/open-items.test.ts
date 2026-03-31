import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    openItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

import {
  getOpenItems,
  createOpenItem,
  markAsPaid,
  autoMatchPayments,
  getAgingReport,
  getDebitSaldenliste,
  getKreditorSaldenliste,
  calcDaysPastDue,
} from "@/lib/open-items"
import { prisma } from "@/lib/db"

const mockedOpenItemFindMany = vi.mocked(prisma.openItem.findMany)
const mockedOpenItemFindFirst = vi.mocked(prisma.openItem.findFirst)
const mockedOpenItemCreate = vi.mocked(prisma.openItem.create)
const mockedOpenItemUpdate = vi.mocked(prisma.openItem.update)
const mockedTransactionFindMany = vi.mocked(prisma.transaction.findMany)

function makeOpenItem(overrides: Record<string, any> = {}): any {
  return {
    id: "oi-001",
    userId: "user-1",
    type: "debitor",
    invoiceNumber: "RE-2026-001",
    invoiceDate: new Date("2026-01-15"),
    dueDate: new Date("2026-02-14"),
    merchant: "ACME GmbH",
    merchantAddress: null,
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

describe("calcDaysPastDue", () => {
  it("returns 0 for a future due date", () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 10)
    expect(calcDaysPastDue(futureDate)).toBe(0)
  })

  it("returns correct days for a past due date", () => {
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 30)
    expect(calcDaysPastDue(pastDate)).toBe(30)
  })

  it("returns 0 for today's due date", () => {
    expect(calcDaysPastDue(new Date())).toBe(0)
  })
})

describe("getOpenItems", () => {
  it("returns mapped open items", async () => {
    mockedOpenItemFindMany.mockResolvedValue([makeOpenItem()])
    const items = await getOpenItems("user-1")
    expect(items).toHaveLength(1)
    expect(items[0].invoiceNumber).toBe("RE-2026-001")
    expect(items[0].remainingAmount).toBe(11900)
  })

  it("filters by type", async () => {
    mockedOpenItemFindMany.mockResolvedValue([])
    await getOpenItems("user-1", "kreditor")
    expect(mockedOpenItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "kreditor" }),
      })
    )
  })

  it("filters by status", async () => {
    mockedOpenItemFindMany.mockResolvedValue([])
    await getOpenItems("user-1", undefined, "overdue")
    expect(mockedOpenItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "overdue" }),
      })
    )
  })
})

describe("createOpenItem", () => {
  it("creates a new open item with status open", async () => {
    const input = {
      type: "debitor" as const,
      invoiceNumber: "RE-2026-002",
      invoiceDate: new Date("2026-03-01"),
      dueDate: new Date("2026-03-31"),
      merchant: "Test GmbH",
      amount: 5000,
    }
    mockedOpenItemCreate.mockResolvedValue(makeOpenItem({
      ...input,
      id: "oi-new",
      status: "open",
    }))

    const item = await createOpenItem("user-1", input)
    expect(item.status).toBe("open")
    expect(mockedOpenItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          invoiceNumber: "RE-2026-002",
          status: "open",
        }),
      })
    )
  })
})

describe("markAsPaid", () => {
  it("marks as fully paid", async () => {
    mockedOpenItemFindFirst.mockResolvedValue(makeOpenItem({ amount: 10000, paidAmount: 0 }))
    mockedOpenItemUpdate.mockResolvedValue(makeOpenItem({ amount: 10000, paidAmount: 10000, status: "paid" }))

    const result = await markAsPaid("oi-001", "user-1")
    expect(result.status).toBe("paid")
    expect(mockedOpenItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paidAmount: 10000, status: "paid" }),
      })
    )
  })

  it("marks as partial when partial amount provided", async () => {
    mockedOpenItemFindFirst.mockResolvedValue(makeOpenItem({ amount: 10000, paidAmount: 0 }))
    mockedOpenItemUpdate.mockResolvedValue(makeOpenItem({ amount: 10000, paidAmount: 3000, status: "partial" }))

    const result = await markAsPaid("oi-001", "user-1", 3000)
    expect(result.status).toBe("partial")
  })

  it("throws error for non-existent item", async () => {
    mockedOpenItemFindFirst.mockResolvedValue(null)
    await expect(markAsPaid("oi-999", "user-1")).rejects.toThrow("Offener Posten nicht gefunden")
  })
})

describe("getAgingReport", () => {
  it("groups items into correct aging buckets", async () => {
    const now = new Date()
    const days10Ago = new Date(now)
    days10Ago.setDate(days10Ago.getDate() - 10)
    const days45Ago = new Date(now)
    days45Ago.setDate(days45Ago.getDate() - 45)
    const days75Ago = new Date(now)
    days75Ago.setDate(days75Ago.getDate() - 75)
    const days100Ago = new Date(now)
    days100Ago.setDate(days100Ago.getDate() - 100)

    mockedOpenItemFindMany.mockResolvedValue([
      makeOpenItem({ dueDate: days10Ago, amount: 1000, paidAmount: 0 }),
      makeOpenItem({ dueDate: days45Ago, amount: 2000, paidAmount: 0 }),
      makeOpenItem({ dueDate: days75Ago, amount: 3000, paidAmount: 0 }),
      makeOpenItem({ dueDate: days100Ago, amount: 4000, paidAmount: 0 }),
    ])

    const report = await getAgingReport("user-1")
    expect(report).toHaveLength(4)
    expect(report[0].label).toBe("0-30 Tage")
    expect(report[0].count).toBe(1)
    expect(report[0].totalAmount).toBe(1000)
    expect(report[1].label).toBe("31-60 Tage")
    expect(report[1].count).toBe(1)
    expect(report[1].totalAmount).toBe(2000)
    expect(report[2].label).toBe("61-90 Tage")
    expect(report[2].count).toBe(1)
    expect(report[2].totalAmount).toBe(3000)
    expect(report[3].label).toBe("90+ Tage")
    expect(report[3].count).toBe(1)
    expect(report[3].totalAmount).toBe(4000)
  })

  it("returns zero buckets when no items", async () => {
    mockedOpenItemFindMany.mockResolvedValue([])
    const report = await getAgingReport("user-1")
    expect(report).toHaveLength(4)
    report.forEach(b => {
      expect(b.count).toBe(0)
      expect(b.totalAmount).toBe(0)
    })
  })
})

describe("autoMatchPayments", () => {
  it("matches transaction by amount and merchant", async () => {
    // Open items (status filter)
    mockedOpenItemFindMany
      .mockResolvedValueOnce([makeOpenItem({
        id: "oi-001",
        amount: 5000,
        paidAmount: 0,
        merchant: "ACME GmbH",
        invoiceNumber: "RE-001",
        transactionId: null,
      })])
      // Already linked
      .mockResolvedValueOnce([])

    mockedTransactionFindMany.mockResolvedValue([
      {
        id: "tx-100",
        total: -5000,
        merchant: "ACME GmbH",
        text: "Zahlung RE-001",
        type: "income",
      } as any,
    ])

    mockedOpenItemUpdate.mockResolvedValue({} as any)

    const result = await autoMatchPayments("user-1")
    expect(result.matched).toBe(1)
    expect(result.unmatched).toBe(0)
  })
})

describe("Saldenlisten", () => {
  it("groups debitor items by merchant", async () => {
    mockedOpenItemFindMany.mockResolvedValue([
      makeOpenItem({ merchant: "ACME GmbH", amount: 5000, paidAmount: 1000 }),
      makeOpenItem({ merchant: "ACME GmbH", amount: 3000, paidAmount: 0 }),
      makeOpenItem({ merchant: "Other AG", amount: 2000, paidAmount: 2000 }),
    ])

    const saldo = await getDebitSaldenliste("user-1")
    // "Other AG" has 0 remaining so won't appear if status != paid (but our mock returns it)
    expect(saldo.length).toBeGreaterThanOrEqual(1)
    const acme = saldo.find(s => s.merchant === "ACME GmbH")
    expect(acme).toBeDefined()
    expect(acme!.openCount).toBe(2)
    expect(acme!.remainingAmount).toBe(7000)
  })
})
