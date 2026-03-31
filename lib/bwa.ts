/**
 * BWA (Betriebswirtschaftliche Auswertung) — Monatliches Controlling-Report
 * Standard-BWA nach DATEV-Schema (kurzfristige Erfolgsrechnung)
 */

import { prisma } from "@/lib/db"

export type BWALineItem = {
  currentMonth: number      // Aktueller Monat in Cent
  previousMonth: number     // Vormonat in Cent
  ytd: number               // Year-to-date in Cent
  previousYearYtd: number   // Vorjahr YTD in Cent
  percentOfRevenue: number  // Prozent vom Umsatz (Gesamtleistung)
}

export type BWAReport = {
  year: number
  month: number
  // 1. Gesamtleistung
  umsatzerloese: BWALineItem
  bestandsveraenderungen: BWALineItem
  aktivierteEigenleistungen: BWALineItem
  gesamtleistung: BWALineItem
  // 2. Materialaufwand / Wareneinsatz
  materialaufwand: BWALineItem
  // 3. Rohertrag
  rohertrag: BWALineItem
  // 4. Personalkosten
  loehneGehaelter: BWALineItem
  sozialeAbgaben: BWALineItem
  personalkosten: BWALineItem
  // 5. Raumkosten
  miete: BWALineItem
  nebenkosten: BWALineItem
  raumkosten: BWALineItem
  // 6. Betriebliche Steuern
  betrieblicheSteuern: BWALineItem
  // 7. Versicherungen/Beiträge
  versicherungenBeitraege: BWALineItem
  // 8. Kfz-Kosten
  kfzKosten: BWALineItem
  // 9. Werbe-/Reisekosten
  werbeReisekosten: BWALineItem
  // 10. Verschiedene Kosten
  verschiedeneKosten: BWALineItem
  // 11. Gesamtkosten
  gesamtkosten: BWALineItem
  // 12. Betriebsergebnis (EBIT)
  betriebsergebnis: BWALineItem
  // 13. Zinsen und ähnliche Aufwendungen
  zinsen: BWALineItem
  // 14. Ergebnis vor Steuern (EBT)
  ergebnisVorSteuern: BWALineItem
  // 15. Steuern vom Einkommen/Ertrag
  einkommenSteuern: BWALineItem
  // 16. Vorläufiges Ergebnis
  vorlaeufgesErgebnis: BWALineItem
}

// Kategorie-Code → BWA-Position
const CATEGORY_BWA_MAP: Record<string, string> = {
  // Erlöse
  income: "umsatzerloese",
  income_7: "umsatzerloese",
  income_0: "umsatzerloese",
  // Materialaufwand
  material: "materialaufwand",
  // Personalkosten
  salary: "loehneGehaelter",
  // Raumkosten
  rent: "miete",
  cleaning: "nebenkosten",
  // Betriebliche Steuern
  tax: "betrieblicheSteuern",
  // Versicherungen
  insurance: "versicherungenBeitraege",
  // Kfz-Kosten
  vehicle: "kfzKosten",
  // Werbe-/Reisekosten
  advertising: "werbeReisekosten",
  travel: "werbeReisekosten",
  travel_self: "werbeReisekosten",
  food: "werbeReisekosten",
  gifts: "werbeReisekosten",
  // Verschiedene Kosten
  office: "verschiedeneKosten",
  telecom: "verschiedeneKosten",
  postage: "verschiedeneKosten",
  software: "verschiedeneKosten",
  hosting: "verschiedeneKosten",
  legal: "verschiedeneKosten",
  accounting: "verschiedeneKosten",
  training: "verschiedeneKosten",
  bank_fees: "verschiedeneKosten",
  repair: "verschiedeneKosten",
  depreciation: "verschiedeneKosten",
  default_expense: "verschiedeneKosten",
  // Zinsen
  interest: "zinsen",
}

function emptyLineItem(): BWALineItem {
  return {
    currentMonth: 0,
    previousMonth: 0,
    ytd: 0,
    previousYearYtd: 0,
    percentOfRevenue: 0,
  }
}

function addLineItems(a: BWALineItem, b: BWALineItem): BWALineItem {
  return {
    currentMonth: a.currentMonth + b.currentMonth,
    previousMonth: a.previousMonth + b.previousMonth,
    ytd: a.ytd + b.ytd,
    previousYearYtd: a.previousYearYtd + b.previousYearYtd,
    percentOfRevenue: 0, // Wird nachträglich berechnet
  }
}

