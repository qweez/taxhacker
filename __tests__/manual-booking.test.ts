import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    bookingSession: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    manualBookingEntry: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
  },
}))

vi.mock("@/models/audit-log", () => ({
  logAuditEvent: vi.fn(),
}))

import { prisma } from "@/lib/db"
import {
  getBookingSessions,
  createBookingSession,
  updateBookingSession,
  deleteBookingSession,
  lockBookingSession,
  getBookingEntries,
  createBookingEntry,
  updateBookingEntry,
  deleteBookingEntry,
  duplicateBookingEntry,
  postBookingSession,
  getBookingTemplates,
  createFromTemplate,
  calculateTaxAmount,
  isValidSKR04Account,
  isCommonSKR04Account,
  checkSessionBalance,
  SKR04_COMMON_ACCOUNTS,
} from "@/lib/manual-booking"

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Tax Calculation ─────────────────────────────────────────

describe("calculateTaxAmount", () => {
  it("calculates 19% tax from gross amount", () => {
    // 119 EUR gross -> 19 EUR tax
    const tax = calculateTaxAmount(11900, 19)
    expect(tax).toBe(1900)
  })

  it("calculates 7% tax from gross amount", () => {
    // 107 EUR gross -> 7 EUR tax
    const tax = calculateTaxAmount(10700, 7)
    expect(tax).toBe(700)
  })

  it("returns 0 for 0% tax rate", () => {
    expect(calculateTaxAmount(10000, 0)).toBe(0)
  })

  it("returns 0 for negative tax rate", () => {
    expect(calculateTaxAmount(10000, -5)).toBe(0)
  })

  it("handles small amounts with rounding", () => {
    // 1.19 EUR gross -> 0.19 EUR tax
    const tax = calculateTaxAmount(119, 19)
    expect(tax).toBe(19)
  })
})

// ─── SKR04 Account Validation ────────────────────────────────

describe("SKR04 account validation", () => {
  it("validates 4-digit numeric account codes", () => {
    expect(isValidSKR04Account("1800")).toBe(true)
    expect(isValidSKR04Account("4400")).toBe(true)
    expect(isValidSKR04Account("0001")).toBe(true)
  })

  it("rejects invalid account codes", () => {
    expect(isValidSKR04Account("abc")).toBe(false)
    expect(isValidSKR04Account("123")).toBe(false)
    expect(isValidSKR04Account("12345")).toBe(false)
    expect(isValidSKR04Account("")).toBe(false)
  })

  it("recognizes common SKR04 accounts", () => {
    expect(isCommonSKR04Account("1800")).toBe(true)
    expect(isCommonSKR04Account("4400")).toBe(true)
    expect(isCommonSKR04Account("1576")).toBe(true)
  })

  it("does not flag non-common but valid accounts", () => {
    expect(isCommonSKR04Account("9999")).toBe(false)
  })

  it("has expected number of common accounts", () => {
    expect(SKR04_COMMON_ACCOUNTS.length).toBeGreaterThanOrEqual(20)
  })
})

// ─── Session CRUD ────────────────────────────────────────────

describe("createBookingSession", () => {
  it("creates a session with valid data", async () => {
    const mockSession = {
      id: "session-1",
      userId: "user-1",
      name: "März 2026",
      periodMonth: 3,
      periodYear: 2026,
      status: "open",
    }
    vi.mocked(prisma.bookingSession.create).mockResolvedValue(mockSession as any)

    const result = await createBookingSession("user-1", {
      name: "März 2026",
      periodMonth: 3,
      periodYear: 2026,
    })

    expect(result.id).toBe("session-1")
    expect(prisma.bookingSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        name: "März 2026",
        periodMonth: 3,
        periodYear: 2026,
      }),
    })
  })

  it("rejects invalid month", async () => {
    await expect(
      createBookingSession("user-1", { name: "Invalid", periodMonth: 13, periodYear: 2026 }),
    ).rejects.toThrow("Monat muss zwischen 1 und 12 liegen.")
  })

  it("rejects invalid year", async () => {
    await expect(
      createBookingSession("user-1", { name: "Invalid", periodMonth: 3, periodYear: 1999 }),
    ).rejects.toThrow("Ungültiges Jahr.")
  })
})

describe("getBookingSessions", () => {
  it("fetches sessions with entry count and totals", async () => {
    vi.mocked(prisma.bookingSession.findMany).mockResolvedValue([
      {
        id: "session-1",
        name: "Test",
        periodMonth: 3,
        periodYear: 2026,
        status: "open",
        _count: { entries: 2 },
        entries: [{ amount: 1000 }, { amount: 2000 }],
      },
    ] as any)

    const sessions = await getBookingSessions("user-1")
    expect(sessions).toHaveLength(1)
    expect(prisma.bookingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
      }),
    )
  })

  it("filters by year and month", async () => {
    vi.mocked(prisma.bookingSession.findMany).mockResolvedValue([])

    await getBookingSessions("user-1", 2026, 3)
    expect(prisma.bookingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", periodYear: 2026, periodMonth: 3 },
      }),
    )
  })
})

