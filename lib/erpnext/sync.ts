/**
 * ERPNext Bidirektionale Synchronisation
 * Synchronisiert TaxHacker-Daten mit ERPNext und umgekehrt
 */

import { prisma } from "@/lib/db"
import { ERPNextClient, ERPNextError, type ERPNextConfig } from "@/lib/erpnext/client"
import { mapCategoryToERPNext, mapERPNextToCategory, SKR04_TO_ERPNEXT, ERPNEXT_TO_SKR04 } from "@/lib/erpnext/account-mapping"
import { format } from "date-fns"

export type SyncDirection = "to_erpnext" | "from_erpnext" | "bidirectional"

export type SyncResult = {
  success: boolean
  created: number
  updated: number
  skipped: number
  errors: string[]
  direction: SyncDirection
  syncedAt: Date
}

function emptySyncResult(direction: SyncDirection): SyncResult {
  return {
    success: true,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    direction,
    syncedAt: new Date(),
  }
}

/**
 * ERPNext-Konfiguration aus Umgebungsvariablen lesen
 */
export function getERPNextConfig(userId: string): ERPNextConfig | null {
  const url = process.env.ERPNEXT_URL
  const apiKey = process.env.ERPNEXT_API_KEY
  const apiSecret = process.env.ERPNEXT_API_SECRET

  if (!url || !apiKey || !apiSecret) {
    return null
  }

  return { url, apiKey, apiSecret }
}

function getClient(userId: string): ERPNextClient {
  const config = getERPNextConfig(userId)
  if (!config) {
    throw new Error("ERPNext ist nicht konfiguriert. Bitte ERPNEXT_URL, ERPNEXT_API_KEY und ERPNEXT_API_SECRET setzen.")
  }
  return new ERPNextClient(config)
}

// --- SKR04 Mapping Hilfsfunktionen ---

export function mapSKR04ToERPNext(categoryCode: string): string | null {
  return SKR04_TO_ERPNEXT[categoryCode] ?? null
}

export function mapERPNextToSKR04(erpnextAccount: string): string | null {
  return ERPNEXT_TO_SKR04[erpnextAccount] ?? null
}

// --- Kunden-Synchronisation ---

/**
 * TaxHacker-Händler als ERPNext-Kunden anlegen
 */
export async function syncCustomersToERPNext(userId: string): Promise<SyncResult> {
  const result = emptySyncResult("to_erpnext")
  const client = getClient(userId)

  try {
    // Alle eindeutigen Händler aus TaxHacker-Transaktionen laden
    const transactions = await prisma.transaction.findMany({
      where: { userId, merchant: { not: null } },
      select: { merchant: true },
      distinct: ["merchant"],
    })

    const merchants = transactions
      .map(t => t.merchant)
      .filter((m): m is string => m !== null && m.trim() !== "")

    // Existierende ERPNext-Kunden laden
    const existingCustomers = await client.getCustomers()
    const existingNames = new Set(existingCustomers.map(c => c.customer_name.toLowerCase()))

    for (const merchant of merchants) {
      if (existingNames.has(merchant.toLowerCase())) {
        result.skipped++
        continue
      }

      try {
        await client.createCustomer({
          customer_name: merchant,
          customer_type: "Company",
          customer_group: "Alle Kundengruppen",
          territory: "Germany",
        })
        result.created++
      } catch (error: unknown) {
        const msg = error instanceof ERPNextError ? error.message : String(error)
        result.errors.push(`Kunde "${merchant}": ${msg}`)
      }
    }
  } catch (error: unknown) {
    result.success = false
    const msg = error instanceof Error ? error.message : String(error)
    result.errors.push(`Kundensynchronisation fehlgeschlagen: ${msg}`)
  }

  return result
}

// --- Lieferanten-Synchronisation ---

/**
 * ERPNext-Lieferanten als TaxHacker-Händler importieren
 * (Erstellt Transaktions-Platzhalter für neue Lieferanten)
 */
