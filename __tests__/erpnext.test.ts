import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// --- Mocks ---

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("date-fns", () => ({
  format: vi.fn((date: Date, fmt: string) => {
    if (fmt === "yyyy-MM-dd") {
      return date.toISOString().split("T")[0]
    }
    return date.toISOString()
  }),
}))

import { prisma } from "@/lib/db"
import { ERPNextClient, ERPNextError, type ERPNextConfig } from "@/lib/erpnext/client"
import {
  mapAccountCode,
  mapCategoryToERPNext,
  mapERPNextToCategory,
  SKR04_TO_ERPNEXT,
  ERPNEXT_TO_SKR04,
} from "@/lib/erpnext/account-mapping"
import {
  mapSKR04ToERPNext,
  mapERPNextToSKR04,
  getERPNextConfig,
  syncCustomersToERPNext,
  syncInvoicesFromERPNext,
  syncPaymentsFromERPNext,
} from "@/lib/erpnext/sync"

const mockedPrisma = prisma as unknown as {
  transaction: {
    findFirst: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
}

const TEST_CONFIG: ERPNextConfig = {
  url: "https://erp.example.com",
  apiKey: "test-key",
  apiSecret: "test-secret",
}

const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  global.fetch = originalFetch
  delete process.env.ERPNEXT_URL
  delete process.env.ERPNEXT_API_KEY
  delete process.env.ERPNEXT_API_SECRET
})

function mockFetchOnce(response: { ok: boolean; status?: number; statusText?: string; json?: () => Promise<unknown> }) {
  const fn = vi.fn().mockResolvedValueOnce({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: response.statusText ?? (response.ok ? "OK" : "Error"),
    json: response.json ?? (async () => ({})),
    text: async () => "",
  })
  global.fetch = fn
  return fn
}

function mockFetchSequence(...responses: Array<{ ok: boolean; status?: number; statusText?: string; body?: unknown }>) {
  const fn = vi.fn()
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.statusText ?? (r.ok ? "OK" : "Error"),
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    })
  }
  global.fetch = fn
  return fn
}

// ===========================
// ERPNextClient Tests
// ===========================

describe("ERPNextClient", () => {
  it("sollte korrekte Auth-Header senden", async () => {
    const fn = mockFetchOnce({ ok: true, json: async () => ({ data: [] }) })

    const client = new ERPNextClient(TEST_CONFIG)
    await client.getCustomers()

    expect(fn).toHaveBeenCalledTimes(1)
    const [, options] = fn.mock.calls[0]
    expect(options.headers.Authorization).toBe("token test-key:test-secret")
    expect(options.headers["Content-Type"]).toBe("application/json")
  })

  it("sollte GET-Parameter als Query-String senden", async () => {
    const fn = mockFetchOnce({ ok: true, json: async () => ({ data: [] }) })

    const client = new ERPNextClient(TEST_CONFIG)
    await client.getCustomers()

    const [url] = fn.mock.calls[0]
    expect(url).toContain("/api/resource/Customer")
    expect(url).toContain("fields=")
    expect(url).toContain("limit_page_length=0")
  })

  it("sollte POST-Daten als JSON-Body senden", async () => {
    const fn = mockFetchOnce({
      ok: true,
      json: async () => ({ data: { name: "CUST-001", customer_name: "Test GmbH" } }),
    })

    const client = new ERPNextClient(TEST_CONFIG)
    await client.createCustomer({ customer_name: "Test GmbH" })

    const [, options] = fn.mock.calls[0]
    expect(options.method).toBe("POST")
    expect(JSON.parse(options.body)).toEqual({ customer_name: "Test GmbH" })
  })

  it("sollte ERPNextError bei HTTP-Fehlern werfen", async () => {
    mockFetchOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ message: "Not permitted" }),
    })

    const client = new ERPNextClient(TEST_CONFIG)

    await expect(client.getCustomers()).rejects.toThrow(ERPNextError)
  })

  it("sollte Fehlermeldung aus Response extrahieren", async () => {
    mockFetchOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ message: "Not permitted" }),
    })

    const client = new ERPNextClient(TEST_CONFIG)

    await expect(client.getCustomers()).rejects.toThrow("Not permitted")
  })

  it("sollte Netzwerkfehler abfangen", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"))

    const client = new ERPNextClient(TEST_CONFIG)

    await expect(client.getCustomers()).rejects.toThrow("ERPNext Verbindungsfehler")
  })

  it("sollte testConnection bei Erfolg true zurückgeben", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ message: "admin@example.com" }) })

    const client = new ERPNextClient(TEST_CONFIG)
    const result = await client.testConnection()
    expect(result).toBe(true)
  })

  it("sollte testConnection bei Fehler false zurückgeben", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("connection refused"))

    const client = new ERPNextClient(TEST_CONFIG)
    const result = await client.testConnection()
    expect(result).toBe(false)
  })

  it("sollte Sales Invoices mit Datumsfiltern abrufen", async () => {
    const fn = mockFetchOnce({
      ok: true,
      json: async () => ({ data: [{ name: "SINV-001" }] }),
    })

    const client = new ERPNextClient(TEST_CONFIG)
    await client.getSalesInvoices({ from_date: "2025-01-01", to_date: "2025-12-31" })

    const [url] = fn.mock.calls[0]
    expect(url).toContain("filters=")
  })

  it("sollte Payment Entries erstellen", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({ data: { name: "PAY-001", paid_amount: 100 } }),
    })

    const client = new ERPNextClient(TEST_CONFIG)
    const result = await client.createPaymentEntry({
      payment_type: "Receive",
      paid_amount: 100,
      party: "Kunde A",
    })

    expect(result.name).toBe("PAY-001")
  })
})

