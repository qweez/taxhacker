import { renderToBuffer } from "@react-pdf/renderer"
import { InvoiceDocument } from "./invoice-template"

export type InvoiceData = {
  // Seller (from user profile)
  sellerName: string
  sellerAddress: string
  sellerTaxId?: string // Steuernummer
  sellerVatId?: string // USt-IdNr
  sellerBankDetails?: string // IBAN, BIC, Bank
  sellerLogo?: string // URL/path
  sellerEmail?: string
  sellerPhone?: string
  // Buyer
  buyerName: string
  buyerAddress: string
  buyerVatId?: string
  // Invoice details
  invoiceNumber: string
  invoiceDate: string // YYYY-MM-DD
  serviceDate?: string // Leistungsdatum
  dueDate?: string // Zahlungsziel
  // Line items
  items: {
    position: number
    description: string
    quantity: number
    unit: string // "Stück", "Stunden", "Pauschal"
    unitPrice: number // in cents
    taxRate: number // 19, 7, or 0
  }[]
  // Extras
  note?: string // Freitext
  reverseCharge?: boolean // §13b UStG
  kleinunternehmer?: boolean // §19 UStG
}

export function calculateInvoiceTotals(items: InvoiceData["items"]): {
  netTotal: number
  taxBreakdown: { rate: number; net: number; tax: number }[]
  grossTotal: number
} {
  const taxMap = new Map<number, number>()

  let netTotal = 0
  for (const item of items) {
    const lineNet = item.quantity * item.unitPrice
    netTotal += lineNet
    taxMap.set(item.taxRate, (taxMap.get(item.taxRate) ?? 0) + lineNet)
  }

  const taxBreakdown = Array.from(taxMap.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([rate, net]) => ({
      rate,
      net,
      tax: Math.round((net * rate) / 100),
    }))

  const totalTax = taxBreakdown.reduce((sum, t) => sum + t.tax, 0)

  return {
    netTotal,
    taxBreakdown,
    grossTotal: netTotal + totalTax,
  }
}

export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  const element = InvoiceDocument({ data })
  const buffer = await renderToBuffer(element as any)
  return Buffer.from(buffer)
}
