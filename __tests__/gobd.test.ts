import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/models/audit-log", () => ({
  logAuditEvent: vi.fn(),
}))

import { prisma } from "@/lib/db"
import {
  lockTransaction,
  lockTransactionsUntil,
  createReversalBooking,
  canModifyTransaction,
} from "@/lib/gobd"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("lockTransaction", () => {
  it("sets isLocked=true and lockedAt on the transaction", async () => {
    const mockTx = {
      id: "tx-1",
      userId: "user-1",
      isLocked: false,
      bookingNumber: 1,
    }
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTx as any)
    vi.mocked(prisma.transaction.update).mockResolvedValue({} as any)

    await lockTransaction("user-1", "tx-1")

    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "tx-1", userId: "user-1" },
      data: {
        isLocked: true,
        lockedAt: expect.any(Date),
      },
    })
  })

  it("throws if transaction not found", async () => {
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue(null)

    await expect(lockTransaction("user-1", "tx-missing")).rejects.toThrow(
      "Transaction not found",
    )
  })

  it("throws if transaction is already locked", async () => {
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue({
      id: "tx-1",
      isLocked: true,
    } as any)

    await expect(lockTransaction("user-1", "tx-1")).rejects.toThrow(
      "Transaction is already locked",
    )
  })
})

describe("lockTransactionsUntil", () => {
  it("updates all transactions before the given date", async () => {
    vi.mocked(prisma.transaction.updateMany).mockResolvedValue({ count: 5 } as any)

    const until = new Date("2025-03-31T23:59:59Z")
    const count = await lockTransactionsUntil("user-1", until)

    expect(count).toBe(5)
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        isLocked: false,
        issuedAt: { lte: until },
      },
      data: {
        isLocked: true,
        lockedAt: expect.any(Date),
      },
    })
  })
})

describe("createReversalBooking", () => {
  const originalTx = {
    id: "tx-1",
    userId: "user-1",
    name: "Invoice #42",
    description: "Consulting",
    merchant: "Acme Corp",
    total: 11900,
    currencyCode: "EUR",
    convertedTotal: null,
    convertedCurrencyCode: null,
    type: "income",
    categoryCode: "income",
    projectCode: null,
    issuedAt: new Date("2025-01-15"),
    sourceType: "manual",
    isLocked: true,
    lockedAt: new Date("2025-02-01"),
    reversedById: null,
    bookingNumber: 1,
  }

  it("creates a new transaction with negated amount", async () => {
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue(originalTx as any)

    const reversalTx = {
      ...originalTx,
      id: "tx-reversal-1",
      name: "Storno: Invoice #42",
      total: -11900,
      isLocked: true,
      reversalOfId: "tx-1",
    }

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        transaction: {
          create: vi.fn().mockResolvedValue(reversalTx),
          update: vi.fn().mockResolvedValue({} as any),
        },
      }
      return cb(tx)
    })

    const result = await createReversalBooking("user-1", "tx-1", "Error in invoice")

    expect(result.total).toBe(-11900)
    expect(result.name).toBe("Storno: Invoice #42")
  })

  it("locks both original and reversal", async () => {
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue(originalTx as any)

    const mockCreate = vi.fn().mockResolvedValue({
      id: "tx-reversal-1",
      total: -11900,
      isLocked: true,
      lockedAt: expect.any(Date),
    })
    const mockUpdate = vi.fn().mockResolvedValue({})

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      return cb({ transaction: { create: mockCreate, update: mockUpdate } })
    })

    await createReversalBooking("user-1", "tx-1", "Error")

    // The reversal is created with isLocked: true
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isLocked: true,
          lockedAt: expect.any(Date),
        }),
      }),
    )

    // The original is updated with the reversal link
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tx-1" },
        data: { reversedById: "tx-reversal-1" },
      }),
    )
  })

  it("throws if transaction not found", async () => {
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue(null)

    await expect(
      createReversalBooking("user-1", "tx-missing", "reason"),
    ).rejects.toThrow("Transaction not found")
  })

  it("throws if transaction is not locked", async () => {
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue({
      ...originalTx,
      isLocked: false,
    } as any)

    await expect(
      createReversalBooking("user-1", "tx-1", "reason"),
    ).rejects.toThrow("Transaction is not locked")
  })

  it("throws if transaction has already been reversed", async () => {
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue({
      ...originalTx,
      reversedById: "tx-old-reversal",
    } as any)

    await expect(
      createReversalBooking("user-1", "tx-1", "reason"),
    ).rejects.toThrow("Transaction has already been reversed")
  })
})

describe("canModifyTransaction", () => {
  it("returns false for locked transactions", async () => {
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue({
      isLocked: true,
    } as any)

    const result = await canModifyTransaction("user-1", "tx-1")
    expect(result).toBe(false)
  })

  it("returns true for unlocked transactions", async () => {
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue({
      isLocked: false,
    } as any)

    const result = await canModifyTransaction("user-1", "tx-1")
    expect(result).toBe(true)
  })

  it("throws if transaction not found", async () => {
    vi.mocked(prisma.transaction.findUnique).mockResolvedValue(null)

    await expect(canModifyTransaction("user-1", "tx-missing")).rejects.toThrow(
      "Transaction not found",
    )
  })
})
