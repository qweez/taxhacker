/**
 * Mahnwesen — German Dunning Process (1./2./3. Mahnung)
 * §288 BGB Verzugszinsen, Mahngebühren, Inkasso-Androhung
 */

import { prisma } from "@/lib/db"
import type { OpenItem } from "@/lib/open-items"

// ─── Types ───────────────────────────────────────────────────────────

export type DunningConfig = {
  paymentTermDays: number       // Zahlungsziel (default: 30)
  firstReminderDays: number     // 1. Mahnung nach X Tagen nach Fälligkeit
  secondReminderDays: number    // 2. Mahnung
  thirdReminderDays: number     // 3. Mahnung
  interestRate: number          // Verzugszinsen p.a. override (0 = use §288 BGB)
  dunningFee1: number           // Mahngebühr 1. Mahnung in cents
  dunningFee2: number           // 2. Mahnung in cents
  dunningFee3: number           // 3. Mahnung in cents
}

export type DunningCandidate = {
  openItem: OpenItem
  nextLevel: number
  daysPastDue: number
  suggestedFee: number
  suggestedInterest: number
}

export type DunningHistoryEntry = {
  id: string
  level: number
  date: Date
  fee: number
  interest: number
  letterText: string | null
  sentVia: string | null
  createdAt: Date
}

// ─── Constants ───────────────────────────────────────────────────────

// Basiszins der Bundesbank, updated semi-annually (as of 2026-01-01: 2.27%)
export const BASISZINS = 2.27

// §288 BGB: Verzugszinsen = Basiszins + 5% (B2C) or Basiszins + 9% (B2B)
export const B2C_MARKUP = 5.0
export const B2B_MARKUP = 9.0

export const DEFAULT_DUNNING_CONFIG: DunningConfig = {
  paymentTermDays: 30,
  firstReminderDays: 14,     // 14 Tage nach Fälligkeit
  secondReminderDays: 28,    // 28 Tage nach Fälligkeit
  thirdReminderDays: 42,     // 42 Tage nach Fälligkeit
  interestRate: 0,           // 0 = automatic §288 BGB calculation
  dunningFee1: 0,            // 1. Mahnung oft kostenlos
  dunningFee2: 500,          // 5,00 €
  dunningFee3: 1000,         // 10,00 €
}

// ─── Interest Calculation ────────────────────────────────────────────

export function calculateDefaultInterest(
  amountCents: number,
  daysPastDue: number,
  isB2B: boolean,
): number {
  if (daysPastDue <= 0 || amountCents <= 0) return 0

  const markup = isB2B ? B2B_MARKUP : B2C_MARKUP
  const annualRate = (BASISZINS + markup) / 100
  const dailyRate = annualRate / 365
  const interest = amountCents * dailyRate * daysPastDue

  return Math.round(interest)
}

// ─── Dunning Candidates ──────────────────────────────────────────────

