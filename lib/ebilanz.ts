/**
 * E-Bilanz (XBRL) Export — Elektronische Bilanz für das Finanzamt
 * HGB-Taxonomie 6.x, SKR04-Kontenrahmen
 */

import { prisma } from "@/lib/db"

// ─── Types ───────────────────────────────────────────────────────────

export type EBilanzPosition = {
  taxonomyId: string   // e.g. "de-gaap-ci_bs.ass.fixAss"
  label: string
  value: number        // in cents
}

export type EBilanzReport = {
  companyName: string
  taxNumber: string
  fiscalYearFrom: Date
  fiscalYearTo: Date
  balanceSheet: EBilanzPosition[]   // Bilanz
  incomeStatement: EBilanzPosition[] // GuV
}

// ─── SKR04 → HGB Taxonomy Mapping ───────────────────────────────────

export type TaxonomyMappingEntry = {
  taxonomyId: string
  label: string
  accountRange: [number, number]
  section: "aktiva" | "passiva" | "guv"
}

export const TAXONOMY_MAPPING: TaxonomyMappingEntry[] = [
  // Aktiva — Anlagevermögen
  {
    taxonomyId: "de-gaap-ci_bs.ass.fixAss",
    label: "Anlagevermögen",
    accountRange: [0, 199],
    section: "aktiva",
  },
  {
    taxonomyId: "de-gaap-ci_bs.ass.fixAss.intan",
    label: "Immaterielle Vermögensgegenstände",
    accountRange: [0, 49],
    section: "aktiva",
  },
  {
    taxonomyId: "de-gaap-ci_bs.ass.fixAss.tan",
    label: "Sachanlagen",
    accountRange: [50, 99],
    section: "aktiva",
  },
  {
    taxonomyId: "de-gaap-ci_bs.ass.fixAss.fin",
    label: "Finanzanlagen",
    accountRange: [100, 199],
    section: "aktiva",
  },
  // Aktiva — Umlaufvermögen
  {
    taxonomyId: "de-gaap-ci_bs.ass.currAss",
    label: "Umlaufvermögen",
    accountRange: [1000, 1399],
    section: "aktiva",
  },
  {
    taxonomyId: "de-gaap-ci_bs.ass.currAss.inventory",
    label: "Vorräte",
    accountRange: [1000, 1099],
    section: "aktiva",
  },
  {
    taxonomyId: "de-gaap-ci_bs.ass.currAss.worksContract",
    label: "Forderungen aus Lieferungen und Leistungen",
    accountRange: [1200, 1299],
    section: "aktiva",
  },
  {
    taxonomyId: "de-gaap-ci_bs.ass.currAss.cashOnHand",
    label: "Bankguthaben und Kassenbestand",
    accountRange: [1300, 1399],
    section: "aktiva",
  },
  // Passiva — Eigenkapital
  {
    taxonomyId: "de-gaap-ci_bs.eqLiab.equity",
    label: "Eigenkapital",
    accountRange: [2000, 2099],
    section: "passiva",
  },
  {
    taxonomyId: "de-gaap-ci_bs.eqLiab.equity.subscribed",
    label: "Gezeichnetes Kapital",
    accountRange: [2000, 2009],
    section: "passiva",
  },
  {
    taxonomyId: "de-gaap-ci_bs.eqLiab.equity.retainedEarnings",
    label: "Gewinnrücklagen",
    accountRange: [2010, 2049],
    section: "passiva",
  },
  // Passiva — Rückstellungen
  {
    taxonomyId: "de-gaap-ci_bs.eqLiab.provisions",
    label: "Rückstellungen",
    accountRange: [3000, 3099],
    section: "passiva",
  },
  // Passiva — Verbindlichkeiten
  {
    taxonomyId: "de-gaap-ci_bs.eqLiab.liab",
    label: "Verbindlichkeiten",
    accountRange: [3300, 3699],
    section: "passiva",
  },
  {
    taxonomyId: "de-gaap-ci_bs.eqLiab.liab.trade",
    label: "Verbindlichkeiten aus Lieferungen und Leistungen",
    accountRange: [3300, 3399],
    section: "passiva",
  },
  {
    taxonomyId: "de-gaap-ci_bs.eqLiab.liab.other",
    label: "Sonstige Verbindlichkeiten",
    accountRange: [3500, 3699],
    section: "passiva",
  },
  // GuV — Erträge
  {
    taxonomyId: "de-gaap-ci_is.netIncome.regular.operatingTC.grossTradingProfit.revenuReduct.worksContract",
    label: "Umsatzerlöse",
    accountRange: [4000, 4399],
    section: "guv",
  },
  {
    taxonomyId: "de-gaap-ci_is.netIncome.regular.operatingTC.otherOpIncome",
    label: "Sonstige betriebliche Erträge",
    accountRange: [4400, 4499],
    section: "guv",
  },
  // GuV — Aufwendungen
  {
    taxonomyId: "de-gaap-ci_is.netIncome.regular.operatingTC.grossTradingProfit.materialCosts",
    label: "Materialaufwand",
    accountRange: [5000, 5999],
    section: "guv",
  },
  {
    taxonomyId: "de-gaap-ci_is.netIncome.regular.operatingTC.workerCosts",
    label: "Personalkosten",
    accountRange: [6000, 6199],
    section: "guv",
  },
  {
    taxonomyId: "de-gaap-ci_is.netIncome.regular.operatingTC.workerCosts.wages",
    label: "Löhne und Gehälter",
    accountRange: [6000, 6099],
    section: "guv",
  },
  {
    taxonomyId: "de-gaap-ci_is.netIncome.regular.operatingTC.workerCosts.socialSec",
    label: "Soziale Abgaben",
    accountRange: [6100, 6199],
    section: "guv",
  },
  {
    taxonomyId: "de-gaap-ci_is.netIncome.regular.operatingTC.workerCosts.depreciation",
    label: "Abschreibungen",
    accountRange: [6200, 6299],
    section: "guv",
  },
  {
    taxonomyId: "de-gaap-ci_is.netIncome.regular.operatingTC.otherOpExpenses",
    label: "Sonstige betriebliche Aufwendungen",
    accountRange: [6300, 6999],
    section: "guv",
  },
  {
    taxonomyId: "de-gaap-ci_is.netIncome.regular.financialResult.otherInterest.expenses",
    label: "Zinsaufwendungen",
    accountRange: [7300, 7399],
    section: "guv",
  },
  {
    taxonomyId: "de-gaap-ci_is.netIncome.regular.financialResult.otherInterest.income",
    label: "Zinserträge",
    accountRange: [7100, 7199],
    section: "guv",
  },
  {
    taxonomyId: "de-gaap-ci_is.netIncome.tax",
    label: "Steuern vom Einkommen und Ertrag",
    accountRange: [7600, 7699],
    section: "guv",
  },
]

