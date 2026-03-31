/**
 * Sage Warenwirtschaft 7.1 (2016) kompatible Exporte
 * Sage 7.1 hat KEINE REST API, daher werden Import-kompatible Dateien generiert.
 *
 * Format: Semikolon-getrennt, Windows-1252 Encoding, CR+LF Zeilenumbrüche
 */

import { prisma } from "@/lib/db"
import { format } from "date-fns"
import type { Transaction, Category } from "@/prisma/client"

export type SageExportOptions = {
  encoding?: "windows-1252" | "utf-8"
  separator?: string
}

export type SageBuchung = {
  Belegdatum: string
  Belegnummer: string
  Buchungstext: string
  Sollkonto: string
  Habenkonto: string
  Betrag: string
  Steuerschlüssel: string
  Kostenstelle: string
}

export type SageDebitor = {
  Debitorennummer: string
  Firma: string
  Straße: string
  PLZ: string
  Ort: string
  "USt-IdNr": string
}

export type SageKreditor = {
  Kreditorennummer: string
  Firma: string
  Straße: string
  PLZ: string
  Ort: string
  "USt-IdNr": string
}

export type SageArtikel = {
  Artikelnummer: string
  Bezeichnung: string
  Einheit: string
  "VK-Preis": string
  "EK-Preis": string
  "MwSt-Satz": string
}

// Steuerschlüssel: 1=ohne USt, 2=7% VSt, 3=19% VSt, 8=7% USt, 9=19% USt
const SAGE_STEUERSCHLUESSEL: Record<string, string> = {
  keine: "1",
  vst_7: "2",
  vst_19: "3",
  ust_7: "8",
  ust_19: "9",
}

// SKR04-Kontozuordnung
const SKR04_ACCOUNTS: Record<string, string> = {
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
  bank: "1800",
  cash: "1600",
}

// Steuerfreie Kategorien
const EXEMPT_CATEGORIES = new Set(["income_0", "insurance", "interest", "bank_fees", "salary", "tax"])
const REDUCED_RATE_CATEGORIES = new Set(["income_7", "food"])

function escapeField(value: string, separator = ";"): string {
  if (value.includes('"') || value.includes(separator) || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatDate(date: Date): string {
  return format(date, "dd.MM.yyyy")
}

function formatAmount(cents: number): string {
  const amount = Math.abs(cents) / 100
  return amount.toFixed(2).replace(".", ",")
}

function getAccount(tx: Transaction & { category?: Category | null }): string {
  if (tx.categoryCode) {
    const mapped = SKR04_ACCOUNTS[tx.categoryCode.toLowerCase()]
    if (mapped) return mapped
  }
  return tx.type === "income" ? SKR04_ACCOUNTS.default_income : SKR04_ACCOUNTS.default_expense
}

function getSteuerschluessel(tx: Transaction & { category?: Category | null }): string {
  const code = tx.categoryCode?.toLowerCase() ?? ""
  const isIncome = tx.type === "income"

  if (EXEMPT_CATEGORIES.has(code)) {
    return SAGE_STEUERSCHLUESSEL.keine
  }
  if (REDUCED_RATE_CATEGORIES.has(code)) {
    return isIncome ? SAGE_STEUERSCHLUESSEL.ust_7 : SAGE_STEUERSCHLUESSEL.vst_7
  }
  return isIncome ? SAGE_STEUERSCHLUESSEL.ust_19 : SAGE_STEUERSCHLUESSEL.vst_19
}

/**
 * Buchungsstapel CSV generieren (Sage 7.1 Import-Format)
 * Spalten: Belegdatum, Belegnummer, Buchungstext, Sollkonto, Habenkonto, Betrag, Steuerschlüssel, Kostenstelle
 */
export async function generateSageBuchungsstapel(
  userId: string,
  dateFrom?: Date,
  dateTo?: Date,
  options: SageExportOptions = {},
): Promise<string> {
  const separator = options.separator ?? ";"

  const where: Record<string, unknown> = { userId }
  if (dateFrom || dateTo) {
    const issuedAt: Record<string, Date> = {}
    if (dateFrom) issuedAt.gte = dateFrom
    if (dateTo) issuedAt.lte = dateTo
    where.issuedAt = issuedAt
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true },
    orderBy: { issuedAt: "asc" },
  })

  const header = ["Belegdatum", "Belegnummer", "Buchungstext", "Sollkonto", "Habenkonto", "Betrag", "Steuerschlüssel", "Kostenstelle"].join(separator)

  const lines: string[] = [header]

  for (const tx of transactions) {
    if (!tx.total) continue

    const account = getAccount(tx)
    const bankAccount = SKR04_ACCOUNTS.bank
    const isIncome = tx.type === "income"

    const buchung: SageBuchung = {
      Belegdatum: tx.issuedAt ? formatDate(tx.issuedAt) : "",
      Belegnummer: (tx.externalId || tx.id).slice(0, 20),
      Buchungstext: [tx.merchant, tx.name].filter(Boolean).join(" - ").slice(0, 60),
      Sollkonto: isIncome ? bankAccount : account,
      Habenkonto: isIncome ? account : bankAccount,
      Betrag: formatAmount(tx.total),
      Steuerschlüssel: getSteuerschluessel(tx),
      Kostenstelle: "",
    }

    lines.push([
      escapeField(buchung.Belegdatum, separator),
      escapeField(buchung.Belegnummer, separator),
      escapeField(buchung.Buchungstext, separator),
      buchung.Sollkonto,
      buchung.Habenkonto,
      buchung.Betrag,
      buchung.Steuerschlüssel,
      buchung.Kostenstelle,
    ].join(separator))
  }

  // Sage 7.1 erwartet CR+LF
  return lines.join("\r\n")
}

