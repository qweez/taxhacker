import { describe, it, expect } from "vitest"
import { calculateInvoiceTotals, type InvoiceData } from "@/lib/invoice-generator"

function makeItem(
  overrides: Partial<InvoiceData["items"][number]> = {},
): InvoiceData["items"][number] {
  return {
    position: 1,
    description: "Test item",
    quantity: 1,
    unit: "Stück",
    unitPrice: 10000, // 100.00 EUR in cents
    taxRate: 19,
    ...overrides,
  }
}

describe("calculateInvoiceTotals", () => {
  it("calculates totals with 19% tax items", () => {
    const items = [makeItem({ unitPrice: 10000, taxRate: 19 })]
    const result = calculateInvoiceTotals(items)

    expect(result.netTotal).toBe(10000)
    expect(result.taxBreakdown).toHaveLength(1)
    expect(result.taxBreakdown[0].rate).toBe(19)
    expect(result.taxBreakdown[0].net).toBe(10000)
    expect(result.taxBreakdown[0].tax).toBe(1900)
    expect(result.grossTotal).toBe(11900)
  })

  it("calculates totals with mixed 19% and 7% items", () => {
    const items = [
      makeItem({ position: 1, unitPrice: 10000, taxRate: 19 }),
      makeItem({ position: 2, unitPrice: 5000, taxRate: 7 }),
    ]
    const result = calculateInvoiceTotals(items)

    expect(result.netTotal).toBe(15000)
    expect(result.taxBreakdown).toHaveLength(2)

    // Sorted by rate descending: 19% first, then 7%
    const tax19 = result.taxBreakdown.find((t) => t.rate === 19)!
    const tax7 = result.taxBreakdown.find((t) => t.rate === 7)!

    expect(tax19.net).toBe(10000)
    expect(tax19.tax).toBe(1900)
    expect(tax7.net).toBe(5000)
    expect(tax7.tax).toBe(350)

    expect(result.grossTotal).toBe(15000 + 1900 + 350)
  })

  it("calculates totals with 0% tax items (exempt)", () => {
    const items = [makeItem({ unitPrice: 20000, taxRate: 0 })]
    const result = calculateInvoiceTotals(items)

    expect(result.netTotal).toBe(20000)
    expect(result.taxBreakdown).toHaveLength(1)
    expect(result.taxBreakdown[0].rate).toBe(0)
    expect(result.taxBreakdown[0].tax).toBe(0)
    expect(result.grossTotal).toBe(20000)
  })

  it("ensures net + tax = gross for each rate", () => {
    const items = [
      makeItem({ position: 1, unitPrice: 12345, taxRate: 19 }),
      makeItem({ position: 2, unitPrice: 6789, taxRate: 7 }),
      makeItem({ position: 3, unitPrice: 3000, taxRate: 0 }),
    ]
    const result = calculateInvoiceTotals(items)

    const totalTaxFromBreakdown = result.taxBreakdown.reduce(
      (sum, t) => sum + t.tax,
      0,
    )
    expect(result.grossTotal).toBe(result.netTotal + totalTaxFromBreakdown)

    for (const entry of result.taxBreakdown) {
      expect(entry.tax).toBe(Math.round((entry.net * entry.rate) / 100))
    }
  })

  it("sums multiple items correctly", () => {
    const items = [
      makeItem({ position: 1, quantity: 2, unitPrice: 5000, taxRate: 19 }),
      makeItem({ position: 2, quantity: 3, unitPrice: 2000, taxRate: 19 }),
    ]
    const result = calculateInvoiceTotals(items)

    // net = 2*5000 + 3*2000 = 10000 + 6000 = 16000
    expect(result.netTotal).toBe(16000)
    expect(result.taxBreakdown).toHaveLength(1)
    expect(result.taxBreakdown[0].net).toBe(16000)
    expect(result.taxBreakdown[0].tax).toBe(3040) // 16000 * 0.19 = 3040
    expect(result.grossTotal).toBe(19040)
  })

  it("handles amounts in cents precision correctly", () => {
    // 1 cent item
    const items = [makeItem({ unitPrice: 1, taxRate: 19 })]
    const result = calculateInvoiceTotals(items)

    expect(result.netTotal).toBe(1)
    // 1 * 19 / 100 = 0.19, rounds to 0
    expect(result.taxBreakdown[0].tax).toBe(Math.round((1 * 19) / 100))
    expect(result.grossTotal).toBe(1 + result.taxBreakdown[0].tax)
  })

  it("handles large cent amounts without floating point errors", () => {
    // 999.99 EUR = 99999 cents
    const items = [makeItem({ unitPrice: 99999, quantity: 100, taxRate: 19 })]
    const result = calculateInvoiceTotals(items)

    const expectedNet = 9999900
    expect(result.netTotal).toBe(expectedNet)
    expect(result.taxBreakdown[0].tax).toBe(
      Math.round((expectedNet * 19) / 100),
    )
    expect(result.grossTotal).toBe(expectedNet + result.taxBreakdown[0].tax)
  })
})
