import { describe, it, expect } from "vitest"
import {
  GERMAN_MERCHANT_RULES,
  matchRuleBasedCategory,
} from "@/lib/fints/categorize-rules"

// Build a set of all category codes present in the rules, so every rule can match.
const ALL_CATEGORY_CODES = new Set(GERMAN_MERCHANT_RULES.map((r) => r.categoryCode))

function makeTx(name: string, merchant: string | null = null, description: string | null = null) {
  return { name, merchant, description }
}

// ---------------------------------------------------------------------------
// Individual merchant pattern tests
// ---------------------------------------------------------------------------
describe("GERMAN_MERCHANT_RULES", () => {
  it("REWE matches food", () => {
    const result = matchRuleBasedCategory(makeTx("REWE Markt"), ALL_CATEGORY_CODES)
    expect(result).toBe("food")
  })

  it("EDEKA matches food", () => {
    const result = matchRuleBasedCategory(makeTx("EDEKA Filiale"), ALL_CATEGORY_CODES)
    expect(result).toBe("food")
  })

  it("TELEKOM matches telecom", () => {
    const result = matchRuleBasedCategory(makeTx("TELEKOM Rechnung"), ALL_CATEGORY_CODES)
    expect(result).toBe("telecom")
  })

  it("VODAFONE matches telecom", () => {
    const result = matchRuleBasedCategory(makeTx("Vodafone GmbH"), ALL_CATEGORY_CODES)
    expect(result).toBe("telecom")
  })

  it("MIETE matches rent", () => {
    const result = matchRuleBasedCategory(makeTx("MIETE Jan 2024"), ALL_CATEGORY_CODES)
    expect(result).toBe("rent")
  })

  it("FINANZAMT matches tax", () => {
    const result = matchRuleBasedCategory(makeTx("FINANZAMT Berlin"), ALL_CATEGORY_CODES)
    expect(result).toBe("tax")
  })

  it("STEUER matches tax", () => {
    const result = matchRuleBasedCategory(makeTx("Steuerberater Meier"), ALL_CATEGORY_CODES)
    expect(result).toBe("tax")
  })

  it("GITHUB matches software", () => {
    const result = matchRuleBasedCategory(makeTx("GITHUB Subscription"), ALL_CATEGORY_CODES)
    expect(result).toBe("software")
  })

  it("HETZNER matches software", () => {
    const result = matchRuleBasedCategory(makeTx("Hetzner Cloud"), ALL_CATEGORY_CODES)
    expect(result).toBe("software")
  })

  it("AMAZON matches office", () => {
    const result = matchRuleBasedCategory(makeTx("AMAZON EU"), ALL_CATEGORY_CODES)
    expect(result).toBe("office")
  })

  it("ARAL matches vehicle", () => {
    const result = matchRuleBasedCategory(makeTx("ARAL Tankstelle"), ALL_CATEGORY_CODES)
    expect(result).toBe("vehicle")
  })

  it("ALLIANZ matches insurance", () => {
    const result = matchRuleBasedCategory(makeTx("ALLIANZ Versicherung"), ALL_CATEGORY_CODES)
    expect(result).toBe("insurance")
  })

  it("DB matches travel", () => {
    const result = matchRuleBasedCategory(makeTx("DB Fernverkehr"), ALL_CATEGORY_CODES)
    expect(result).toBe("travel")
  })
})

// ---------------------------------------------------------------------------
// Case-insensitive matching
// ---------------------------------------------------------------------------
describe("case-insensitive matching", () => {
  it("matches lowercase input", () => {
    const result = matchRuleBasedCategory(makeTx("rewe markt"), ALL_CATEGORY_CODES)
    expect(result).toBe("food")
  })

  it("matches mixed case input", () => {
    const result = matchRuleBasedCategory(makeTx("Telekom Mobilfunk"), ALL_CATEGORY_CODES)
    expect(result).toBe("telecom")
  })

  it("matches via merchant field", () => {
    const result = matchRuleBasedCategory(makeTx("Kartenzahlung", "LIDL"), ALL_CATEGORY_CODES)
    expect(result).toBe("food")
  })

  it("matches via description field", () => {
    const result = matchRuleBasedCategory(makeTx("Lastschrift", null, "MIETE Wohnung"), ALL_CATEGORY_CODES)
    expect(result).toBe("rent")
  })
})

// ---------------------------------------------------------------------------
// Unknown merchant / no match
// ---------------------------------------------------------------------------
describe("unknown merchant", () => {
  it("returns null for unknown merchant", () => {
    const result = matchRuleBasedCategory(makeTx("Random Shop XYZ"), ALL_CATEGORY_CODES)
    expect(result).toBeNull()
  })

  it("returns null for empty name", () => {
    const result = matchRuleBasedCategory(makeTx(""), ALL_CATEGORY_CODES)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Validation against available categories
// ---------------------------------------------------------------------------
describe("matchRuleBasedCategory validates against available categories", () => {
  it("returns null when matched category is not in valid set", () => {
    // Only allow "telecom" -- REWE would match "food" but food is not valid
    const limitedCodes = new Set(["telecom"])
    const result = matchRuleBasedCategory(makeTx("REWE Markt"), limitedCodes)
    expect(result).toBeNull()
  })

  it("returns the category when it is in the valid set", () => {
    const limitedCodes = new Set(["food"])
    const result = matchRuleBasedCategory(makeTx("REWE Markt"), limitedCodes)
    expect(result).toBe("food")
  })

  it("returns null with empty valid set", () => {
    const result = matchRuleBasedCategory(makeTx("REWE Markt"), new Set())
    expect(result).toBeNull()
  })
})
