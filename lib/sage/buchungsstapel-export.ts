import { prisma } from "@/lib/db"
import { format } from "date-fns"
import type { Transaction, Category } from "@/prisma/client"

/**
 * Sage Warenwirtschaft 7.1 (2016) Buchungsstapel CSV export.
 * ASCII/CSV import format compatible with Sage 7.1.
 *
 * Format: semicolon-separated, Windows-1252 encoding
 * Line endings: CR+LF
 */

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

// Steuerschlüssel: 1=ohne USt, 2=7% VSt, 3=19% VSt, 8=7% USt, 9=19% USt
export const SAGE_STEUERSCHLUESSEL: Record<string, string> = {
  keine: "1",
  vst_7: "2",
  vst_19: "3",
  ust_7: "8",
  ust_19: "9",
}

/** Sage 7.1 Steuerschlüssel mapping (VAT rate % -> Sage tax key) */
export const SAGE_TAX_KEYS: Record<string, string> = {
  "19": "3",
  "7": "2",
  "0": "0",
}

// Steuerfreie Kategorien
const EXEMPT_CATEGORIES = new Set(["income_0", "insurance", "interest", "bank_fees", "salary", "tax"])
const REDUCED_RATE_CATEGORIES = new Set(["income_7", "food"])

// SKR04 account mappings (reused from datev-export.ts structure)
const SKR04_ACCOUNTS: Record<string, string> = {
  // Revenue
  income: "4400",
  income_7: "4300",
  income_0: "4100",
  // Expenses
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

const SAGE_HEADER = "Belegdatum;Belegnummer;Buchungstext;Sollkonto;Habenkonto;Betrag;USt;Kostenstelle"

function getSageAccount(
  tx: Transaction & { category?: Category | null },
): string {
  if (tx.categoryCode) {
    const mapped = SKR04_ACCOUNTS[tx.categoryCode.toLowerCase()]
    if (mapped) return mapped
  }
  return tx.type === "income"
    ? SKR04_ACCOUNTS.default_income
    : SKR04_ACCOUNTS.default_expense
}

function formatSageDate(date: Date): string {
  return format(date, "dd.MM.yyyy")
}

function formatSageAmount(cents: number): string {
  const amount = Math.abs(cents) / 100
  return amount.toFixed(2).replace(".", ",")
}

function escapeField(value: string): string {
  if (value.includes('"') || value.includes(";") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
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

export function transactionToSageBuchung(
  tx: Transaction & { category?: Category | null },
): SageBuchung {
  const account = getSageAccount(tx)
  const bankAccount = SKR04_ACCOUNTS.bank
  const isIncome = tx.type === "income"

  return {
    Belegdatum: tx.issuedAt ? formatSageDate(tx.issuedAt) : "",
    Belegnummer: (tx.externalId || tx.id).slice(0, 20),
    Buchungstext: [tx.merchant, tx.name].filter(Boolean).join(" - ").slice(0, 60),
    Sollkonto: isIncome ? bankAccount : account,
    Habenkonto: isIncome ? account : bankAccount,
    Betrag: formatSageAmount(tx.total || 0),
    Steuerschlüssel: getSteuerschluessel(tx),
    Kostenstelle: "",
  }
}

export function formatSageBuchungRow(buchung: SageBuchung): string {
  return [
    escapeField(buchung.Belegdatum),
    escapeField(buchung.Belegnummer),
    escapeField(buchung.Buchungstext),
    buchung.Sollkonto,
    buchung.Habenkonto,
    buchung.Betrag,
    buchung.Steuerschlüssel,
    buchung.Kostenstelle,
  ].join(";")
}

export async function generateSageBuchungsstapel(
  userId: string,
  dateFrom?: Date,
  dateTo?: Date,
  options: SageExportOptions = {},
): Promise<string> {
  const separator = options.separator ?? ";"
  const where: any = { userId }

  if (dateFrom || dateTo) {
    where.issuedAt = {}
    if (dateFrom) where.issuedAt.gte = dateFrom
    if (dateTo) where.issuedAt.lte = dateTo
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
    const buchung = transactionToSageBuchung(tx)
    lines.push([
      escapeField(buchung.Belegdatum),
      escapeField(buchung.Belegnummer),
      escapeField(buchung.Buchungstext),
      buchung.Sollkonto,
      buchung.Habenkonto,
      buchung.Betrag,
      buchung.Steuerschlüssel,
      buchung.Kostenstelle,
    ].join(separator))
  }

  // Sage 7.1 expects CR+LF line endings
  return lines.join("\r\n")
}