/**
 * Debitorenstammdaten CSV generieren
 * Spalten: Debitorennummer, Firma, Straße, PLZ, Ort, USt-IdNr
 */
export async function generateSageDebitorenExport(userId: string, options: SageExportOptions = {}): Promise<string> {
  const separator = options.separator ?? ";"

  const transactions = await prisma.transaction.findMany({
    where: { userId, type: "income" },
    select: { merchant: true },
    distinct: ["merchant"],
    orderBy: { merchant: "asc" },
  })

  const header = ["Debitorennummer", "Firma", "Straße", "PLZ", "Ort", "USt-IdNr"].join(separator)
  const lines: string[] = [header]
  let counter = 10000

  for (const tx of transactions) {
    if (!tx.merchant) continue
    lines.push([
      String(counter),
      escapeField(tx.merchant.slice(0, 50), separator),
      "", // Straße
      "", // PLZ
      "", // Ort
      "", // USt-IdNr
    ].join(separator))
    counter++
    if (counter > 69999) break
  }

  return lines.join("\r\n")
}

/**
 * Kreditorenstammdaten CSV generieren
 * Spalten: Kreditorennummer, Firma, Straße, PLZ, Ort, USt-IdNr
 */
export async function generateSageKreditorenExport(userId: string, options: SageExportOptions = {}): Promise<string> {
  const separator = options.separator ?? ";"

  const transactions = await prisma.transaction.findMany({
    where: { userId, type: "expense" },
    select: { merchant: true },
    distinct: ["merchant"],
    orderBy: { merchant: "asc" },
  })

  const header = ["Kreditorennummer", "Firma", "Straße", "PLZ", "Ort", "USt-IdNr"].join(separator)
  const lines: string[] = [header]
  let counter = 70000

  for (const tx of transactions) {
    if (!tx.merchant) continue
    lines.push([
      String(counter),
      escapeField(tx.merchant.slice(0, 50), separator),
      "",
      "",
      "",
      "",
    ].join(separator))
    counter++
    if (counter > 99999) break
  }

  return lines.join("\r\n")
}

/**
 * Artikelstamm CSV generieren
 * Spalten: Artikelnummer, Bezeichnung, Einheit, VK-Preis, EK-Preis, MwSt-Satz
 */
export async function generateSageArtikelExport(userId: string, options: SageExportOptions = {}): Promise<string> {
  const separator = options.separator ?? ";"

  const transactions = await prisma.transaction.findMany({
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

  const header = ["Artikelnummer", "Bezeichnung", "Einheit", "VK-Preis", "EK-Preis", "MwSt-Satz"].join(separator)
  const lines: string[] = [header]
  let counter = 1

  for (const tx of transactions) {
    if (!tx.name) continue

    const isIncome = tx.type === "income"
    const code = tx.categoryCode?.toLowerCase() ?? ""
    let mwstSatz = "19"
    if (EXEMPT_CATEGORIES.has(code)) mwstSatz = "0"
    else if (REDUCED_RATE_CATEGORIES.has(code)) mwstSatz = "7"

    lines.push([
      String(counter).padStart(6, "0"),
      escapeField(tx.name.slice(0, 60), separator),
      "Stk",
      isIncome ? formatAmount(tx.total ?? 0) : "0,00",
      !isIncome ? formatAmount(tx.total ?? 0) : "0,00",
      mwstSatz,
    ].join(separator))
    counter++
  }

  return lines.join("\r\n")
}