// ===========================
// Account Mapping Tests
// ===========================

describe("Account Mapping", () => {
  it("sollte SKR04-Code zu ERPNext-Kontoname zuordnen", () => {
    expect(mapAccountCode("4400", "skr04_to_erpnext")).toBe("Erlöse 19% USt")
    expect(mapAccountCode("6815", "skr04_to_erpnext")).toBe("Bürobedarf")
    expect(mapAccountCode("6300", "skr04_to_erpnext")).toBe("Sonstige betriebliche Aufwendungen")
    expect(mapAccountCode("1800", "skr04_to_erpnext")).toBe("Bank")
  })

  it("sollte ERPNext-Kontoname zu SKR04-Code zuordnen", () => {
    expect(mapAccountCode("Erlöse 19% USt", "erpnext_to_skr04")).toBe("4400")
    expect(mapAccountCode("Bank", "erpnext_to_skr04")).toBe("1800")
    expect(mapAccountCode("Löhne und Gehälter", "erpnext_to_skr04")).toBe("6000")
  })

  it("sollte null für unbekannte Codes zurückgeben", () => {
    expect(mapAccountCode("9999", "skr04_to_erpnext")).toBeNull()
    expect(mapAccountCode("Unbekanntes Konto", "erpnext_to_skr04")).toBeNull()
  })

  it("sollte alle SKR04-Konten im Mapping haben", () => {
    const expectedCodes = [
      "4400", "4300", "4100", "6815", "6670", "6650", "6830", "6640",
      "6430", "7680", "6000", "6310", "6805", "6600", "6520", "6800",
      "6821", "6825", "6827", "6220", "7300", "6855", "6610", "6470",
      "6330", "6300", "1800", "1600",
    ]
    for (const code of expectedCodes) {
      expect(SKR04_TO_ERPNEXT[code]).toBeDefined()
    }
  })

  it("sollte Kategorie-Code zu ERPNext zuordnen", () => {
    expect(mapCategoryToERPNext("income")).toBe("Erlöse 19% USt")
    expect(mapCategoryToERPNext("office")).toBe("Bürobedarf")
    expect(mapCategoryToERPNext("rent")).toBe("Miete und Nebenkosten")
    expect(mapCategoryToERPNext("SALARY")).toBe("Löhne und Gehälter")
  })

  it("sollte ERPNext-Konto zu Kategorie zuordnen", () => {
    expect(mapERPNextToCategory("Erlöse 19% USt")).toBe("income")
    expect(mapERPNextToCategory("Bürobedarf")).toBe("office")
    expect(mapERPNextToCategory("Löhne und Gehälter")).toBe("salary")
  })

  it("sollte null für unbekannte Kategorien zurückgeben", () => {
    expect(mapCategoryToERPNext("unknown_category")).toBeNull()
    expect(mapERPNextToCategory("Unknown Account")).toBeNull()
  })
})