describe("deleteBookingSession", () => {
  it("deletes an open session", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "open",
    } as any)
    vi.mocked(prisma.bookingSession.delete).mockResolvedValue({} as any)

    await deleteBookingSession("session-1", "user-1")
    expect(prisma.bookingSession.delete).toHaveBeenCalledWith({ where: { id: "session-1" } })
  })

  it("prevents deleting a locked session", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "locked",
    } as any)

    await expect(deleteBookingSession("session-1", "user-1")).rejects.toThrow(
      "Festgeschriebene Sitzung kann nicht gelöscht werden.",
    )
  })

  it("throws if session not found", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue(null)

    await expect(deleteBookingSession("missing", "user-1")).rejects.toThrow(
      "Buchungssitzung nicht gefunden.",
    )
  })
})

// ─── Session Locking ─────────────────────────────────────────

describe("lockBookingSession", () => {
  it("locks an open session", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "open",
    } as any)
    vi.mocked(prisma.bookingSession.update).mockResolvedValue({
      id: "session-1",
      status: "locked",
      lockedAt: new Date(),
    } as any)

    const result = await lockBookingSession("session-1", "user-1")
    expect(result.status).toBe("locked")
    expect(prisma.bookingSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: {
        status: "locked",
        lockedAt: expect.any(Date),
      },
    })
  })

  it("prevents locking an already locked session", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "locked",
    } as any)

    await expect(lockBookingSession("session-1", "user-1")).rejects.toThrow(
      "Sitzung ist bereits festgeschrieben.",
    )
  })
})

// ─── Entry CRUD ──────────────────────────────────────────────

describe("createBookingEntry", () => {
  it("creates an entry with auto-calculated tax", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "open",
    } as any)
    vi.mocked(prisma.manualBookingEntry.create).mockResolvedValue({
      id: "entry-1",
      amount: 11900,
      taxAmount: 1900,
    } as any)

    const result = await createBookingEntry("session-1", "user-1", {
      bookingDate: new Date("2026-03-15"),
      description: "Bürobedarf",
      debitAccount: "6815",
      creditAccount: "1800",
      amount: 11900,
      taxRate: 19,
    })

    expect(result.id).toBe("entry-1")
    expect(prisma.manualBookingEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 11900,
        taxAmount: 1900,
      }),
    })
  })

  it("rejects invalid debit account", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "open",
    } as any)

    await expect(
      createBookingEntry("session-1", "user-1", {
        bookingDate: new Date(),
        description: "Test",
        debitAccount: "abc",
        creditAccount: "1800",
        amount: 1000,
      }),
    ).rejects.toThrow("Ungültiges Sollkonto: abc")
  })

  it("rejects zero amount", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "open",
    } as any)

    await expect(
      createBookingEntry("session-1", "user-1", {
        bookingDate: new Date(),
        description: "Test",
        debitAccount: "6815",
        creditAccount: "1800",
        amount: 0,
      }),
    ).rejects.toThrow("Betrag muss positiv sein.")
  })

  it("prevents entry in locked session", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "locked",
    } as any)

    await expect(
      createBookingEntry("session-1", "user-1", {
        bookingDate: new Date(),
        description: "Test",
        debitAccount: "6815",
        creditAccount: "1800",
        amount: 1000,
      }),
    ).rejects.toThrow("Festgeschriebene Sitzung kann nicht bearbeitet werden.")
  })
})

// ─── Duplicate Entry ─────────────────────────────────────────

describe("duplicateBookingEntry", () => {
  it("creates a copy of the entry without receipt number", async () => {
    const original = {
      id: "entry-1",
      sessionId: "session-1",
      userId: "user-1",
      bookingDate: new Date("2026-03-15"),
      receiptNumber: "RE-001",
      receiptDate: new Date("2026-03-10"),
      description: "Bürobedarf",
      debitAccount: "6815",
      creditAccount: "1800",
      amount: 11900,
      taxRate: { toNumber: () => 19 },
      taxAmount: 1900,
      costCenter: null,
      merchant: "Staples",
      notes: null,
      isTemplate: false,
      templateName: null,
      transactionId: null,
      session: { id: "session-1", status: "open" },
    }
    vi.mocked(prisma.manualBookingEntry.findFirst).mockResolvedValue(original as any)
    vi.mocked(prisma.manualBookingEntry.create).mockResolvedValue({
      ...original,
      id: "entry-2",
      receiptNumber: null,
    } as any)

    const result = await duplicateBookingEntry("entry-1", "user-1")
    expect(result.id).toBe("entry-2")
    expect(prisma.manualBookingEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        receiptNumber: null,
        description: "Bürobedarf",
        transactionId: null,
        isTemplate: false,
      }),
    })
  })
})

