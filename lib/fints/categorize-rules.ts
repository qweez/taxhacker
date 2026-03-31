/**
 * Rule-based categorization for common German merchants and transaction patterns.
 * Each rule maps a regex pattern to a category code.
 */
export const GERMAN_MERCHANT_RULES: { pattern: RegExp; categoryCode: string }[] = [
  { pattern: /REWE|EDEKA|ALDI|LIDL|PENNY|NETTO|KAUFLAND/i, categoryCode: "food" },
  { pattern: /TELEKOM|VODAFONE|O2|1&1|IONOS/i, categoryCode: "telecom" },
  { pattern: /MIETE|MIETVERTRAG|HAUSVERWALTUNG/i, categoryCode: "rent" },
  { pattern: /HAFTPFLICHT|VERSICHERUNG|ALLIANZ|HUK|ERGO/i, categoryCode: "insurance" },
  { pattern: /TANKSTELLE|ARAL|SHELL|TOTAL|JET\s/i, categoryCode: "vehicle" },
  { pattern: /AMAZON|OTTO|ZALANDO/i, categoryCode: "office" },
  { pattern: /FINANZAMT|STEUER/i, categoryCode: "tax" },
  { pattern: /GOOGLE|MICROSOFT|APPLE|ADOBE|GITHUB|AWS|HETZNER|NETLIFY/i, categoryCode: "software" },
  { pattern: /DB\s|BAHN|FLIXBUS|UBER|TAXI|SIXT|EUROPCAR/i, categoryCode: "travel" },
  { pattern: /WERBUNG|FACEBOOK\sADS|GOOGLE\sADS/i, categoryCode: "advertising" },
]

/**
 * Try to match a transaction against the German merchant rules.
 * Checks name, merchant, and description fields.
 * Returns the category code if matched, or null.
 */
export function matchRuleBasedCategory(
  transaction: { name: string; merchant: string | null; description: string | null },
  validCategoryCodes: Set<string>,
): string | null {
  const searchText = [transaction.name, transaction.merchant, transaction.description]
    .filter(Boolean)
    .join(" ")

  for (const rule of GERMAN_MERCHANT_RULES) {
    if (rule.pattern.test(searchText) && validCategoryCodes.has(rule.categoryCode)) {
      return rule.categoryCode
    }
  }

  return null
}