// ===========================
// Sync Mapping Helper Tests
// ===========================

describe("Sync Mapping Helpers", () => {
  it("sollte mapSKR04ToERPNext SKR04-Codes zuordnen", () => {
    expect(mapSKR04ToERPNext("4400")).toBe("Erlöse 19% USt")
    expect(mapSKR04ToERPNext("9999")).toBeNull()
  })

  it("sollte mapERPNextToSKR04 ERPNext-Kontonamen zuordnen", () => {
    expect(mapERPNextToSKR04("Bank")).toBe("1800")
    expect(mapERPNextToSKR04("Nope")).toBeNull()
  })
})

// ===========================
// Sync Config Tests
// ===========================

describe("getERPNextConfig", () => {
  it("sollte null zurückgeben wenn Umgebungsvariablen fehlen", () => {
    const config = getERPNextConfig("user-123")
    expect(config).toBeNull()
  })

  it("sollte Config zurückgeben wenn alle Variablen gesetzt sind", () => {
    process.env.ERPNEXT_URL = "https://erp.test.com"
    process.env.ERPNEXT_API_KEY = "key123"
    process.env.ERPNEXT_API_SECRET = "secret456"

    const config = getERPNextConfig("user-123")
    expect(config).toEqual({
      url: "https://erp.test.com",
      apiKey: "key123",
      apiSecret: "secret456",
    })
  })
})

// ===========================
// Sync Logic Tests (mit Mocks)
// ===========================

describe("syncCustomersToERPNext", () => {
  it("sollte neue Kunden erstellen und existierende überspringen", async () => {
    process.env.ERPNEXT_URL = "https://erp.test.com"
    process.env.ERPNEXT_API_KEY = "key"
    process.env.ERPNEXT_API_SECRET = "secret"

    mockedPrisma.transaction.findMany.mockResolvedValueOnce([
      { merchant: "Neue GmbH" },
      { merchant: "Bestehende AG" },
    ])

    const fn = mockFetchSequence(
      // getCustomers
      { ok: true, body: { data: [{ customer_name: "Bestehende AG" }] } },
      // createCustomer für "Neue GmbH"
      { ok: true, body: { data: { name: "CUST-001", customer_name: "Neue GmbH" } } },
    )

    const result = await syncCustomersToERPNext("user-1")

    expect(result.created).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it("sollte Fehler bei einzelnen Kunden erfassen", async () => {
    process.env.ERPNEXT_URL = "https://erp.test.com"
    process.env.ERPNEXT_API_KEY = "key"
    process.env.ERPNEXT_API_SECRET = "secret"

    mockedPrisma.transaction.findMany.mockResolvedValueOnce([
      { merchant: "Fehler GmbH" },
    ])

    mockFetchSequence(
      // getCustomers - leer
      { ok: true, body: { data: [] } },
      // createCustomer schlägt fehl
      { ok: false, status: 400, statusText: "Bad Request", body: { message: "Duplicate entry" } },
    )

    const result = await syncCustomersToERPNext("user-1")

    expect(result.created).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain("Fehler GmbH")
  })
})

describe("syncInvoicesFromERPNext", () => {
  it("sollte Eingangsrechnungen als Transaktionen importieren", async () => {
    process.env.ERPNEXT_URL = "https://erp.test.com"
    process.env.ERPNEXT_API_KEY = "key"
    process.env.ERPNEXT_API_SECRET = "secret"

    // getPurchaseInvoices
    mockFetchSequence({
      ok: true,
      body: {
        data: [
          {
            name: "PINV-001",
            supplier: "Lieferant A",
            posting_date: "2025-06-15",
            grand_total: 119.0,
            net_total: 100.0,
            status: "Unpaid",
            currency: "EUR",
            items: [{ expense_account: "Bürobedarf" }],
          },
        ],
      },
    })

    // findFirst - kein Duplikat
    mockedPrisma.transaction.findFirst.mockResolvedValueOnce(null)
    // create
    mockedPrisma.transaction.create.mockResolvedValueOnce({ id: "tx-1" })

    const result = await syncInvoicesFromERPNext("user-1")

    expect(result.created).toBe(1)
    expect(result.skipped).toBe(0)
    expect(mockedPrisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        merchant: "Lieferant A",
        total: -11900,
        sourceType: "erpnext_import",
        externalId: "erpnext-pinv-PINV-001",
      }),
    })
  })

  it("sollte Duplikate überspringen", async () => {
    process.env.ERPNEXT_URL = "https://erp.test.com"
    process.env.ERPNEXT_API_KEY = "key"
    process.env.ERPNEXT_API_SECRET = "secret"

    mockFetchSequence({
      ok: true,
      body: {
        data: [{ name: "PINV-002", supplier: "Test", posting_date: "2025-01-01", grand_total: 50, currency: "EUR", items: [] }],
      },
    })

    // findFirst - Duplikat gefunden
    mockedPrisma.transaction.findFirst.mockResolvedValueOnce({ id: "existing-tx" })

    const result = await syncInvoicesFromERPNext("user-1")

    expect(result.skipped).toBe(1)
    expect(result.created).toBe(0)
  })
})

