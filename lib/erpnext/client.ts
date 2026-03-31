/**
 * ERPNext REST API Client
 * Anbindung an ERPNext für die Buchhaltungssynchronisation
 */

export type ERPNextConfig = {
  url: string
  apiKey: string
  apiSecret: string
}

export class ERPNextError extends Error {
  public statusCode: number
  public responseBody: unknown

  constructor(message: string, statusCode: number, responseBody?: unknown) {
    super(message)
    this.name = "ERPNextError"
    this.statusCode = statusCode
    this.responseBody = responseBody
  }
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"

// ERPNext API-Antwortformat
type ERPNextListResponse<T = Record<string, unknown>> = {
  data: T[]
}

type ERPNextSingleResponse<T = Record<string, unknown>> = {
  data: T
}

type ERPNextMethodResponse<T = unknown> = {
  message: T
}

export type InvoiceFilters = {
  from_date?: string
  to_date?: string
  status?: string
  customer?: string
  supplier?: string
}

export type ERPNextCustomer = {
  name: string
  customer_name: string
  customer_type: string
  customer_group: string
  territory: string
  tax_id?: string
}

export type ERPNextSupplier = {
  name: string
  supplier_name: string
  supplier_group: string
  supplier_type: string
  tax_id?: string
  country?: string
}

export type ERPNextSalesInvoice = {
  name: string
  customer: string
  posting_date: string
  due_date?: string
  grand_total: number
  net_total: number
  status: string
  items: ERPNextInvoiceItem[]
  currency: string
}

export type ERPNextPurchaseInvoice = {
  name: string
  supplier: string
  posting_date: string
  due_date?: string
  grand_total: number
  net_total: number
  status: string
  items: ERPNextInvoiceItem[]
  currency: string
}

export type ERPNextInvoiceItem = {
  item_code: string
  item_name: string
  qty: number
  rate: number
  amount: number
  expense_account?: string
  income_account?: string
}

export type ERPNextPaymentEntry = {
  name: string
  payment_type: string
  posting_date: string
  paid_amount: number
  received_amount: number
  reference_no?: string
  reference_date?: string
  party_type: string
  party: string
  paid_from: string
  paid_to: string
}

export type ERPNextItem = {
  name: string
  item_code: string
  item_name: string
  item_group: string
  stock_uom: string
  is_sales_item: boolean
  is_purchase_item: boolean
}

export type ERPNextStockLedgerEntry = {
  name: string
  item_code: string
  warehouse: string
  posting_date: string
  posting_time: string
  actual_qty: number
  qty_after_transaction: number
  valuation_rate: number
  stock_value: number
  voucher_type: string
  voucher_no: string
}

export type ERPNextAccount = {
  name: string
  account_name: string
  account_number?: string
  parent_account?: string
  root_type: string
  report_type: string
  account_type?: string
  is_group: boolean
  company: string
}

export class ERPNextClient {
  private config: ERPNextConfig

  constructor(config: ERPNextConfig) {
    this.config = config
  }

