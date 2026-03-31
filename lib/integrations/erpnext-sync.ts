/**
 * ERPNext Bidirektionale Synchronisation
 * Importiert und exportiert Daten zwischen TaxHacker und ERPNext
 */

import { prisma } from "@/lib/db"
import { ERPNextClient } from "./erpnext-client"
import type { ERPNextSalesInvoice, ERPNextPurchaseInvoice, ERPNextCustomer, ERPNextSupplier, ERPNextPaymentEntry } from "./erpnext-client"

export type ERPNextSyncResult = {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

// SKR04 → ERPNext Kontobezeichnung
const SKR04_TO_ERPNEXT_ACCOUNT: Record<string, string> = {
  "4400": "Erlöse 19% USt",
  "4300": "Erlöse 7% USt",
  "4100": "Steuerfreie Erlöse",
  "6815": "Bürobedarf",
  "6670": "Reisekosten Arbeitnehmer",
  "6650": "Reisekosten Unternehmer",
  "6830": "Sonstige betriebliche Aufwendungen",
  "6640": "Bewirtungskosten",
  "6430": "Versicherungen",
  "7680": "Sonstige Steuern",
  "6000": "Löhne und Gehälter",
  "6310": "Miete und Nebenkosten",
  "6805": "Telefon und Internet",
  "6600": "Werbekosten",
  "6520": "Kfz-Kosten",
  "6800": "Porto",
  "6821": "Fortbildungskosten",
  "6825": "Rechts- und Beratungskosten",
  "6827": "Buchführungskosten",
  "6220": "Abschreibungen auf Sachanlagen",
  "7300": "Zinsen und ähnliche Aufwendungen",
  "6855": "Nebenkosten des Geldverkehrs",
  "6610": "Geschenke abzugsfähig",
  "6470": "Reparaturen und Instandhaltung",
  "6330": "Reinigungskosten",
  "6300": "Sonstige betriebliche Aufwendungen",
  "1800": "Bank",
  "1600": "Kasse",
}

/**
 * SKR04-Kontonummer → ERPNext Kontobezeichnung zuordnen
 */
export function mapSKR04ToERPNextAccount(skr04Code: string): string | null {
  return SKR04_TO_ERPNEXT_ACCOUNT[skr04Code] ?? null
}

// Kategorie-Code → SKR04-Konto (für Export)
const CATEGORY_TO_SKR04: Record<string, string> = {
  income: "4400",
  income_7: "4300",
  income_0: "4100",
  office: "6815",
  travel: "6670",
  travel_self: "6650",
  software: "6830",
  hosting: "6830",
  food: "6640",
  insurance: "6430",
  tax: "7680",
  salary: "6000",
  rent: "6310",
  telecom: "6805",
  advertising: "6600",
  vehicle: "6520",
  postage: "6800",
  training: "6821",
  legal: "6825",
  accounting: "6827",
  depreciation: "6220",
  interest: "7300",
  bank_fees: "6855",
  gifts: "6610",
  repair: "6470",
  cleaning: "6330",
  default_expense: "6300",
  default_income: "4400",
}

/**
 * Kunden aus ERPNext importieren und als Kontakte/Merchants in TaxHacker anlegen
 */
export async function syncCustomersFromERPNext(
  userId: string,
  client: ERPNextClient,
): Promise<ERPNextSyncResult> {
  const result: ERPNextSyncResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  let customers: ERPNextCustomer[]
  try {
    customers = await client.getCustomers()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
    result.errors.push(`Fehler beim Abrufen der Kunden: ${msg}`)
    return result
  }

  for (const customer of customers) {
    try {
      // Prüfe ob Merchant bereits existiert (via income-Transaktionen)
      const existing = await prisma.transaction.findFirst({
        where: {
          userId,
          merchant: customer.customer_name,
          type: "income",
          sourceType: "erpnext",
        },
      })

      if (existing) {
        result.skipped++
        continue
      }

      // Erstelle eine Referenz-Transaktion als Platzhalter für den Kunden
      // (TaxHacker hat kein separates Kontakt-Modell, Merchants werden aus Transaktionen abgeleitet)
      await prisma.transaction.create({
        data: {
          userId,
          name: `Kunde: ${customer.customer_name}`,
          merchant: customer.customer_name,
          type: "income",
          sourceType: "erpnext",
          externalId: `erpnext-customer-${customer.name}`,
          description: [
            customer.customer_type,
            customer.customer_group,
            customer.tax_id ? `USt-IdNr: ${customer.tax_id}` : null,
          ].filter(Boolean).join(" | "),
          total: 0,
          currencyCode: "EUR",
        },
      })
      result.created++
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
      result.errors.push(`Fehler bei Kunde "${customer.customer_name}": ${msg}`)
    }
  }

  return result
}

/**
 * Lieferanten aus ERPNext importieren
 */
export async function syncSuppliersFromERPNext(
  userId: string,
  client: ERPNextClient,
): Promise<ERPNextSyncResult> {
  const result: ERPNextSyncResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  let suppliers: ERPNextSupplier[]
  try {
    suppliers = await client.getSuppliers()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
    result.errors.push(`Fehler beim Abrufen der Lieferanten: ${msg}`)
    return result
  }

  for (const supplier of suppliers) {
    try {
      const existing = await prisma.transaction.findFirst({
        where: {
          userId,
          merchant: supplier.supplier_name,
          type: "expense",
          sourceType: "erpnext",
        },
      })

      if (existing) {
        result.skipped++
        continue
      }

      await prisma.transaction.create({
        data: {
          userId,
          name: `Lieferant: ${supplier.supplier_name}`,
          merchant: supplier.supplier_name,
          type: "expense",
          sourceType: "erpnext",
          externalId: `erpnext-supplier-${supplier.name}`,
          description: [
            supplier.supplier_group,
            supplier.country,
            supplier.tax_id ? `USt-IdNr: ${supplier.tax_id}` : null,
          ].filter(Boolean).join(" | "),
          total: 0,
          currencyCode: "EUR",
        },
      })
      result.created++
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
      result.errors.push(`Fehler bei Lieferant "${supplier.supplier_name}": ${msg}`)
    }
  }

  return result
}

/**
 * Rechnungen (Sales + Purchase Invoices) aus ERPNext importieren
 */
export async function syncInvoicesFromERPNext(
  userId: string,
  client: ERPNextClient,
  dateFrom?: string,
  dateTo?: string,
): Promise<ERPNextSyncResult> {
  const result: ERPNextSyncResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  const filters = { from_date: dateFrom, to_date: dateTo }

  // Sales Invoices (Ausgangsrechnungen → income)
  let salesInvoices: ERPNextSalesInvoice[]
  try {
    salesInvoices = await client.getSalesInvoices(filters)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
    result.errors.push(`Fehler beim Abrufen der Ausgangsrechnungen: ${msg}`)
    salesInvoices = []
  }

  for (const inv of salesInvoices) {
    try {
      const externalId = `erpnext-sinv-${inv.name}`
      const existing = await prisma.transaction.findFirst({
        where: { userId, externalId },
      })

      if (existing) {
        // Update bei Statusänderung
        if (existing.description !== inv.status) {
          await prisma.transaction.update({
            where: { id: existing.id },
            data: { description: `Status: ${inv.status}` },
          })
          result.updated++
        } else {
          result.skipped++
        }
        continue
      }

      await prisma.transaction.create({
        data: {
          userId,
          name: `Rechnung ${inv.name}`,
          merchant: inv.customer,
          type: "income",
          total: Math.round(inv.grand_total * 100),
          currencyCode: inv.currency || "EUR",
          issuedAt: new Date(inv.posting_date),
          sourceType: "erpnext",
          externalId,
          description: `Status: ${inv.status}`,
          items: inv.items
            ? JSON.stringify(inv.items.map(item => ({
                name: item.item_name,
                quantity: item.qty,
                price: Math.round(item.rate * 100),
                total: Math.round(item.amount * 100),
              })))
            : "[]",
        },
      })
      result.created++
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
      result.errors.push(`Fehler bei Ausgangsrechnung "${inv.name}": ${msg}`)
    }
  }

  // Purchase Invoices (Eingangsrechnungen → expense)
  let purchaseInvoices: ERPNextPurchaseInvoice[]
  try {
    purchaseInvoices = await client.getPurchaseInvoices(filters)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
    result.errors.push(`Fehler beim Abrufen der Eingangsrechnungen: ${msg}`)
    purchaseInvoices = []
  }

  for (const inv of purchaseInvoices) {
    try {
      const externalId = `erpnext-pinv-${inv.name}`
      const existing = await prisma.transaction.findFirst({
        where: { userId, externalId },
      })

      if (existing) {
        if (existing.description !== `Status: ${inv.status}`) {
          await prisma.transaction.update({
            where: { id: existing.id },
            data: { description: `Status: ${inv.status}` },
          })
          result.updated++
        } else {
          result.skipped++
        }
        continue
      }

      await prisma.transaction.create({
        data: {
          userId,
          name: `Eingangsrechnung ${inv.name}`,
          merchant: inv.supplier,
          type: "expense",
          total: Math.round(inv.grand_total * 100),
          currencyCode: inv.currency || "EUR",
          issuedAt: new Date(inv.posting_date),
          sourceType: "erpnext",
          externalId,
          description: `Status: ${inv.status}`,
          items: inv.items
            ? JSON.stringify(inv.items.map(item => ({
                name: item.item_name,
                quantity: item.qty,
                price: Math.round(item.rate * 100),
                total: Math.round(item.amount * 100),
              })))
            : "[]",
        },
      })
      result.created++
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
      result.errors.push(`Fehler bei Eingangsrechnung "${inv.name}": ${msg}`)
    }
  }

  return result
}

/**
 * TaxHacker-Transaktionen als Purchase Invoices nach ERPNext exportieren
 */
export async function exportTransactionsToERPNext(
  userId: string,
  client: ERPNextClient,
  transactionIds: string[],
): Promise<ERPNextSyncResult> {
  const result: ERPNextSyncResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      id: { in: transactionIds },
    },
    include: { category: true },
  })

  for (const tx of transactions) {
    try {
      // Bereits exportierte überspringen
      if (tx.externalId?.startsWith("erpnext-")) {
        result.skipped++
        continue
      }

      const categoryCode = tx.categoryCode?.toLowerCase() ?? "default_expense"
      const skr04Code = CATEGORY_TO_SKR04[categoryCode] ?? CATEGORY_TO_SKR04.default_expense
      const erpnextAccount = SKR04_TO_ERPNEXT_ACCOUNT[skr04Code] ?? "Sonstige betriebliche Aufwendungen"

      const isIncome = tx.type === "income"
      const amountEuro = Math.abs(tx.total ?? 0) / 100

      if (isIncome) {
        // Ausgangsrechnung erstellen
        const invoiceData: Record<string, unknown> = {
          customer: tx.merchant || "Unbekannter Kunde",
          posting_date: tx.issuedAt ? tx.issuedAt.toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
          currency: tx.currencyCode || "EUR",
          items: [{
            item_name: tx.name || "Artikel",
            qty: 1,
            rate: amountEuro,
            income_account: erpnextAccount,
          }],
        }

        const created = await client.createSalesInvoice(invoiceData)
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { externalId: `erpnext-sinv-${created.name}` },
        })
        result.created++
      } else {
        // Eingangsrechnung erstellen
        const invoiceData: Record<string, unknown> = {
          supplier: tx.merchant || "Unbekannter Lieferant",
          posting_date: tx.issuedAt ? tx.issuedAt.toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
          currency: tx.currencyCode || "EUR",
          items: [{
            item_name: tx.name || "Artikel",
            qty: 1,
            rate: amountEuro,
            expense_account: erpnextAccount,
          }],
        }

        const created = await client.createPurchaseInvoice(invoiceData)
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { externalId: `erpnext-pinv-${created.name}` },
        })
        result.created++
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
      result.errors.push(`Fehler beim Export von "${tx.name || tx.id}": ${msg}`)
    }
  }

  return result
}

