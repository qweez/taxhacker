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

/** Sage 7.1 Steuerschlüssel mapping (VAT rate % -> Sage tax key) */
export const SAGE_TAX_KEYS: Record<string, string> = {
  "19": "3",
  "7": "2",
  "0": "0",
}

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

function guessTaxKey(tx: Transaction & { category?: Category | null }): string {
  // Default to 19% for most transactions
  const code = tx.categoryCode?.toLowerCase() ?? ""
  if (code === "income_0" || code === "insurance" || code === "bank_fees" || code === "interest") {
    return SAGE_TAX_KEYS["0"]
  }
  if (code === "income_7") {
    return SAGE_TAX_KEYS["7"]
  }
  return SAGE_TAX_KEYS["19"]
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
    Steuerschlüssel: guessTaxKey(tx),
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
): Promise<string> {
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

  const lines: string[] = [SAGE_HEADER]

  for (const tx of transactions) {
    if (!tx.total) continue
    const buchung = transactionToSageBuchung(tx)
    lines.push(formatSageBuchungRow(buchung))
  }

  // Sage 7.1 expects CR+LF line endings
  return lines.join("\r\n")
}