// ─── E-Bilanz Data Generation ────────────────────────────────────────

function getAccountCodeAsNumber(categoryCode: string): number | null {
  const match = categoryCode.match(/^(\d+)/)
  if (!match) return null
  return parseInt(match[1], 10)
}

function isInRange(accountNum: number, range: [number, number]): boolean {
  return accountNum >= range[0] && accountNum <= range[1]
}

export async function generateEBilanzData(
  userId: string,
  fiscalYear: number,
): Promise<EBilanzReport> {
  const profile = await prisma.companyProfile.findUnique({
    where: { userId },
  })

  const companyName = profile?.companyName ?? "Unbekanntes Unternehmen"
  const taxNumber = profile?.taxNumber ?? ""

  // Determine fiscal year range
  const fiscalYearStart = profile?.fiscalYearStart ?? "01-01"
  const [startMonth, startDay] = fiscalYearStart.split("-").map(Number)
  const fiscalYearFrom = new Date(fiscalYear, (startMonth || 1) - 1, startDay || 1)
  const fiscalYearTo = new Date(fiscalYear + 1, (startMonth || 1) - 1, (startDay || 1) - 1)
  // If fiscal year start is 01-01, end is 12-31 of the same year
  if (startMonth === 1 && startDay === 1) {
    fiscalYearTo.setFullYear(fiscalYear)
    fiscalYearTo.setMonth(11)
    fiscalYearTo.setDate(31)
  }

  // Fetch all transactions for the fiscal year
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      issuedAt: {
        gte: fiscalYearFrom,
        lte: fiscalYearTo,
      },
    },
    include: { category: true },
  })

  // Aggregate by taxonomy position
  const aggregated = new Map<string, number>()

  for (const tx of transactions) {
    const code = tx.categoryCode
    if (!code) continue

    const accountNum = getAccountCodeAsNumber(code)
    if (accountNum === null) continue

    const amount = tx.total ?? 0

    for (const mapping of TAXONOMY_MAPPING) {
      if (isInRange(accountNum, mapping.accountRange)) {
        const current = aggregated.get(mapping.taxonomyId) ?? 0
        aggregated.set(mapping.taxonomyId, current + amount)
      }
    }
  }

  // Build positions
  const balanceSheet: EBilanzPosition[] = []
  const incomeStatement: EBilanzPosition[] = []

  for (const mapping of TAXONOMY_MAPPING) {
    const value = aggregated.get(mapping.taxonomyId) ?? 0
    const position: EBilanzPosition = {
      taxonomyId: mapping.taxonomyId,
      label: mapping.label,
      value,
    }

    if (mapping.section === "aktiva" || mapping.section === "passiva") {
      balanceSheet.push(position)
    } else {
      incomeStatement.push(position)
    }
  }

  return {
    companyName,
    taxNumber,
    fiscalYearFrom,
    fiscalYearTo,
    balanceSheet,
    incomeStatement,
  }
}

