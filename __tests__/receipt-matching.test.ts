import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    file: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
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
import {
  findMatchingTransactions,
  linkReceiptToTransaction,
} from "@/lib/fints/receipt-matching"

const mockedPrisma = prisma as unknown as {
  file: {
    findFirst: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
  }
  transaction: {
    findFirst: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("findMatchingTransactions", () => {
  const userId = "user-1"
  const fileId = "file-1"

  it("finds exact amount match", async () => {
    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
      cachedParseResult: { total: 4999 },
    })

    mockedPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "tx-1",
        total: 4999,
        issuedAt: null,
        merchant: null,
      },
    ])

    const results = await findMatchingTransactions(userId, fileId)

    expect(results).toHaveLength(1)
    expect(results[0].transactionId).toBe("tx-1")
    expect(results[0].confidence).toBeGreaterThanOrEqual(0.5)
  })

  it("scores 0.3 for same day date proximity", async () => {
    const date = new Date("2025-06-15T12:00:00Z")

    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
      cachedParseResult: { total: 1000, issuedAt: "2025-06-15" },
    })

    mockedPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "tx-1",
        total: 1000,
        issuedAt: new Date("2025-06-15T14:00:00Z"),
        merchant: null,
      },
    ])

    const results = await findMatchingTransactions(userId, fileId)

    expect(results).toHaveLength(1)
    // 0.5 (amount) + 0.3 (same day) = 0.8
    expect(results[0].confidence).toBeCloseTo(0.8, 1)
  })

  it("scores 0.2 for ±1 day date proximity", async () => {
    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
      cachedParseResult: { total: 1000, issuedAt: "2025-06-15T00:00:00Z" },
    })

    mockedPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "tx-1",
        total: 1000,
        issuedAt: new Date("2025-06-16T00:00:00Z"),
        merchant: null,
      },
    ])

    const results = await findMatchingTransactions(userId, fileId)

    expect(results).toHaveLength(1)
    // 0.5 (amount) + 0.2 (±1 day) = 0.7
    expect(results[0].confidence).toBeCloseTo(0.7, 1)
  })

  it("scores 0.1 for ±3 days date proximity", async () => {
    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
      cachedParseResult: { total: 1000, issuedAt: "2025-06-15T00:00:00Z" },
    })

    mockedPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "tx-1",
        total: 1000,
        issuedAt: new Date("2025-06-17T12:00:00Z"),
        merchant: null,
      },
    ])

    const results = await findMatchingTransactions(userId, fileId)

    expect(results).toHaveLength(1)
    // 0.5 (amount) + 0.1 (±3 days) = 0.6
    expect(results[0].confidence).toBeCloseTo(0.6, 1)
  })

  it("gives 0.5 confidence for exact amount match", async () => {
    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
      cachedParseResult: { total: 2500 },
    })

    mockedPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "tx-1",
        total: 2500,
        issuedAt: null,
        merchant: null,
      },
    ])

    const results = await findMatchingTransactions(userId, fileId)

    expect(results[0].confidence).toBe(0.5)
  })

  it("adds merchant similarity score when merchants match", async () => {
    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
      cachedParseResult: { total: 1000, merchant: "REWE" },
    })

    mockedPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "tx-1",
        total: 1000,
        issuedAt: null,
        merchant: "REWE",
      },
    ])

    const results = await findMatchingTransactions(userId, fileId)

    expect(results).toHaveLength(1)
    // 0.5 (amount) + 0.2 * 1.0 (exact merchant match) = 0.7
    expect(results[0].confidence).toBeCloseTo(0.7, 1)
    expect(results[0].matchReasons.some((r: string) => r.includes("Händler"))).toBe(true)
  })

  it("returns empty array when no matches exist", async () => {
    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
      cachedParseResult: { total: 9999 },
    })

    mockedPrisma.transaction.findMany.mockResolvedValue([])

    const results = await findMatchingTransactions(userId, fileId)

    expect(results).toEqual([])
  })

  it("returns empty array when file has no cachedParseResult", async () => {
    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
      cachedParseResult: null,
    })

    const results = await findMatchingTransactions(userId, fileId)

    expect(results).toEqual([])
  })

  it("returns empty array when file is not found", async () => {
    mockedPrisma.file.findFirst.mockResolvedValue(null)

    const results = await findMatchingTransactions(userId, fileId)

    expect(results).toEqual([])
  })

  it("sorts results by confidence descending", async () => {
    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
      cachedParseResult: { total: 1000, issuedAt: "2025-06-15T00:00:00Z", merchant: "REWE" },
    })

    mockedPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "tx-low",
        total: 1000,
        issuedAt: new Date("2025-06-18T00:00:00Z"), // 3 days away
        merchant: null,
      },
      {
        id: "tx-high",
        total: 1000,
        issuedAt: new Date("2025-06-15T06:00:00Z"), // same day
        merchant: "REWE",
      },
    ])

    const results = await findMatchingTransactions(userId, fileId)

    expect(results.length).toBe(2)
    expect(results[0].transactionId).toBe("tx-high")
    expect(results[1].transactionId).toBe("tx-low")
    expect(results[0].confidence).toBeGreaterThan(results[1].confidence)
  })
})

describe("linkReceiptToTransaction", () => {
  const userId = "user-1"
  const transactionId = "tx-1"
  const fileId = "file-1"

  it("appends file ID to transaction files array", async () => {
    mockedPrisma.transaction.findUnique.mockResolvedValue({
      id: transactionId,
      userId,
      files: ["existing-file"],
    })

    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
    })

    mockedPrisma.transaction.update.mockResolvedValue({})

    await linkReceiptToTransaction(userId, transactionId, fileId)

    expect(mockedPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: transactionId, userId },
      data: {
        files: ["existing-file", fileId],
      },
    })
  })

  it("does not add duplicate file ID", async () => {
    mockedPrisma.transaction.findUnique.mockResolvedValue({
      id: transactionId,
      userId,
      files: [fileId],
    })

    mockedPrisma.file.findFirst.mockResolvedValue({
      id: fileId,
      userId,
    })

    await linkReceiptToTransaction(userId, transactionId, fileId)

    expect(mockedPrisma.transaction.update).not.toHaveBeenCalled()
  })

  it("throws when transaction not found", async () => {
    mockedPrisma.transaction.findUnique.mockResolvedValue(null)

    await expect(
      linkReceiptToTransaction(userId, transactionId, fileId),
    ).rejects.toThrow("Transaktion nicht gefunden")
  })

  it("throws when file not found", async () => {
    mockedPrisma.transaction.findUnique.mockResolvedValue({
      id: transactionId,
      userId,
      files: [],
    })

    mockedPrisma.file.findFirst.mockResolvedValue(null)

    await expect(
      linkReceiptToTransaction(userId, transactionId, fileId),
    ).rejects.toThrow("Datei nicht gefunden")
  })
})