// ─── Posting Session ─────────────────────────────────────────

describe("postBookingSession", () => {
  it("creates transactions for all entries and locks session", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "open",
      entries: [
        {
          id: "entry-1",
          description: "Erlös",
          debitAccount: "1800",
          creditAccount: "4400",
          amount: 11900,
          bookingDate: new Date("2026-03-15"),
          merchant: null,
          notes: null,
          transactionId: null,
        },
        {
          id: "entry-2",
          description: "Bürobedarf",
          debitAccount: "6815",
          creditAccount: "1800",
          amount: 5950,
          bookingDate: new Date("2026-03-16"),
          merchant: "Staples",
          notes: null,
          transactionId: null,
        },
      ],
    } as any)

    vi.mocked(prisma.transaction.create)
      .mockResolvedValueOnce({ id: "tx-1" } as any)
      .mockResolvedValueOnce({ id: "tx-2" } as any)
    vi.mocked(prisma.manualBookingEntry.update).mockResolvedValue({} as any)
    vi.mocked(prisma.bookingSession.update).mockResolvedValue({} as any)

    const result = await postBookingSession("session-1", "user-1")

    expect(result.transactionCount).toBe(2)
    expect(result.transactionIds).toEqual(["tx-1", "tx-2"])
    expect(prisma.transaction.create).toHaveBeenCalledTimes(2)
    // First transaction should be income (creditAccount 4400)
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceType: "manual",
        isLocked: true,
        type: "income",
      }),
    })
    // Session should be locked
    expect(prisma.bookingSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        status: "locked",
      }),
    })
  })

  it("throws if session has no entries", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "open",
      entries: [],
    } as any)

    await expect(postBookingSession("session-1", "user-1")).rejects.toThrow(
      "Sitzung hat keine Buchungseinträge.",
    )
  })

  it("skips already-posted entries", async () => {
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "open",
      entries: [
        {
          id: "entry-1",
          description: "Already posted",
          debitAccount: "1800",
          creditAccount: "4400",
          amount: 1000,
          bookingDate: new Date(),
          merchant: null,
          notes: null,
          transactionId: "existing-tx",
        },
      ],
    } as any)
    vi.mocked(prisma.bookingSession.update).mockResolvedValue({} as any)

    const result = await postBookingSession("session-1", "user-1")
    expect(result.transactionCount).toBe(0)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })
})

// ─── Templates ───────────────────────────────────────────────

describe("getBookingTemplates", () => {
  it("fetches only template entries", async () => {
    vi.mocked(prisma.manualBookingEntry.findMany).mockResolvedValue([
      { id: "t-1", isTemplate: true, templateName: "Miete" },
    ] as any)

    const templates = await getBookingTemplates("user-1")
    expect(templates).toHaveLength(1)
    expect(prisma.manualBookingEntry.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", isTemplate: true },
      orderBy: { templateName: "asc" },
    })
  })
})

describe("createFromTemplate", () => {
  it("creates an entry from a template with overrides", async () => {
    const template = {
      id: "t-1",
      userId: "user-1",
      isTemplate: true,
      bookingDate: new Date("2026-01-01"),
      receiptNumber: null,
      receiptDate: null,
      description: "Miete Büro",
      debitAccount: "6300",
      creditAccount: "1800",
      amount: 150000,
      taxRate: null,
      taxAmount: null,
      costCenter: null,
      merchant: "Vermieter GmbH",
      notes: null,
    }
    vi.mocked(prisma.manualBookingEntry.findFirst).mockResolvedValue(template as any)
    vi.mocked(prisma.bookingSession.findFirst).mockResolvedValue({
      id: "session-2",
      userId: "user-1",
      status: "open",
    } as any)
    vi.mocked(prisma.manualBookingEntry.create).mockResolvedValue({
      ...template,
      id: "entry-new",
      amount: 160000,
    } as any)

    const result = await createFromTemplate("t-1", "session-2", "user-1", {
      amount: 160000,
    })

    expect(result.id).toBe("entry-new")
    expect(prisma.manualBookingEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: "Miete Büro",
        debitAccount: "6300",
        amount: 160000,
      }),
    })
  })
})

// ─── Balance Check ───────────────────────────────────────────

describe("checkSessionBalance", () => {
  it("reports balanced entries", () => {
    const entries = [{ amount: 1000 }, { amount: 2000 }, { amount: 500 }]
    const result = checkSessionBalance(entries)
    expect(result.isBalanced).toBe(true)
    expect(result.debitTotal).toBe(3500)
    expect(result.creditTotal).toBe(3500)
    expect(result.difference).toBe(0)
  })

  it("handles empty entries", () => {
    const result = checkSessionBalance([])
    expect(result.isBalanced).toBe(true)
    expect(result.debitTotal).toBe(0)
  })
})