  /**
   * Basis-HTTP-Request an die ERPNext API
   */
  private async request<T = unknown>(
    method: HttpMethod,
    endpoint: string,
    data?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(endpoint, this.config.url)

    // GET-Parameter als Query-String anhängen
    if (method === "GET" && data) {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `token ${this.config.apiKey}:${this.config.apiSecret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    }

    if (method !== "GET" && data) {
      fetchOptions.body = JSON.stringify(data)
    }

    let response: Response
    try {
      response = await fetch(url.toString(), fetchOptions)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Netzwerkfehler"
      throw new ERPNextError(`ERPNext Verbindungsfehler: ${message}`, 0)
    }

    if (!response.ok) {
      let body: unknown
      try {
        body = await response.json()
      } catch {
        body = await response.text().catch(() => null)
      }

      const errorMessage =
        body && typeof body === "object" && "message" in (body as Record<string, unknown>)
          ? String((body as Record<string, unknown>).message)
          : `HTTP ${response.status}: ${response.statusText}`

      throw new ERPNextError(
        `ERPNext API Fehler: ${errorMessage}`,
        response.status,
        body,
      )
    }

    const result = await response.json()
    return result as T
  }

  // --- Kunden (Customers) ---

  async getCustomers(): Promise<ERPNextCustomer[]> {
    const res = await this.request<ERPNextListResponse<ERPNextCustomer>>("GET", "/api/resource/Customer", {
      fields: JSON.stringify(["name", "customer_name", "customer_type", "customer_group", "territory", "tax_id"]),
      limit_page_length: 0,
    })
    return res.data
  }

  async createCustomer(data: Partial<ERPNextCustomer>): Promise<ERPNextCustomer> {
    const res = await this.request<ERPNextSingleResponse<ERPNextCustomer>>("POST", "/api/resource/Customer", data)
    return res.data
  }

  // --- Lieferanten (Suppliers) ---

  async getSuppliers(): Promise<ERPNextSupplier[]> {
    const res = await this.request<ERPNextListResponse<ERPNextSupplier>>("GET", "/api/resource/Supplier", {
      fields: JSON.stringify(["name", "supplier_name", "supplier_group", "supplier_type", "tax_id", "country"]),
      limit_page_length: 0,
    })
    return res.data
  }

  async createSupplier(data: Partial<ERPNextSupplier>): Promise<ERPNextSupplier> {
    const res = await this.request<ERPNextSingleResponse<ERPNextSupplier>>("POST", "/api/resource/Supplier", data)
    return res.data
  }

  // --- Ausgangsrechnungen (Sales Invoices) ---

  async getSalesInvoices(filters?: InvoiceFilters): Promise<ERPNextSalesInvoice[]> {
    const params: Record<string, unknown> = {
      fields: JSON.stringify(["name", "customer", "posting_date", "due_date", "grand_total", "net_total", "status", "currency"]),
      limit_page_length: 0,
    }

    const filterList: Array<[string, string, string, string]> = []
    if (filters?.from_date) {
      filterList.push(["Sales Invoice", "posting_date", ">=", filters.from_date])
    }
    if (filters?.to_date) {
      filterList.push(["Sales Invoice", "posting_date", "<=", filters.to_date])
    }
    if (filters?.status) {
      filterList.push(["Sales Invoice", "status", "=", filters.status])
    }
    if (filters?.customer) {
      filterList.push(["Sales Invoice", "customer", "=", filters.customer])
    }
    if (filterList.length > 0) {
      params.filters = JSON.stringify(filterList)
    }

    const res = await this.request<ERPNextListResponse<ERPNextSalesInvoice>>("GET", "/api/resource/Sales Invoice", params)
    return res.data
  }

  async createSalesInvoice(data: Record<string, unknown>): Promise<ERPNextSalesInvoice> {
    const res = await this.request<ERPNextSingleResponse<ERPNextSalesInvoice>>("POST", "/api/resource/Sales Invoice", data)
    return res.data
  }

  // --- Eingangsrechnungen (Purchase Invoices) ---

  async getPurchaseInvoices(filters?: InvoiceFilters): Promise<ERPNextPurchaseInvoice[]> {
    const params: Record<string, unknown> = {
      fields: JSON.stringify(["name", "supplier", "posting_date", "due_date", "grand_total", "net_total", "status", "currency"]),
      limit_page_length: 0,
    }

    const filterList: Array<[string, string, string, string]> = []
    if (filters?.from_date) {
      filterList.push(["Purchase Invoice", "posting_date", ">=", filters.from_date])
    }
    if (filters?.to_date) {
      filterList.push(["Purchase Invoice", "posting_date", "<=", filters.to_date])
    }
    if (filters?.status) {
      filterList.push(["Purchase Invoice", "status", "=", filters.status])
    }
    if (filters?.supplier) {
      filterList.push(["Purchase Invoice", "supplier", "=", filters.supplier])
    }
    if (filterList.length > 0) {
      params.filters = JSON.stringify(filterList)
    }

    const res = await this.request<ERPNextListResponse<ERPNextPurchaseInvoice>>("GET", "/api/resource/Purchase Invoice", params)
    return res.data
  }

  async createPurchaseInvoice(data: Record<string, unknown>): Promise<ERPNextPurchaseInvoice> {
    const res = await this.request<ERPNextSingleResponse<ERPNextPurchaseInvoice>>("POST", "/api/resource/Purchase Invoice", data)
    return res.data
  }

  // --- Artikel (Items) ---

  async getItems(): Promise<ERPNextItem[]> {
    const res = await this.request<ERPNextListResponse<ERPNextItem>>("GET", "/api/resource/Item", {
      fields: JSON.stringify(["name", "item_code", "item_name", "item_group", "stock_uom", "is_sales_item", "is_purchase_item"]),
      limit_page_length: 0,
    })
    return res.data
  }

  // --- Zahlungen (Payment Entries) ---

  async getPaymentEntries(filters?: InvoiceFilters): Promise<ERPNextPaymentEntry[]> {
    const params: Record<string, unknown> = {
      fields: JSON.stringify([
        "name", "payment_type", "posting_date", "paid_amount", "received_amount",
        "reference_no", "reference_date", "party_type", "party", "paid_from", "paid_to",
      ]),
      limit_page_length: 0,
    }

    const filterList: Array<[string, string, string, string]> = []
    if (filters?.from_date) {
      filterList.push(["Payment Entry", "posting_date", ">=", filters.from_date])
    }
    if (filters?.to_date) {
      filterList.push(["Payment Entry", "posting_date", "<=", filters.to_date])
    }
    if (filterList.length > 0) {
      params.filters = JSON.stringify(filterList)
    }

    const res = await this.request<ERPNextListResponse<ERPNextPaymentEntry>>("GET", "/api/resource/Payment Entry", params)
    return res.data
  }

  async createPaymentEntry(data: Record<string, unknown>): Promise<ERPNextPaymentEntry> {
    const res = await this.request<ERPNextSingleResponse<ERPNextPaymentEntry>>("POST", "/api/resource/Payment Entry", data)
    return res.data
  }

  // --- Kontostände (Account Balances) ---

  async getAccountBalance(account: string, date?: string): Promise<number> {
    const params: Record<string, unknown> = { account }
    if (date) params.date = date

    const res = await this.request<ERPNextMethodResponse<number>>("GET", "/api/method/erpnext.accounts.utils.get_balance_on", params)
    return res.message
  }

  // --- Kontenplan (Chart of Accounts) ---

  async getChartOfAccounts(): Promise<ERPNextAccount[]> {
    const res = await this.request<ERPNextListResponse<ERPNextAccount>>("GET", "/api/resource/Account", {
      fields: JSON.stringify([
        "name", "account_name", "account_number", "parent_account",
        "root_type", "report_type", "account_type", "is_group", "company",
      ]),
      filters: JSON.stringify([["Account", "is_group", "=", 0]]),
      limit_page_length: 0,
    })
    return res.data
  }

  // --- Lagerbestand (Stock Ledger) ---

  async getStockLedger(filters?: InvoiceFilters): Promise<ERPNextStockLedgerEntry[]> {
    const params: Record<string, unknown> = {
      fields: JSON.stringify([
        "name", "item_code", "warehouse", "posting_date", "posting_time",
        "actual_qty", "qty_after_transaction", "valuation_rate", "stock_value",
        "voucher_type", "voucher_no",
      ]),
      limit_page_length: 0,
    }

    const filterList: Array<[string, string, string, string]> = []
    if (filters?.from_date) {
      filterList.push(["Stock Ledger Entry", "posting_date", ">=", filters.from_date])
    }
    if (filters?.to_date) {
      filterList.push(["Stock Ledger Entry", "posting_date", "<=", filters.to_date])
    }
    if (filterList.length > 0) {
      params.filters = JSON.stringify(filterList)
    }

    const res = await this.request<ERPNextListResponse<ERPNextStockLedgerEntry>>("GET", "/api/resource/Stock Ledger Entry", params)
    return res.data
  }

  // --- Verbindungstest ---

  async testConnection(): Promise<boolean> {
    try {
      await this.request("GET", "/api/method/frappe.auth.get_logged_user")
      return true
    } catch {
      return false
    }
  }
}
