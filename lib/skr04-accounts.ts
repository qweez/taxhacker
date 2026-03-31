/**
 * SKR04 Kontenrahmen — häufig genutzte Konten.
 * Dieses Modul ist client-safe (kein Prisma/Server-Import).
 */
export const SKR04_COMMON_ACCOUNTS = [
  { code: '1800', name: 'Bank', type: 'asset' },
  { code: '1000', name: 'Kasse', type: 'asset' },
  { code: '1200', name: 'Forderungen aus LuL', type: 'asset' },
  { code: '3300', name: 'Verbindlichkeiten aus LuL', type: 'liability' },
  { code: '4400', name: 'Erlöse 19% USt', type: 'income' },
  { code: '4300', name: 'Erlöse 7% USt', type: 'income' },
  { code: '5400', name: 'Sonstige betriebliche Erträge', type: 'income' },
  { code: '5000', name: 'Aufwendungen für Waren', type: 'expense' },
  { code: '6000', name: 'Löhne und Gehälter', type: 'expense' },
  { code: '6100', name: 'Soziale Abgaben', type: 'expense' },
  { code: '6300', name: 'Miete', type: 'expense' },
  { code: '6310', name: 'Nebenkosten', type: 'expense' },
  { code: '6400', name: 'Versicherungen', type: 'expense' },
  { code: '6500', name: 'Kfz-Kosten', type: 'expense' },
  { code: '6600', name: 'Werbekosten', type: 'expense' },
  { code: '6640', name: 'Reisekosten', type: 'expense' },
  { code: '6800', name: 'Porto', type: 'expense' },
  { code: '6815', name: 'Bürobedarf', type: 'expense' },
  { code: '6820', name: 'Telekommunikation', type: 'expense' },
  { code: '6830', name: 'Rechts-/Beratungskosten', type: 'expense' },
  { code: '6850', name: 'Buchführungskosten', type: 'expense' },
  { code: '7010', name: 'AfA Sachanlagen', type: 'expense' },
  { code: '7685', name: 'Zinsaufwendungen', type: 'expense' },
  { code: '1576', name: 'Vorsteuer 19%', type: 'asset' },
  { code: '1571', name: 'Vorsteuer 7%', type: 'asset' },
  { code: '3806', name: 'USt 19%', type: 'liability' },
  { code: '3801', name: 'USt 7%', type: 'liability' },
] as const

export function isValidSKR04Account(code: string): boolean {
  return /^\d{4}$/.test(code)
}

const VALID_ACCOUNT_CODES: Set<string> = new Set(SKR04_COMMON_ACCOUNTS.map(a => a.code))

export function isCommonSKR04Account(code: string): boolean {
  return VALID_ACCOUNT_CODES.has(code)
}

/**
 * Auto-calculate tax amount from gross amount and tax rate.
 * Amount is gross (inclusive of tax). Formula: taxAmount = amount - (amount / (1 + rate/100))
 */
export function calculateTaxAmount(amountCents: number, taxRatePercent: number): number {
  if (taxRatePercent <= 0) return 0
  const net = amountCents / (1 + taxRatePercent / 100)
  return Math.round(amountCents - net)
}
