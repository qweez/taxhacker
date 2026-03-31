import { prisma } from "@/lib/db"
import type { SageExportOptions } from "./buchungsstapel-export"

/**
 * Sage Warenwirtschaft 7.1 (2016) Stammdaten (master data) CSV exports.
 * Debitoren (customers), Kreditoren (suppliers), and Artikelstamm (articles).
 *
 * Format: semicolon-separated CSV, Windows-1252 compatible
 * Line endings: CR+LF
 */

// Steuerfreie Kategorien
const EXEMPT_CATEGORIES = new Set(["income_0", "insurance", "interest", "bank_fees", "salary", "tax"])
const REDUCED_RATE_CATEGORIES = new Set(["income_7", "food"])

export type SageDebitor = {
  Debitorennummer: string
  Name1: string
  Name2: string
  Straße: string
  PLZ: string
  Ort: string
  Land: string
  UStIdNr: string
  Zahlungsziel: string
}

export type SageKreditor = {
  Kreditorennummer: string
  Name1: string
  Name2: string
  Straße: string
  PLZ: string
  Ort: string
  Land: string
  UStIdNr: string
  Zahlungsziel: string
}

export type SageArtikel = {
  Artikelnummer: string
  Bezeichnung: string
  Einheit: string
  "VK-Preis": string
  "EK-Preis": string
  Steuerschlüssel: string
  Warengruppe: string
}

const DEBITOREN_HEADER = "Debitorennummer;Name1;Name2;Straße;PLZ;Ort;Land;UStIdNr;Zahlungsziel"
const KREDITOREN_HEADER = "Kreditorennummer;Name1;Name2;Straße;PLZ;Ort;Land;UStIdNr;Zahlungsziel"
const ARTIKEL_HEADER = "Artikelnummer;Bezeichnung;Einheit;VK-Preis;EK-Preis;Steuerschlüssel;Warengruppe"

/** Debitorennummer range: 10000-69999 (Sage standard) */
const DEBITOR_START = 10000

/** Kreditorennummer range: 70000-99999 */
const KREDITOR_START = 70000

function escapeField(value: string): string {
  if (value.includes('"') || value.includes(";") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatAmount(cents: number): string {
  const amount = Math.abs(cents) / 100
  return amount.toFixed(2).replace(".", ",")
}

export async function generateDebitoren(userId: string): Promise<string> {
  // Pull unique merchants from income transactions
  const transactions = await prisma.transaction.findMany({
    where: { userId, type: "income" },
    select: { merchant: true },
    distinct: ["merchant"],
    orderBy: { merchant: "asc" },
  })

  const lines: string[] = [DEBITOREN_HEADER]
  let counter = DEBITOR_START

  for (const tx of transactions) {
    if (!tx.merchant) continue
    const debitor: SageDebitor = {
      Debitorennummer: String(counter),
      Name1: tx.merchant.slice(0, 50),
      Name2: "",
      Straße: "",
      PLZ: "",
      Ort: "",
      Land: "DE",
      UStIdNr: "",
      Zahlungsziel: "30",
    }
    lines.push([
      debitor.Debitorennummer,
      escapeField(debitor.Name1),
      debitor.Name2,
      debitor.Straße,
      debitor.PLZ,
      debitor.Ort,
      debitor.Land,
      debitor.UStIdNr,
      debitor.Zahlungsziel,
    ].join(";"))
    counter++
    if (counter > 69999) break
  }

  return lines.join("\r\n")
}

export async function generateKreditoren(userId: string): Promise<string> {
  // Pull unique merchants from expense transactions
  const transactions = await prisma.transaction.findMany({
    where: { userId, type: "expense" },
    select: { merchant: true },
    distinct: ["merchant"],
    orderBy: { merchant: "asc" },
  })

  const lines: string[] = [KREDITOREN_HEADER]
  let counter = KREDITOR_START

  for (const tx of transactions) {
    if (!tx.merchant) continue
    const kreditor: SageKreditor = {
      Kreditorennummer: String(counter),
      Name1: tx.merchant.slice(0, 50),
      Name2: "",
      Straße: "",
      PLZ: "",
      Ort: "",
      Land: "DE",
      UStIdNr: "",
      Zahlungsziel: "14",
    }
    lines.push([
      kreditor.Kreditorennummer,
      escapeField(kreditor.Name1),
      kreditor.Name2,
      kreditor.Straße,
      kreditor.PLZ,
      kreditor.Ort,
      kreditor.Land,
      kreditor.UStIdNr,
      kreditor.Zahlungsziel,
    ].join(";"))
    counter++
    if (counter > 99999) break
  }

  return lines.join("\r\n")
}

export async function generateArtikelstamm(userId: string): Promise<string> {
  // Generate from invoice line items if available
  const invoices = await prisma.transaction.findMany({
    where: {
      userId,
      total: { not: null },
    },
    select: {
      name: true,
      total: true,
      type: true,
      categoryCode: true,
    },
    distinct: ["name"],
    orderBy: { name: "asc" },
    take: 5000,
  })

  const lines: string[] = [ARTIKEL_HEADER]
  let counter = 1

  for (const inv of invoices) {
    if (!inv.name) continue
    const isIncome = inv.type === "income"
    const taxKey = "3" // Default 19% Sage tax key
    const artikel: SageArtikel = {
      Artikelnummer: String(counter).padStart(6, "0"),
      Bezeichnung: inv.name.slice(0, 60),
      Einheit: "Stk",
      "VK-Preis": isIncome ? formatAmount(inv.total ?? 0) : "0,00",
      "EK-Preis": !isIncome ? formatAmount(inv.total ?? 0) : "0,00",
      Steuerschlüssel: taxKey,
      Warengruppe: inv.categoryCode || "Allgemein",
    }
    lines.push([
      artikel.Artikelnummer,
      escapeField(artikel.Bezeichnung),
      artikel.Einheit,
      artikel["VK-Preis"],
      artikel["EK-Preis"],
      artikel.Steuerschlüssel,
      escapeField(artikel.Warengruppe),
    ].join(";"))
    counter++
  }

  return lines.join("\r\n")
}

// Alias-Exports für Kompatibilität
export const generateSageDebitorenExport = generateDebitoren
export const generateSageKreditorenExport = generateKreditoren
export const generateSageArtikelExport = generateArtikelstamm
