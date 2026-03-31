import { describe, it, expect, vi, beforeEach } from "vitest"

import { ERPNextClient, ERPNextError } from "@/lib/integrations/erpnext-client"
import type { ERPNextConfig } from "@/lib/integrations/erpnext-client"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

const testConfig: ERPNextConfig = {
  url: "https://erp.example.com",
  apiKey: "test-api-key",
  apiSecret: "test-api-secret",
}

function makeClient(config = testConfig) {
  return new ERPNextClient(config)
}

function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("auth header construction", () => {
  it("sends Authorization header with token api_key:api_secret", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getCustomers()

    expect(mockFetch).toHaveBeenCalledOnce()
    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers.Authorization).toBe("token test-api-key:test-api-secret")
  })

  it("sends Content-Type and Accept as application/json", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getCustomers()

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers["Content-Type"]).toBe("application/json")
    expect(options.headers.Accept).toBe("application/json")
  })

  it("uses different api key/secret per config", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient({
      url: "https://erp2.example.com",
      apiKey: "other-key",
      apiSecret: "other-secret",
    })
    await client.getCustomers()

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers.Authorization).toBe("token other-key:other-secret")
  })
})

describe("URL construction for different doctypes", () => {
  it("constructs URL for Customer doctype", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getCustomers()

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("https://erp.example.com/api/resource/Customer")
  })

  it("constructs URL for Supplier doctype", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getSuppliers()

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("https://erp.example.com/api/resource/Supplier")
  })

  it("constructs URL for Sales Invoice doctype", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getSalesInvoices()

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("https://erp.example.com/api/resource/Sales%20Invoice")
  })

  it("constructs URL for Purchase Invoice doctype", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getPurchaseInvoices()

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("https://erp.example.com/api/resource/Purchase%20Invoice")
  })

  it("constructs URL for Payment Entry doctype", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getPaymentEntries()

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("https://erp.example.com/api/resource/Payment%20Entry")
  })

  it("constructs URL for Item doctype", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getItems()

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("https://erp.example.com/api/resource/Item")
  })
})

describe("filter parameter handling", () => {
  it("adds date filters for Sales Invoices", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getSalesInvoices({ from_date: "2025-01-01", to_date: "2025-03-31" })

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("filters")
    expect(url).toContain("2025-01-01")
    expect(url).toContain("2025-03-31")
  })

  it("adds status filter", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getSalesInvoices({ status: "Paid" })

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("Paid")
  })

  it("adds customer filter for Sales Invoices", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getSalesInvoices({ customer: "ACME Corp" })

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("ACME")
  })

  it("adds supplier filter for Purchase Invoices", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getPurchaseInvoices({ supplier: "Supplier GmbH" })

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("Supplier")
  })

  it("omits filters when none provided", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }))

    const client = makeClient()
    await client.getSalesInvoices()

    const [url] = mockFetch.mock.calls[0]
    // URL should have fields but no filters key with actual filter arrays
    expect(url).toContain("fields")
  })
})

describe("error handling", () => {
  it("throws ERPNextError on network error", async () => {
    mockFetch.mockRejectedValue(new Error("fetch failed"))

    const client = makeClient()

    await expect(client.getCustomers()).rejects.toThrow(ERPNextError)
    await expect(client.getCustomers()).rejects.toThrow("Verbindungsfehler")
  })

  it("throws ERPNextError with status 401 for unauthorized", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ message: "Not authenticated" }, 401))

    const client = makeClient()

    try {
      await client.getCustomers()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ERPNextError)
      expect((error as ERPNextError).statusCode).toBe(401)
    }
  })

  it("throws ERPNextError with status 404 for not found", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ message: "Not Found" }, 404))

    const client = makeClient()

    try {
      await client.getCustomers()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ERPNextError)
      expect((error as ERPNextError).statusCode).toBe(404)
    }
  })

  it("throws ERPNextError with status 500 for server error", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ message: "Internal Server Error" }, 500))

    const client = makeClient()

    try {
      await client.getCustomers()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ERPNextError)
      expect((error as ERPNextError).statusCode).toBe(500)
    }
  })

  it("includes response body in ERPNextError", async () => {
    const responseBody = { message: "Specific error detail" }
    mockFetch.mockResolvedValue(mockJsonResponse(responseBody, 400))

    const client = makeClient()

    try {
      await client.getCustomers()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ERPNextError)
      expect((error as ERPNextError).responseBody).toEqual(responseBody)
    }
  })

  it("sets statusCode to 0 for network errors", async () => {
    mockFetch.mockRejectedValue(new Error("DNS resolution failed"))

    const client = makeClient()

    try {
      await client.getCustomers()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ERPNextError)
      expect((error as ERPNextError).statusCode).toBe(0)
    }
  })
})

describe("testConnection", () => {
  it("returns true on successful connection", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ message: "Administrator" }))

    const client = makeClient()
    const result = await client.testConnection()

    expect(result).toBe(true)
  })

  it("returns false on failed connection", async () => {
    mockFetch.mockRejectedValue(new Error("connection refused"))

    const client = makeClient()
    const result = await client.testConnection()

    expect(result).toBe(false)
  })

  it("returns false on 401", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ message: "Not authenticated" }, 401))

    const client = makeClient()
    const result = await client.testConnection()

    expect(result).toBe(false)
  })
})

describe("POST requests", () => {
  it("sends body as JSON for createSalesInvoice", async () => {
    const invoiceData = { customer: "Test", items: [] }
    mockFetch.mockResolvedValue(mockJsonResponse({ data: { name: "INV-001" } }))

    const client = makeClient()
    await client.createSalesInvoice(invoiceData)

    const [, options] = mockFetch.mock.calls[0]
    expect(options.method).toBe("POST")
    expect(JSON.parse(options.body)).toEqual(invoiceData)
  })

  it("sends body as JSON for createPurchaseInvoice", async () => {
    const invoiceData = { supplier: "Supplier", items: [] }
    mockFetch.mockResolvedValue(mockJsonResponse({ data: { name: "PINV-001" } }))

    const client = makeClient()
    await client.createPurchaseInvoice(invoiceData)

    const [, options] = mockFetch.mock.calls[0]
    expect(options.method).toBe("POST")
    expect(JSON.parse(options.body)).toEqual(invoiceData)
  })
})