export async function syncSuppliersFromERPNext(userId: string): Promise<SyncResult> {
  const result = emptySyncResult("from_erpnext")
  const client = getClient(userId)

  try {
    const suppliers = await client.getSuppliers()

    // Existierende Händler in TaxHacker laden
    const existingTransactions = await prisma.transaction.findMany({
      where: { userId, merchant: { not: null } },
      select: { merchant: true },
      distinct: ["merchant"],
    })
    const existingMerchants = new Set(
      existingTransactions
        .map(t => t.merchant?.toLowerCase())
        .filter((m): m is string => m !== undefined),
    )

    for (const supplier of suppliers) {
      if (existingMerchants.has(supplier.supplier_name.toLowerCase())) {
        result.skipped++
        continue
      }

      // Neuen Lieferant als Notiz-Transaktion speichern (kein Betrag)
      try {
        await prisma.transaction.create({
          data: {
            userId,
            merchant: supplier.supplier_name,
            name: `Lieferant aus ERPNext: ${supplier.supplier_name}`,
            type: "expense",
            sourceType: "erpnext_import",
            externalId: `erpnext-supplier-${supplier.name}`,
          },
        })
        result.created++
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        result.errors.push(`Lieferant "${supplier.supplier_name}": ${msg}`)
      }
    }
  } catch (error: unknown) {
    result.success = false
    const msg = error instanceof Error ? error.message : String(error)
    result.errors.push(`Lieferantensynchronisation fehlgeschlagen: ${msg}`)
  }

  return result
}

// --- Rechnungs-Synchronisation ---

/**
 * TaxHacker-Transaktionen als ERPNext-Ausgangsrechnungen anlegen
 */
export async function syncInvoicesToERPNext(
  userId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<SyncResult> {
  const result = emptySyncResult("to_erpnext")
  const client = getClient(userId)

  try {
    const where: Record<string, unknown> = {
      userId,
      type: "income",
      total: { not: null },
    }

    if (dateFrom || dateTo) {
      const issuedAt: Record<string, Date> = {}
      if (dateFrom) issuedAt.gte = new Date(dateFrom)
      if (dateTo) issuedAt.lte = new Date(dateTo)
      where.issuedAt = issuedAt
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: { category: true },
      orderBy: { issuedAt: "asc" },
    })

    // Existierende Rechnungen prüfen (per externalId Duplikate vermeiden)
    const existingInvoices = await client.getSalesInvoices({
      from_date: dateFrom,
      to_date: dateTo,
    })
    const existingRefs = new Set(existingInvoices.map(inv => inv.name))

    for (const tx of transactions) {
      // Bereits synchronisierte Transaktion überspringen
      if (tx.externalId && existingRefs.has(tx.externalId)) {
        result.skipped++
        continue
      }

      const erpnextAccount = tx.categoryCode
        ? mapCategoryToERPNext(tx.categoryCode)
        : null

      try {
        const invoice = await client.createSalesInvoice({
          customer: tx.merchant || "Barkunde",
          posting_date: tx.issuedAt ? format(tx.issuedAt, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
          currency: tx.currencyCode || "EUR",
          items: [
            {
              item_name: tx.name || tx.merchant || "Dienstleistung",
              qty: 1,
              rate: Math.abs((tx.total || 0) / 100),
              income_account: erpnextAccount || "Erlöse 19% USt",
            },
          ],
        })

        // ExternalId aktualisieren für spätere Referenz
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { externalId: invoice.name },
        })

        result.created++
      } catch (error: unknown) {
        const msg = error instanceof ERPNextError ? error.message : String(error)
        result.errors.push(`Rechnung "${tx.name || tx.id}": ${msg}`)
      }
    }
  } catch (error: unknown) {
    result.success = false
    const msg = error instanceof Error ? error.message : String(error)
    result.errors.push(`Rechnungssynchronisation fehlgeschlagen: ${msg}`)
  }

  return result
}

/**
 * ERPNext-Eingangsrechnungen als TaxHacker-Transaktionen importieren
 */
