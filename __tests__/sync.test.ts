import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    finTSBankAccount: {
      update: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/db"
import { syncBankTransactions } from "@/lib/fints/sync"

const mockedPrisma = prisma as unknown as {
  transaction: {
    findFirst: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  finTSBankAccount: {
    update: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

function makeFinTSTransaction(overrides: Record<string, unknown> = {}) {
  return {
    amount: -42.5,
    valueDate: new Date("2025-06-15"),
    entryDate: new Date("2025-06-15"),
    remoteName: "REWE Markt",
    bookingText: "Lastschrift",
    purpose: "REWE SAGT DANKE",
    customerReference: "ref-123",
    e2eReference: "e2e-456",
    additionalInformation: null,
    mandateReference: null,
    remoteAccountNumber: null,
    remoteBankId: null,
    ...overrides,
  }
}

describe("syncBankTransactions", () => {
  const userId = "user-1"
  const bankAccountId = "bank-1"

  it("creates new transactions", async () => {
    const ftx = makeFinTSTransaction()

    mockedPrisma.transaction.findFirst.mockResolvedValue(null)
    mockedPrisma.transaction.create.mockResolvedValue({ id: "tx-new" })
    mockedPrisma.finTSBankAccount.update.mockResolvedValue({})

    const stats = await syncBankTransactions(userId, bankAccountId, [ftx as any])

    expect(stats.imported).toBe(1)
    expect(stats.skipped).toBe(0)
    expect(mockedPrisma.transaction.create).toHaveBeenCalledTimes(1)

    const createCall = mockedPrisma.transaction.create.mock.calls[0][0]
    expect(createCall.data.userId).toBe(userId)
    expect(createCall.data.sourceType).toBe("fints")
    expect(createCall.data.bankAccountId).toBe(bankAccountId)
  })

  it("skips transactions with existing externalId (deduplication)", async () => {
    const ftx = makeFinTSTransaction()

    mockedPrisma.transaction.findFirst.mockResolvedValue({ id: "existing-tx" })
    mockedPrisma.finTSBankAccount.update.mockResolvedValue({})

    const stats = await syncBankTransactions(userId, bankAccountId, [ftx as any])

    expect(stats.skipped).toBe(1)
    expect(stats.imported).toBe(0)
    expect(mockedPrisma.transaction.create).not.toHaveBeenCalled()
  })

  it("sets type to income for positive amounts", async () => {
    const ftx = makeFinTSTransaction({ amount: 150.0 })

    mockedPrisma.transaction.findFirst.mockResolvedValue(null)
    mockedPrisma.transaction.create.mockResolvedValue({ id: "tx-income" })
    mockedPrisma.finTSBankAccount.update.mockResolvedValue({})

    await syncBankTransactions(userId, bankAccountId, [ftx as any])

    const createCall = mockedPrisma.transaction.create.mock.calls[0][0]
    expect(createCall.data.type).toBe("income")
    expect(createCall.data.total).toBe(15000) // 150.00 * 100
  })

  it("sets type to expense for negative amounts", async () => {
    const ftx = makeFinTSTransaction({ amount: -42.5 })

    mockedPrisma.transaction.findFirst.mockResolvedValue(null)
    mockedPrisma.transaction.create.mockResolvedValue({ id: "tx-expense" })
    mockedPrisma.finTSBankAccount.update.mockResolvedValue({})

    await syncBankTransactions(userId, bankAccountId, [ftx as any])

    const createCall = mockedPrisma.transaction.create.mock.calls[0][0]
    expect(createCall.data.type).toBe("expense")
    expect(createCall.data.total).toBe(4250) // abs(-42.5) * 100
  })

  it("counts imported and skipped correctly", async () => {
    const txNew1 = makeFinTSTransaction({ customerReference: "new-1" })
    const txNew2 = makeFinTSTransaction({ customerReference: "new-2" })
    const txExisting = makeFinTSTransaction({ customerReference: "existing" })

    mockedPrisma.transaction.findFirst
      .mockResolvedValueOnce(null)      // new-1: not found
      .mockResolvedValueOnce(null)      // new-2: not found
      .mockResolvedValueOnce({ id: "x" }) // existing: found

    mockedPrisma.transaction.create.mockResolvedValue({ id: "tx" })
    mockedPrisma.finTSBankAccount.update.mockResolvedValue({})

    const stats = await syncBankTransactions(userId, bankAccountId, [
      txNew1 as any,
      txNew2 as any,
      txExisting as any,
    ])

    expect(stats.imported).toBe(2)
    expect(stats.skipped).toBe(1)
    expect(stats.errors).toHaveLength(0)
  })

  it("updates bank account lastSyncAt after sync", async () => {
    const ftx = makeFinTSTransaction()

    mockedPrisma.transaction.findFirst.mockResolvedValue(null)
    mockedPrisma.transaction.create.mockResolvedValue({ id: "tx" })
    mockedPrisma.finTSBankAccount.update.mockResolvedValue({})

    await syncBankTransactions(userId, bankAccountId, [ftx as any])

    expect(mockedPrisma.finTSBankAccount.update).toHaveBeenCalledTimes(1)
    const updateCall = mockedPrisma.finTSBankAccount.update.mock.calls[0][0]
    expect(updateCall.where.id).toBe(bankAccountId)
    expect(updateCall.data.lastSyncAt).toBeInstanceOf(Date)
    expect(updateCall.data.lastSyncStatus).toContain("1 imported")
  })

  it("updates lastSyncStatus with error info when errors occur", async () => {
    const ftx = makeFinTSTransaction()

    mockedPrisma.transaction.findFirst.mockResolvedValue(null)
    mockedPrisma.transaction.create.mockRejectedValue(new Error("DB error"))
    mockedPrisma.finTSBankAccount.update.mockResolvedValue({})

    const stats = await syncBankTransactions(userId, bankAccountId, [ftx as any])

    expect(stats.imported).toBe(0)
    expect(stats.errors).toHaveLength(1)

    const updateCall = mockedPrisma.finTSBankAccount.update.mock.calls[0][0]
    expect(updateCall.data.lastSyncStatus).toContain("error")
  })
})