function subtractLineItems(a: BWALineItem, b: BWALineItem): BWALineItem {
  return {
    currentMonth: a.currentMonth - b.currentMonth,
    previousMonth: a.previousMonth - b.previousMonth,
    ytd: a.ytd - b.ytd,
    previousYearYtd: a.previousYearYtd - b.previousYearYtd,
    percentOfRevenue: 0,
  }
}

function calcPercentOfRevenue(item: BWALineItem, revenue: BWALineItem): BWALineItem {
  return {
    ...item,
    percentOfRevenue: revenue.currentMonth !== 0
      ? Math.round((item.currentMonth / revenue.currentMonth) * 10000) / 100
      : 0,
  }
}

type PeriodKey = "currentMonth" | "previousMonth" | "ytd" | "previousYearYtd"

/**
 * BWA generieren für einen bestimmten Monat
 */
export async function generateBWA(
  userId: string,
  year: number,
  month: number,
): Promise<BWAReport> {
  // Perioden definieren
  const currentMonthStart = new Date(year, month - 1, 1)
  const currentMonthEnd = new Date(year, month, 0, 23, 59, 59, 999)

  const prevMonthStart = new Date(year, month - 2, 1)
  const prevMonthEnd = new Date(year, month - 1, 0, 23, 59, 59, 999)

  const ytdStart = new Date(year, 0, 1)
  const ytdEnd = currentMonthEnd

  const prevYearYtdStart = new Date(year - 1, 0, 1)
  const prevYearYtdEnd = new Date(year - 1, month, 0, 23, 59, 59, 999)

  // Alle relevanten Transaktionen laden
  const allTransactions = await prisma.transaction.findMany({
    where: {
      userId,
      issuedAt: {
        gte: prevYearYtdStart,
        lte: currentMonthEnd,
      },
    },
    include: { category: true },
    orderBy: { issuedAt: "asc" },
  })

  // BWA-Positionen initialisieren
  const positions: Record<string, BWALineItem> = {
    umsatzerloese: emptyLineItem(),
    bestandsveraenderungen: emptyLineItem(),
    aktivierteEigenleistungen: emptyLineItem(),
    materialaufwand: emptyLineItem(),
    loehneGehaelter: emptyLineItem(),
    sozialeAbgaben: emptyLineItem(),
    miete: emptyLineItem(),
    nebenkosten: emptyLineItem(),
    betrieblicheSteuern: emptyLineItem(),
    versicherungenBeitraege: emptyLineItem(),
    kfzKosten: emptyLineItem(),
    werbeReisekosten: emptyLineItem(),
    verschiedeneKosten: emptyLineItem(),
    zinsen: emptyLineItem(),
    einkommenSteuern: emptyLineItem(),
  }

  // Transaktionen den Perioden und BWA-Positionen zuordnen
  for (const tx of allTransactions) {
    if (!tx.total || !tx.issuedAt) continue

    const amount = Math.abs(tx.total)
    const categoryCode = tx.categoryCode?.toLowerCase() ?? ""
    const bwaPosition = tx.type === "income"
      ? "umsatzerloese"
      : (CATEGORY_BWA_MAP[categoryCode] ?? "verschiedeneKosten")

    if (!positions[bwaPosition]) continue

    const txDate = tx.issuedAt

    // In welche Perioden fällt die Transaktion?
    const periods: PeriodKey[] = []

    if (txDate >= currentMonthStart && txDate <= currentMonthEnd) {
      periods.push("currentMonth")
    }
    if (txDate >= prevMonthStart && txDate <= prevMonthEnd) {
      periods.push("previousMonth")
    }
    if (txDate >= ytdStart && txDate <= ytdEnd) {
      periods.push("ytd")
    }
    if (txDate >= prevYearYtdStart && txDate <= prevYearYtdEnd) {
      periods.push("previousYearYtd")
    }

    for (const period of periods) {
      positions[bwaPosition][period] += amount
    }
  }

  // Summen berechnen
  const gesamtleistung = addLineItems(
    addLineItems(positions.umsatzerloese, positions.bestandsveraenderungen),
    positions.aktivierteEigenleistungen,
  )

  const personalkosten = addLineItems(positions.loehneGehaelter, positions.sozialeAbgaben)
  const raumkosten = addLineItems(positions.miete, positions.nebenkosten)

  const gesamtkosten = [
    positions.materialaufwand,
    personalkosten,
    raumkosten,
    positions.betrieblicheSteuern,
    positions.versicherungenBeitraege,
    positions.kfzKosten,
    positions.werbeReisekosten,
    positions.verschiedeneKosten,
  ].reduce(addLineItems, emptyLineItem())

  const rohertrag = subtractLineItems(gesamtleistung, positions.materialaufwand)
  const betriebsergebnis = subtractLineItems(gesamtleistung, gesamtkosten)
  const ergebnisVorSteuern = subtractLineItems(betriebsergebnis, positions.zinsen)
  const vorlaeufgesErgebnis = subtractLineItems(ergebnisVorSteuern, positions.einkommenSteuern)

  // Prozent vom Umsatz berechnen
  const withPercent = (item: BWALineItem) => calcPercentOfRevenue(item, gesamtleistung)

  return {
    year,
    month,
    umsatzerloese: withPercent(positions.umsatzerloese),
    bestandsveraenderungen: withPercent(positions.bestandsveraenderungen),
    aktivierteEigenleistungen: withPercent(positions.aktivierteEigenleistungen),
    gesamtleistung: withPercent(gesamtleistung),
    materialaufwand: withPercent(positions.materialaufwand),
    rohertrag: withPercent(rohertrag),
    loehneGehaelter: withPercent(positions.loehneGehaelter),
    sozialeAbgaben: withPercent(positions.sozialeAbgaben),
    personalkosten: withPercent(personalkosten),
    miete: withPercent(positions.miete),
    nebenkosten: withPercent(positions.nebenkosten),
    raumkosten: withPercent(raumkosten),
    betrieblicheSteuern: withPercent(positions.betrieblicheSteuern),
    versicherungenBeitraege: withPercent(positions.versicherungenBeitraege),
    kfzKosten: withPercent(positions.kfzKosten),
    werbeReisekosten: withPercent(positions.werbeReisekosten),
    verschiedeneKosten: withPercent(positions.verschiedeneKosten),
    gesamtkosten: withPercent(gesamtkosten),
    betriebsergebnis: withPercent(betriebsergebnis),
    zinsen: withPercent(positions.zinsen),
    ergebnisVorSteuern: withPercent(ergebnisVorSteuern),
    einkommenSteuern: withPercent(positions.einkommenSteuern),
    vorlaeufgesErgebnis: withPercent(vorlaeufgesErgebnis),
  }
}

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
]