export async function syncInvoicesFromERPNext(
  userId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<SyncResult> {
  const result = emptySyncResult("from_erpnext")
  const client = getClient(userId)

  try {
    const invoices = await client.getPurchaseInvoices({
      from_date: dateFrom,
      to_date: dateTo,
    })

    for (const inv of invoices) {
      // Duplikatprüfung: Existiert bereits eine Transaktion mit dieser ERPNext-ID?
      const existing = await prisma.transaction.findFirst({
        where: {
          userId,
          externalId: `erpnext-pinv-${inv.name}`,
        },
      })

      if (existing) {
        result.skipped++
        continue
      }

      // Kategorie aus ERPNext-Konto ableiten
      const firstItem = inv.items?.[0]
      const categoryCode = firstItem?.expense_account
        ? mapERPNextToCategory(firstItem.expense_account)
        : null

      try {
        await prisma.transaction.create({
          data: {
            userId,
            name: `Eingangsrechnung ${inv.name}`,
            merchant: inv.supplier,
            total: -Math.round(inv.grand_total * 100), // Cent, negativ = Ausgabe
            currencyCode: inv.currency || "EUR",
            type: "expense",
            issuedAt: new Date(inv.posting_date),
            sourceType: "erpnext_import",
            externalId: `erpnext-pinv-${inv.name}`,
            categoryCode: categoryCode ?? undefined,
          },
        })
        result.created++
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        result.errors.push(`Eingangsrechnung "${inv.name}": ${msg}`)
      }
    }
  } catch (error: unknown) {
    result.success = false
    const msg = error instanceof Error ? error.message : String(error)
    result.errors.push(`Import fehlgeschlagen: ${msg}`)
  }

  return result
}

// --- Zahlungs-Synchronisation ---

/**
 * ERPNext-Zahlungseingänge importieren und bestehenden Transaktionen zuordnen
 */
export async function syncPaymentsFromERPNext(userId: string): Promise<SyncResult> {
  const result = emptySyncResult("from_erpnext")
  const client = getClient(userId)

  try {
    const payments = await client.getPaymentEntries()

    for (const payment of payments) {
      // Duplikatprüfung
      const existing = await prisma.transaction.findFirst({
        where: {
          userId,
          externalId: `erpnext-pay-${payment.name}`,
        },
      })

      if (existing) {
        result.skipped++
        continue
      }

      // Versuche Zuordnung zu bestehender Transaktion über Betrag + Händler
      const amountCents = Math.round(payment.paid_amount * 100)
      const matchingTx = await prisma.transaction.findFirst({
        where: {
          userId,
          merchant: payment.party,
          total: payment.payment_type === "Receive" ? amountCents : -amountCents,
          isReconciled: false,
        },
      })

      if (matchingTx) {
        // Bestehende Transaktion als abgeglichen markieren
        await prisma.transaction.update({
          where: { id: matchingTx.id },
          data: {
            isReconciled: true,
            reconciledAt: new Date(),
            externalId: `erpnext-pay-${payment.name}`,
          },
        })
        result.updated++
      } else {
        // Neue Transaktion für die Zahlung erstellen
        try {
          await prisma.transaction.create({
            data: {
              userId,
              name: `Zahlung ${payment.name}`,
              merchant: payment.party,
              total: payment.payment_type === "Receive"
                ? Math.round(payment.received_amount * 100)
                : -Math.round(payment.paid_amount * 100),
              currencyCode: "EUR",
              type: payment.payment_type === "Receive" ? "income" : "expense",
              issuedAt: new Date(payment.posting_date),
              sourceType: "erpnext_import",
              externalId: `erpnext-pay-${payment.name}`,
              text: payment.reference_no || undefined,
            },
          })
          result.created++
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error)
          result.errors.push(`Zahlung "${payment.name}": ${msg}`)
        }
      }
    }
  } catch (error: unknown) {
    result.success = false
    const msg = error instanceof Error ? error.message : String(error)
    result.errors.push(`Zahlungssynchronisation fehlgeschlagen: ${msg}`)
  }

  return result
}

// --- Gesamt-Synchronisation ---

/**
 * Komplette Synchronisation in die gewünschte Richtung ausführen
 */
export async function fullSync(
  userId: string,
  direction: SyncDirection,
): Promise<SyncResult> {
  const combined = emptySyncResult(direction)

  const mergeResult = (partial: SyncResult) => {
    combined.created += partial.created
    combined.updated += partial.updated
    combined.skipped += partial.skipped
    combined.errors.push(...partial.errors)
    if (!partial.success) combined.success = false
  }

  try {
    if (direction === "to_erpnext" || direction === "bidirectional") {
      mergeResult(await syncCustomersToERPNext(userId))
      mergeResult(await syncInvoicesToERPNext(userId))
    }

    if (direction === "from_erpnext" || direction === "bidirectional") {
      mergeResult(await syncSuppliersFromERPNext(userId))
      mergeResult(await syncInvoicesFromERPNext(userId))
      mergeResult(await syncPaymentsFromERPNext(userId))
    }
  } catch (error: unknown) {
    combined.success = false
    const msg = error instanceof Error ? error.message : String(error)
    combined.errors.push(`Synchronisation fehlgeschlagen: ${msg}`)
  }

  combined.syncedAt = new Date()
  return combined
}
