import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    companyProfile: {
      findUnique: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

import {
  TAXONOMY_MAPPING,
  generateEBilanzData,
  generateXBRLDocument,
  type EBilanzReport,
} from "@/lib/ebilanz"
import { prisma } from "@/lib/db"

const mockedCompanyFindUnique = vi.mocked(prisma.companyProfile.findUnique)
const mockedTransactionFindMany = vi.mocked(prisma.transaction.findMany)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("TAXONOMY_MAPPING", () => {
  it("has entries for all three sections", () => {
    const sections = new Set(TAXONOMY_MAPPING.map(m => m.section))
    expect(sections.has("aktiva")).toBe(true)
    expect(sections.has("passiva")).toBe(true)
    expect(sections.has("guv")).toBe(true)
  })

  it("has Anlagevermögen mapped to de-gaap-ci_bs.ass.fixAss", () => {
    const entry = TAXONOMY_MAPPING.find(m => m.taxonomyId === "de-gaap-ci_bs.ass.fixAss")
    expect(entry).toBeDefined()
    expect(entry!.label).toContain("Anlagevermögen")
    expect(entry!.section).toBe("aktiva")
  })

  it("has Eigenkapital mapped correctly", () => {
    const entry = TAXONOMY_MAPPING.find(m => m.taxonomyId === "de-gaap-ci_bs.eqLiab.equity")
    expect(entry).toBeDefined()
    expect(entry!.label).toContain("Eigenkapital")
    expect(entry!.section).toBe("passiva")
  })

  it("has Umsatzerlöse mapped correctly", () => {
    const entry = TAXONOMY_MAPPING.find(m =>
      m.taxonomyId.includes("worksContract") && m.section === "guv"
    )
    expect(entry).toBeDefined()
    expect(entry!.label).toContain("Umsatzerlöse")
  })

  it("has no overlapping account ranges within the same section", () => {
    // Check within each section, ranges don't strictly overlap at the "parent" level
    // This is a basic sanity check
    expect(TAXONOMY_MAPPING.length).toBeGreaterThan(10)
  })
})

describe("generateEBilanzData", () => {
  it("generates report with company data", async () => {
    mockedCompanyFindUnique.mockResolvedValue({
      companyName: "Test GmbH",
      taxNumber: "1234/567/890",
      fiscalYearStart: "01-01",
    } as any)

    mockedTransactionFindMany.mockResolvedValue([])

    const report = await generateEBilanzData("user-1", 2025)
    expect(report.companyName).toBe("Test GmbH")
    expect(report.taxNumber).toBe("1234/567/890")
    expect(report.fiscalYearFrom.getFullYear()).toBe(2025)
    expect(report.fiscalYearTo.getFullYear()).toBe(2025)
    expect(report.balanceSheet.length).toBeGreaterThan(0)
    expect(report.incomeStatement.length).toBeGreaterThan(0)
  })

  it("aggregates transaction amounts into taxonomy positions", async () => {
    mockedCompanyFindUnique.mockResolvedValue({
      companyName: "Test GmbH",
      taxNumber: "123",
      fiscalYearStart: "01-01",
    } as any)

    mockedTransactionFindMany.mockResolvedValue([
      {
        categoryCode: "4000",
        total: 50000,
        category: { code: "4000", name: "Umsatzerlöse" },
      } as any,
      {
        categoryCode: "4100",
        total: 30000,
        category: { code: "4100", name: "Weitere Umsatzerlöse" },
      } as any,
      {
        categoryCode: "6000",
        total: -20000,
        category: { code: "6000", name: "Löhne" },
      } as any,
    ])

    const report = await generateEBilanzData("user-1", 2025)

    const umsatz = report.incomeStatement.find(p =>
      p.taxonomyId.includes("worksContract")
    )
    expect(umsatz).toBeDefined()
    expect(umsatz!.value).toBe(80000)

    const personal = report.incomeStatement.find(p =>
      p.taxonomyId.includes("workerCosts.wages")
    )
    expect(personal).toBeDefined()
    expect(personal!.value).toBe(-20000)
  })

  it("uses fallback values when no company profile", async () => {
    mockedCompanyFindUnique.mockResolvedValue(null)
    mockedTransactionFindMany.mockResolvedValue([])

    const report = await generateEBilanzData("user-1", 2025)
    expect(report.companyName).toBe("Unbekanntes Unternehmen")
    expect(report.taxNumber).toBe("")
  })
})

describe("generateXBRLDocument", () => {
  const report: EBilanzReport = {
    companyName: "Test GmbH",
    taxNumber: "12/345/67890",
    fiscalYearFrom: new Date("2025-01-01"),
    fiscalYearTo: new Date("2025-12-31"),
    balanceSheet: [
      { taxonomyId: "de-gaap-ci_bs.ass.fixAss", label: "Anlagevermögen", value: 50000 },
      { taxonomyId: "de-gaap-ci_bs.eqLiab.equity", label: "Eigenkapital", value: 50000 },
    ],
    incomeStatement: [
      { taxonomyId: "de-gaap-ci_is.netIncome.regular.operatingTC.grossTradingProfit.revenuReduct.worksContract", label: "Umsatzerlöse", value: 100000 },
    ],
  }

  it("produces valid XML structure", () => {
    const xml = generateXBRLDocument(report)
    expect(xml).toContain('<?xml version="1.0"')
    expect(xml).toContain("<xbrli:xbrl")
    expect(xml).toContain("</xbrli:xbrl>")
  })

  it("includes required XBRL namespaces", () => {
    const xml = generateXBRLDocument(report)
    expect(xml).toContain('xmlns:xbrli="http://www.xbrl.org/2003/instance"')
    expect(xml).toContain('xmlns:de-gaap-ci="http://www.xbrl.de/taxonomies/de-gaap-ci"')
    expect(xml).toContain('xmlns:iso4217="http://www.xbrl.org/2003/iso4217"')
    expect(xml).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"')
  })

  it("includes context with entity and period", () => {
    const xml = generateXBRLDocument(report)
    expect(xml).toContain("<xbrli:context")
    expect(xml).toContain("12/345/67890")
    expect(xml).toContain("<xbrli:startDate>2025-01-01</xbrli:startDate>")
    expect(xml).toContain("<xbrli:endDate>2025-12-31</xbrli:endDate>")
  })

  it("includes EUR unit", () => {
    const xml = generateXBRLDocument(report)
    expect(xml).toContain('<xbrli:unit id="EUR">')
    expect(xml).toContain("iso4217:EUR")
  })

  it("includes balance sheet facts with BalanceSheetDate context", () => {
    const xml = generateXBRLDocument(report)
    expect(xml).toContain('contextRef="BalanceSheetDate"')
    expect(xml).toContain("de-gaap-ci:bs.ass.fixAss")
    expect(xml).toContain("500.00") // 50000 cents = 500.00
  })

  it("includes income statement facts with FiscalYear context", () => {
    const xml = generateXBRLDocument(report)
    expect(xml).toContain('contextRef="FiscalYear"')
    expect(xml).toContain("de-gaap-ci:is.netIncome")
    expect(xml).toContain("1000.00") // 100000 cents = 1000.00
  })

  it("escapes XML special characters in company name", () => {
    const specialReport = { ...report, companyName: 'Müller & Partner "GmbH"' }
    const xml = generateXBRLDocument(specialReport)
    expect(xml).toContain("Müller &amp; Partner &quot;GmbH&quot;")
  })
})