describe("syncPaymentsFromERPNext", () => {
  it("sollte Zahlungen importieren und bestehende Transaktionen abgleichen", async () => {
    process.env.ERPNEXT_URL = "https://erp.test.com"
    process.env.ERPNEXT_API_KEY = "key"
    process.env.ERPNEXT_API_SECRET = "secret"

    // getPaymentEntries
    mockFetchSequence({
      ok: true,
      body: {
        data: [
          {
            name: "PAY-001",
            payment_type: "Pay",
            posting_date: "2025-06-15",
            paid_amount: 50.0,
            received_amount: 0,
            party_type: "Supplier",
            party: "Lieferant B",
            paid_from: "Bank",
            paid_to: "Creditors",
          },
        ],
      },
    })

    // findFirst - kein Duplikat
    mockedPrisma.transaction.findFirst.mockResolvedValueOnce(null)
    // findFirst - matching TX gefunden
    mockedPrisma.transaction.findFirst.mockResolvedValueOnce({
      id: "tx-match",
      merchant: "Lieferant B",
      total: -5000,
      isReconciled: false,
    })
    // update
    mockedPrisma.transaction.update.mockResolvedValueOnce({ id: "tx-match" })

    const result = await syncPaymentsFromERPNext("user-1")

    expect(result.updated).toBe(1)
    expect(mockedPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "tx-match" },
      data: expect.objectContaining({
        isReconciled: true,
        externalId: "erpnext-pay-PAY-001",
      }),
    })
  })

  it("sollte neue Transaktion erstellen wenn kein Match", async () => {
    process.env.ERPNEXT_URL = "https://erp.test.com"
    process.env.ERPNEXT_API_KEY = "key"
    process.env.ERPNEXT_API_SECRET = "secret"

    mockFetchSequence({
      ok: true,
      body: {
        data: [
          {
            name: "PAY-002",
            payment_type: "Receive",
            posting_date: "2025-06-20",
            paid_amount: 200,
            received_amount: 200,
            party: "Kunde X",
            party_type: "Customer",
            paid_from: "Debtors",
            paid_to: "Bank",
          },
        ],
      },
    })

    // findFirst - kein Duplikat
    mockedPrisma.transaction.findFirst.mockResolvedValueOnce(null)
    // findFirst - kein Match
    mockedPrisma.transaction.findFirst.mockResolvedValueOnce(null)
    // create
    mockedPrisma.transaction.create.mockResolvedValueOnce({ id: "new-tx" })

    const result = await syncPaymentsFromERPNext("user-1")

    expect(result.created).toBe(1)
    expect(mockedPrisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchant: "Kunde X",
        total: 20000,
        type: "income",
        sourceType: "erpnext_import",
      }),
    })
  })
})

// ===========================
// ERPNextError Tests
// ===========================

describe("ERPNextError", () => {
  it("sollte statusCode und responseBody speichern", () => {
    const error = new ERPNextError("Test error", 404, { detail: "not found" })
    expect(error.message).toBe("Test error")
    expect(error.statusCode).toBe(404)
    expect(error.responseBody).toEqual({ detail: "not found" })
    expect(error.name).toBe("ERPNextError")
  })
})