function calcDaysPastDue(dueDate: Date, now?: Date): number {
  const today = now ?? new Date()
  const due = new Date(dueDate)
  const diff = today.getTime() - due.getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

export async function getDunningCandidates(
  userId: string,
  config?: Partial<DunningConfig>,
): Promise<DunningCandidate[]> {
  const cfg = { ...DEFAULT_DUNNING_CONFIG, ...config }

  const items = await prisma.openItem.findMany({
    where: {
      userId,
      type: "debitor",
      status: { in: ["open", "partial", "overdue", "dunned"] },
    },
    orderBy: { dueDate: "asc" },
  })

  const candidates: DunningCandidate[] = []

  for (const item of items) {
    const daysPast = calcDaysPastDue(item.dueDate)
    if (daysPast <= 0) continue

    let nextLevel = item.dunningLevel + 1
    if (nextLevel > 3) continue

    // Check if enough time has passed for next dunning level
    let requiredDays: number
    switch (nextLevel) {
      case 1:
        requiredDays = cfg.firstReminderDays
        break
      case 2:
        requiredDays = cfg.secondReminderDays
        break
      case 3:
        requiredDays = cfg.thirdReminderDays
        break
      default:
        continue
    }

    if (daysPast < requiredDays) continue

    const remaining = item.amount - item.paidAmount
    const fee = nextLevel === 1 ? cfg.dunningFee1
      : nextLevel === 2 ? cfg.dunningFee2
      : cfg.dunningFee3

    const interest = calculateDefaultInterest(remaining, daysPast, item.isB2B)

    candidates.push({
      openItem: {
        id: item.id,
        type: item.type as "debitor" | "kreditor",
        invoiceNumber: item.invoiceNumber,
        invoiceDate: item.invoiceDate,
        dueDate: item.dueDate,
        merchant: item.merchant,
        merchantAddress: item.merchantAddress,
        amount: item.amount,
        paidAmount: item.paidAmount,
        remainingAmount: remaining,
        status: item.status as any,
        daysPastDue: daysPast,
        dunningLevel: item.dunningLevel,
        lastDunningDate: item.lastDunningDate,
        dunningFees: item.dunningFees,
        interestAccrued: item.interestAccrued,
        transactionId: item.transactionId,
        notes: item.notes,
        isB2B: item.isB2B,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
      nextLevel,
      daysPastDue: daysPast,
      suggestedFee: fee,
      suggestedInterest: interest,
    })
  }

  return candidates
}

// ─── Letter Generation ───────────────────────────────────────────────

function formatEur(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €"
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function generateDunningLetter(
  openItem: {
    invoiceNumber: string
    invoiceDate: Date
    dueDate: Date
    merchant: string
    merchantAddress?: string | null
    amount: number
    paidAmount: number
    isB2B: boolean
    dunningFees: number
    interestAccrued: number
  },
  level: number,
  config?: Partial<DunningConfig>,
): string {
  const cfg = { ...DEFAULT_DUNNING_CONFIG, ...config }
  const remaining = openItem.amount - openItem.paidAmount
  const daysPast = calcDaysPastDue(openItem.dueDate)
  const interest = calculateDefaultInterest(remaining, daysPast, openItem.isB2B)
  const fee = level === 1 ? cfg.dunningFee1 : level === 2 ? cfg.dunningFee2 : cfg.dunningFee3
  const totalDue = remaining + fee + interest

  const paymentDeadline = new Date()
  paymentDeadline.setDate(paymentDeadline.getDate() + (level === 3 ? 7 : 14))

  if (level === 1) {
    return `Zahlungserinnerung

Sehr geehrte Damen und Herren,

bei Durchsicht unserer Buchhaltung haben wir festgestellt, dass die folgende Rechnung noch nicht beglichen wurde:

Rechnungsnummer: ${openItem.invoiceNumber}
Rechnungsdatum: ${formatDate(openItem.invoiceDate)}
Fälligkeitsdatum: ${formatDate(openItem.dueDate)}
Rechnungsbetrag: ${formatEur(openItem.amount)}
Bereits bezahlt: ${formatEur(openItem.paidAmount)}
Offener Betrag: ${formatEur(remaining)}

Sicherlich handelt es sich um ein Versehen. Wir bitten Sie, den ausstehenden Betrag bis zum ${formatDate(paymentDeadline)} auf unser Konto zu überweisen.

Sollte sich Ihre Zahlung mit diesem Schreiben gekreuzt haben, betrachten Sie dieses bitte als gegenstandslos.

Mit freundlichen Grüßen`
  }

  if (level === 2) {
    return `2. Mahnung

Sehr geehrte Damen und Herren,

trotz unserer Zahlungserinnerung ist die folgende Rechnung weiterhin unbeglichen:

Rechnungsnummer: ${openItem.invoiceNumber}
Rechnungsdatum: ${formatDate(openItem.invoiceDate)}
Fälligkeitsdatum: ${formatDate(openItem.dueDate)}
Offener Betrag: ${formatEur(remaining)}
Mahngebühr: ${formatEur(fee)}
Gesamtbetrag: ${formatEur(remaining + fee)}

Wir bitten Sie dringend, den Gesamtbetrag von ${formatEur(remaining + fee)} bis zum ${formatDate(paymentDeadline)} zu begleichen.

Mit freundlichen Grüßen`
  }

  // Level 3 — Letzte Mahnung
  return `Letzte Mahnung

Sehr geehrte Damen und Herren,

trotz unserer bisherigen Mahnungen haben wir bisher keinen Zahlungseingang für die folgende Rechnung verzeichnen können:

Rechnungsnummer: ${openItem.invoiceNumber}
Rechnungsdatum: ${formatDate(openItem.invoiceDate)}
Fälligkeitsdatum: ${formatDate(openItem.dueDate)}
Offener Rechnungsbetrag: ${formatEur(remaining)}
Mahngebühren: ${formatEur(fee)}
Verzugszinsen (${openItem.isB2B ? "§288 Abs. 2 BGB" : "§288 Abs. 1 BGB"}): ${formatEur(interest)}
Fälliger Gesamtbetrag: ${formatEur(totalDue)}

Die Verzugszinsen berechnen sich nach §288 BGB mit einem Zinssatz von ${(BASISZINS + (openItem.isB2B ? B2B_MARKUP : B2C_MARKUP)).toFixed(2).replace(".", ",")}% p.a. (Basiszinssatz ${BASISZINS.toFixed(2).replace(".", ",")}% + ${openItem.isB2B ? "9" : "5"} Prozentpunkte).

Wir fordern Sie hiermit letztmalig auf, den Gesamtbetrag von ${formatEur(totalDue)} bis spätestens ${formatDate(paymentDeadline)} auf unser Konto zu überweisen.

Sollte bis zu diesem Datum kein Zahlungseingang erfolgen, werden wir ohne weitere Ankündigung ein Inkassounternehmen beauftragen bzw. gerichtliche Mahnverfahren einleiten. Die daraus entstehenden zusätzlichen Kosten gehen zu Ihren Lasten.

Mit freundlichen Grüßen`
}

// ─── Execute Dunning ─────────────────────────────────────────────────

export async function executeDunning(
  openItemId: string,
  userId: string,
  config?: Partial<DunningConfig>,
): Promise<DunningHistoryEntry> {
  const cfg = { ...DEFAULT_DUNNING_CONFIG, ...config }

  const item = await prisma.openItem.findFirst({
    where: { id: openItemId, userId, type: "debitor" },
  })

  if (!item) throw new Error("Offener Posten nicht gefunden")

  const nextLevel = item.dunningLevel + 1
  if (nextLevel > 3) throw new Error("Maximale Mahnstufe bereits erreicht")

  const remaining = item.amount - item.paidAmount
  const daysPast = calcDaysPastDue(item.dueDate)
  const interest = calculateDefaultInterest(remaining, daysPast, item.isB2B)
  const fee = nextLevel === 1 ? cfg.dunningFee1
    : nextLevel === 2 ? cfg.dunningFee2
    : cfg.dunningFee3

  const letterText = generateDunningLetter(
    {
      invoiceNumber: item.invoiceNumber,
      invoiceDate: item.invoiceDate,
      dueDate: item.dueDate,
      merchant: item.merchant,
      merchantAddress: item.merchantAddress,
      amount: item.amount,
      paidAmount: item.paidAmount,
      isB2B: item.isB2B,
      dunningFees: item.dunningFees,
      interestAccrued: item.interestAccrued,
    },
    nextLevel,
    cfg,
  )

  const today = new Date()

  const [entry] = await prisma.$transaction([
    prisma.dunningEntry.create({
      data: {
        openItemId,
        level: nextLevel,
        date: today,
        fee,
        interest,
        letterText,
      },
    }),
    prisma.openItem.update({
      where: { id: openItemId },
      data: {
        dunningLevel: nextLevel,
        lastDunningDate: today,
        status: "dunned",
        dunningFees: { increment: fee },
        interestAccrued: { increment: interest },
      },
    }),
  ])

  return {
    id: entry.id,
    level: entry.level,
    date: entry.date,
    fee: entry.fee,
    interest: entry.interest,
    letterText: entry.letterText,
    sentVia: entry.sentVia,
    createdAt: entry.createdAt,
  }
}

// ─── Dunning History ─────────────────────────────────────────────────

export async function getDunningHistory(
  openItemId: string,
): Promise<DunningHistoryEntry[]> {
  const entries = await prisma.dunningEntry.findMany({
    where: { openItemId },
    orderBy: { date: "asc" },
  })

  return entries.map(e => ({
    id: e.id,
    level: e.level,
    date: e.date,
    fee: e.fee,
    interest: e.interest,
    letterText: e.letterText,
    sentVia: e.sentVia,
    createdAt: e.createdAt,
  }))
}
