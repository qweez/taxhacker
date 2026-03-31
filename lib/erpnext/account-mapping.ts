/**
 * SKR04 ↔ ERPNext Kontenzuordnung
 * Mapping zwischen SKR04-Kontenrahmen und ERPNext German Chart of Accounts
 */

// SKR04-Kontonummer → ERPNext-Kontobezeichnung (deutscher Kontenrahmen)
export const SKR04_TO_ERPNEXT: Record<string, string> = {
  // Erlöse (Revenue)
  "4400": "Erlöse 19% USt",
  "4300": "Erlöse 7% USt",
  "4100": "Steuerfreie Erlöse",

  // Aufwandskonten (Expenses)
  "6815": "Bürobedarf",
  "6670": "Reisekosten Arbeitnehmer",
  "6650": "Reisekosten Unternehmer",
  "6830": "Sonstige betriebliche Aufwendungen",
  "6640": "Bewirtungskosten",
  "6430": "Versicherungen",
  "7680": "Sonstige Steuern",
  "6000": "Löhne und Gehälter",
  "6310": "Miete und Nebenkosten",
  "6805": "Telefon und Internet",
  "6600": "Werbekosten",
  "6520": "Kfz-Kosten",
  "6800": "Porto",
  "6821": "Fortbildungskosten",
  "6825": "Rechts- und Beratungskosten",
  "6827": "Buchführungskosten",
  "6220": "Abschreibungen auf Sachanlagen",
  "7300": "Zinsen und ähnliche Aufwendungen",
  "6855": "Nebenkosten des Geldverkehrs",
  "6610": "Geschenke abzugsfähig",
  "6470": "Reparaturen und Instandhaltung",
  "6330": "Reinigungskosten",
  "6300": "Sonstige betriebliche Aufwendungen",

  // Bank-/Kassenkonten
  "1800": "Bank",
  "1600": "Kasse",
}

// ERPNext-Kontobezeichnung → SKR04-Kontonummer (Reverse-Mapping)
export const ERPNEXT_TO_SKR04: Record<string, string> = {}

// Reverse-Map automatisch aufbauen
for (const [skr04Code, erpnextName] of Object.entries(SKR04_TO_ERPNEXT)) {
  // Bei Duplikaten (z.B. 6300 und 6830 → gleicher Name) gewinnt der spezifischere Eintrag
  if (!ERPNEXT_TO_SKR04[erpnextName]) {
    ERPNEXT_TO_SKR04[erpnextName] = skr04Code
  }
}

export type MappingDirection = "skr04_to_erpnext" | "erpnext_to_skr04"

/**
 * Kontencode in die gewünschte Richtung zuordnen
 */
export function mapAccountCode(code: string, direction: MappingDirection): string | null {
  if (direction === "skr04_to_erpnext") {
    return SKR04_TO_ERPNEXT[code] ?? null
  }
  return ERPNEXT_TO_SKR04[code] ?? null
}

/**
 * TaxHacker-Kategorie-Code → SKR04 → ERPNext Kontobezeichnung
 * Nutzt die gleichen internen Kategorie-Codes wie datev-export.ts
 */
const CATEGORY_TO_SKR04: Record<string, string> = {
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

/**
 * TaxHacker-Kategorie direkt zu ERPNext-Kontoname zuordnen
 */
export function mapCategoryToERPNext(categoryCode: string): string | null {
  const skr04Code = CATEGORY_TO_SKR04[categoryCode.toLowerCase()]
  if (!skr04Code) return null
  return SKR04_TO_ERPNEXT[skr04Code] ?? null
}

/**
 * ERPNext-Kontoname zu TaxHacker-Kategorie zuordnen
 */
export function mapERPNextToCategory(erpnextAccountName: string): string | null {
  const skr04Code = ERPNEXT_TO_SKR04[erpnextAccountName]
  if (!skr04Code) return null

  // Reverse lookup: SKR04-Code → Kategorie-Code
  for (const [category, code] of Object.entries(CATEGORY_TO_SKR04)) {
    if (code === skr04Code && !category.startsWith("default_")) {
      return category
    }
  }
  return null
}