function formatEuro(cents: number): string {
  const amount = cents / 100
  return amount.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * BWA als CSV exportieren
 */
export function formatBWAAsCSV(report: BWAReport): string {
  const sep = ";"
  const header = [
    "Position",
    `${MONTH_NAMES[report.month - 1]} ${report.year}`,
    `${MONTH_NAMES[(report.month - 2 + 12) % 12]} ${report.month === 1 ? report.year - 1 : report.year}`,
    `YTD ${report.year}`,
    `YTD ${report.year - 1}`,
    "% vom Umsatz",
  ].join(sep)

  const row = (label: string, item: BWALineItem) => [
    label,
    formatEuro(item.currentMonth),
    formatEuro(item.previousMonth),
    formatEuro(item.ytd),
    formatEuro(item.previousYearYtd),
    `${item.percentOfRevenue.toFixed(1)}%`,
  ].join(sep)

  const lines = [
    header,
    "",
    "=== GESAMTLEISTUNG ===",
    row("Umsatzerlöse", report.umsatzerloese),
    row("Bestandsveränderungen", report.bestandsveraenderungen),
    row("Aktivierte Eigenleistungen", report.aktivierteEigenleistungen),
    row("GESAMTLEISTUNG", report.gesamtleistung),
    "",
    row("Materialaufwand / Wareneinsatz", report.materialaufwand),
    "",
    row("ROHERTRAG", report.rohertrag),
    "",
    "=== KOSTEN ===",
    row("Löhne und Gehälter", report.loehneGehaelter),
    row("Soziale Abgaben", report.sozialeAbgaben),
    row("Personalkosten gesamt", report.personalkosten),
    "",
    row("Miete", report.miete),
    row("Nebenkosten", report.nebenkosten),
    row("Raumkosten gesamt", report.raumkosten),
    "",
    row("Betriebliche Steuern", report.betrieblicheSteuern),
    row("Versicherungen/Beiträge", report.versicherungenBeitraege),
    row("Kfz-Kosten", report.kfzKosten),
    row("Werbe-/Reisekosten", report.werbeReisekosten),
    row("Verschiedene Kosten", report.verschiedeneKosten),
    "",
    row("GESAMTKOSTEN", report.gesamtkosten),
    "",
    "=== ERGEBNIS ===",
    row("Betriebsergebnis (EBIT)", report.betriebsergebnis),
    row("Zinsen und ähnliche Aufwendungen", report.zinsen),
    row("Ergebnis vor Steuern (EBT)", report.ergebnisVorSteuern),
    row("Steuern vom Einkommen/Ertrag", report.einkommenSteuern),
    row("VORLÄUFIGES ERGEBNIS", report.vorlaeufgesErgebnis),
  ]

  return lines.join("\r\n")
}

/**
 * BWA als HTML für Anzeige/Druck
 */
export function formatBWAAsHTML(report: BWAReport): string {
  const f = (cents: number) => formatEuro(cents)

  const rowHtml = (label: string, item: BWALineItem, bold = false) => {
    const tag = bold ? "th" : "td"
    const style = bold ? ' style="font-weight:bold;border-top:2px solid #333;"' : ""
    return `<tr${style}>
      <${tag}>${label}</${tag}>
      <${tag} class="num">${f(item.currentMonth)}</${tag}>
      <${tag} class="num">${f(item.previousMonth)}</${tag}>
      <${tag} class="num">${f(item.ytd)}</${tag}>
      <${tag} class="num">${f(item.previousYearYtd)}</${tag}>
      <${tag} class="num">${item.percentOfRevenue.toFixed(1)}%</${tag}>
    </tr>`
  }

  const prevMonthLabel = `${MONTH_NAMES[(report.month - 2 + 12) % 12]} ${report.month === 1 ? report.year - 1 : report.year}`

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>BWA ${MONTH_NAMES[report.month - 1]} ${report.year}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
  h1 { font-size: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 4px 8px; text-align: left; border-bottom: 1px solid #ddd; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .section { background: #f5f5f5; font-weight: bold; }
  .subtotal { border-top: 2px solid #333; font-weight: bold; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>Betriebswirtschaftliche Auswertung (BWA)</h1>
<p>${MONTH_NAMES[report.month - 1]} ${report.year}</p>
<table>
<thead>
<tr>
  <th>Position</th>
  <th class="num">${MONTH_NAMES[report.month - 1]} ${report.year}</th>
  <th class="num">${prevMonthLabel}</th>
  <th class="num">YTD ${report.year}</th>
  <th class="num">YTD ${report.year - 1}</th>
  <th class="num">% Umsatz</th>
</tr>
</thead>
<tbody>
<tr class="section"><td colspan="6">Gesamtleistung</td></tr>
${rowHtml("Umsatzerlöse", report.umsatzerloese)}
${rowHtml("Bestandsveränderungen", report.bestandsveraenderungen)}
${rowHtml("Aktivierte Eigenleistungen", report.aktivierteEigenleistungen)}
${rowHtml("Gesamtleistung", report.gesamtleistung, true)}

<tr><td colspan="6">&nbsp;</td></tr>
${rowHtml("Materialaufwand / Wareneinsatz", report.materialaufwand)}
${rowHtml("Rohertrag", report.rohertrag, true)}

<tr class="section"><td colspan="6">Kosten</td></tr>
${rowHtml("Löhne und Gehälter", report.loehneGehaelter)}
${rowHtml("Soziale Abgaben", report.sozialeAbgaben)}
${rowHtml("Personalkosten", report.personalkosten, true)}

${rowHtml("Miete", report.miete)}
${rowHtml("Nebenkosten", report.nebenkosten)}
${rowHtml("Raumkosten", report.raumkosten, true)}

${rowHtml("Betriebliche Steuern", report.betrieblicheSteuern)}
${rowHtml("Versicherungen/Beiträge", report.versicherungenBeitraege)}
${rowHtml("Kfz-Kosten", report.kfzKosten)}
${rowHtml("Werbe-/Reisekosten", report.werbeReisekosten)}
${rowHtml("Verschiedene Kosten", report.verschiedeneKosten)}
${rowHtml("Gesamtkosten", report.gesamtkosten, true)}

<tr class="section"><td colspan="6">Ergebnis</td></tr>
${rowHtml("Betriebsergebnis (EBIT)", report.betriebsergebnis, true)}
${rowHtml("Zinsen und ähnliche Aufwendungen", report.zinsen)}
${rowHtml("Ergebnis vor Steuern (EBT)", report.ergebnisVorSteuern, true)}
${rowHtml("Steuern vom Einkommen/Ertrag", report.einkommenSteuern)}
${rowHtml("Vorläufiges Ergebnis", report.vorlaeufgesErgebnis, true)}
</tbody>
</table>
</body>
</html>`
}
