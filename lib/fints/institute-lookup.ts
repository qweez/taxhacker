import institutes from "fints-institute-db"

type Institute = {
  blz: string
  bic: string
  name: string
  pinTanURL: string | null
  [key: string]: unknown
}

export function lookupFinTSInstitute(blz: string): { bankName: string; fintsUrl: string; bic: string } | null {
  const match = (institutes as Institute[]).find(
    (inst) => inst.blz === blz && inst.pinTanURL,
  )
  if (!match) {
    // Fall back to any match even without pinTanURL
    const fallback = (institutes as Institute[]).find((inst) => inst.blz === blz)
    if (!fallback) return null
    return {
      bankName: fallback.name,
      fintsUrl: fallback.pinTanURL || "",
      bic: fallback.bic,
    }
  }
  return {
    bankName: match.name,
    fintsUrl: match.pinTanURL!,
    bic: match.bic,
  }
}