// ─── XBRL Document Generation ────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function generateXBRLDocument(report: EBilanzReport): string {
  const periodStart = formatDate(report.fiscalYearFrom)
  const periodEnd = formatDate(report.fiscalYearTo)
  const entityId = escapeXml(report.taxNumber || "UNKNOWN")

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl
  xmlns:xbrli="http://www.xbrl.org/2003/instance"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:link="http://www.xbrl.org/2003/linkbase"
  xmlns:de-gaap-ci="http://www.xbrl.de/taxonomies/de-gaap-ci"
  xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

  <!-- Schema Reference -->
  <link:schemaRef
    xlink:type="simple"
    xlink:href="http://www.xbrl.de/taxonomies/de-gaap-ci-2023-09-01/de-gaap-ci-2023-09-01-shell-fiscal.xsd" />

  <!-- Context: Fiscal Year Period -->
  <xbrli:context id="FiscalYear">
    <xbrli:entity>
      <xbrli:identifier scheme="http://www.bundesfinanzministerium.de/steuernummer">${entityId}</xbrli:identifier>
    </xbrli:entity>
    <xbrli:period>
      <xbrli:startDate>${periodStart}</xbrli:startDate>
      <xbrli:endDate>${periodEnd}</xbrli:endDate>
    </xbrli:period>
  </xbrli:context>

  <!-- Context: Instant (Balance Sheet Date) -->
  <xbrli:context id="BalanceSheetDate">
    <xbrli:entity>
      <xbrli:identifier scheme="http://www.bundesfinanzministerium.de/steuernummer">${entityId}</xbrli:identifier>
    </xbrli:entity>
    <xbrli:period>
      <xbrli:instant>${periodEnd}</xbrli:instant>
    </xbrli:period>
  </xbrli:context>

  <!-- Unit: EUR -->
  <xbrli:unit id="EUR">
    <xbrli:measure>iso4217:EUR</xbrli:measure>
  </xbrli:unit>

  <!-- Company Name -->
  <de-gaap-ci:genInfo.company.id.name contextRef="FiscalYear">${escapeXml(report.companyName)}</de-gaap-ci:genInfo.company.id.name>

  <!-- Tax Number -->
  <de-gaap-ci:genInfo.company.id.taxNumber contextRef="FiscalYear">${entityId}</de-gaap-ci:genInfo.company.id.taxNumber>

  <!-- Balance Sheet Facts -->
`

  for (const pos of report.balanceSheet) {
    const tag = pos.taxonomyId.replace(/^de-gaap-ci_/, "")
    xml += `  <de-gaap-ci:${tag} contextRef="BalanceSheetDate" unitRef="EUR" decimals="2">${formatCents(pos.value)}</de-gaap-ci:${tag}>\n`
  }

  xml += `
  <!-- Income Statement Facts -->
`

  for (const pos of report.incomeStatement) {
    const tag = pos.taxonomyId.replace(/^de-gaap-ci_/, "")
    xml += `  <de-gaap-ci:${tag} contextRef="FiscalYear" unitRef="EUR" decimals="2">${formatCents(pos.value)}</de-gaap-ci:${tag}>\n`
  }

  xml += `
</xbrli:xbrl>`

  return xml
}