/**
 * Payment Entries aus ERPNext synchronisieren (für Abstimmung)
 */
export async function syncPaymentEntries(
  userId: string,
  client: ERPNextClient,
): Promise<ERPNextSyncResult> {
  const result: ERPNextSyncResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  let entries: ERPNextPaymentEntry[]
  try {
    entries = await client.getPaymentEntries()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
    result.errors.push(`Fehler beim Abrufen der Zahlungen: ${msg}`)
    return result
  }

  for (const entry of entries) {
    try {
      const externalId = `erpnext-pe-${entry.name}`
      const existing = await prisma.transaction.findFirst({
        where: { userId, externalId },
      })

      if (existing) {
        result.skipped++
        continue
      }

      const isReceive = entry.payment_type === "Receive"
      const amount = isReceive ? entry.received_amount : entry.paid_amount

      await prisma.transaction.create({
        data: {
          userId,
          name: `Zahlung ${entry.name}`,
          merchant: entry.party || undefined,
          type: isReceive ? "income" : "expense",
          total: Math.round(amount * 100),
          currencyCode: "EUR",
          issuedAt: new Date(entry.posting_date),
          sourceType: "erpnext",
          externalId,
          description: [
            `${entry.payment_type}: ${entry.party_type} ${entry.party}`,
            entry.reference_no ? `Ref: ${entry.reference_no}` : null,
          ].filter(Boolean).join(" | "),
        },
      })
      result.created++
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unbekannter Fehler"
      result.errors.push(`Fehler bei Zahlung "${entry.name}": ${msg}`)
    }
  }

  return result
}
