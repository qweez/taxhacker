/**
 * Anlagenbuchhaltung (Asset/Fixed Asset Accounting)
 * AfA-Berechnung nach deutschem Steuerrecht (EStG §7)
 */

import { prisma } from "@/lib/db"

export type DepreciationMethod = "linear" | "degressive" | "gwg" | "sammelposten"

export type Asset = {
  id: string
  name: string
  acquisitionDate: Date
  acquisitionCost: number      // in Cent
  usefulLifeYears: number
  depreciationMethod: DepreciationMethod
  residualValue: number        // in Cent
  category: string
  inventoryNumber?: string
}

export type DepreciationScheduleEntry = {
  year: number
  startValue: number           // Buchwert Jahresanfang in Cent
  depreciation: number         // AfA-Betrag in Cent
  endValue: number             // Buchwert Jahresende in Cent
  accumulatedDepreciation: number
}

export type AssetRegisterEntry = {
  id: string
  name: string
  inventoryNumber: string | null
  category: string
  acquisitionDate: string
  acquisitionCost: number
  usefulLifeYears: number
  depreciationMethod: string
  accumulatedDepreciation: number
  bookValue: number
  isActive: boolean
}

export type AssetRegister = {
  entries: AssetRegisterEntry[]
  totalAcquisitionCost: number
  totalAccumulatedDepreciation: number
  totalBookValue: number
  byCategory: Record<string, {
    count: number
    acquisitionCost: number
    accumulatedDepreciation: number
    bookValue: number
  }>
}

/**
 * Offizielle AfA-Tabelle — Gängige Nutzungsdauern (Jahre)
 * Quelle: BMF AfA-Tabelle für allgemein verwendbare Anlagegüter
 */
export const AfATable: Record<string, number> = {
  bueromoebel: 13,
  computer: 3,
  software: 3,
  drucker: 3,
  monitor: 3,
  server: 3,
  telefon: 8,
  mobiltelefon: 5,
  pkw: 6,
  lkw: 9,
  fahrrad: 7,
  ebikefahrrad: 7,
  gebaeude_wohn: 50,
  gebaeude_gewerbe: 33,
  gebaeude: 33,
  klimaanlage: 15,
  heizung: 15,
  aufzug: 15,
  kuecheneinrichtung: 10,
  werkzeug: 5,
  maschinen: 10,
  einbaukueche: 10,
  teppich: 8,
  tresor: 23,
  regal: 13,
  kopierer: 7,
  faxgeraet: 6,
  beamer: 7,
  kamera: 7,
  alarmanlage: 11,
  markise: 10,
  zaun: 17,
  parkplatz: 10,
  photovoltaik: 20,
}

/**
 * Nutzungsdauer aus der AfA-Tabelle ermitteln
 */
export function getUsefulLife(assetCategory: string): number | null {
  const normalized = assetCategory.toLowerCase().replace(/[^a-z0-9]/g, "")
  return AfATable[normalized] ?? null
}

/**
 * Prüfe ob ein Wirtschaftsgut ein GWG ist (geringwertiges Wirtschaftsgut)
 * GWG: Netto-AHK ≤ 800 EUR → Sofortabschreibung im Jahr der Anschaffung
 * (seit 2018, §6 Abs. 2 EStG)
 */
export function isGWG(amountCents: number): boolean {
  return amountCents <= 80000 // 800,00 EUR in Cent
}

/**
 * Prüfe ob ein Wirtschaftsgut in den Sammelposten fällt
 * Sammelposten: 250,01 EUR - 800,00 EUR (optional, §6 Abs. 2a EStG)
 * Wird über 5 Jahre linear abgeschrieben (unabhängig von tatsächlicher Nutzungsdauer)
 */
export function isSammelposten(amountCents: number): boolean {
  return amountCents > 25001 && amountCents <= 80000
}

/**
 * Lineare AfA berechnen (§7 Abs. 1 EStG)
 * Gleichmäßige Verteilung der Anschaffungskosten über die Nutzungsdauer
 */
export function calculateLinearDepreciation(asset: Asset, year: number): number {
  const acquisitionYear = asset.acquisitionDate.getFullYear()
  const acquisitionMonth = asset.acquisitionDate.getMonth() + 1

  // GWG: Sofortabschreibung im Anschaffungsjahr
  if (asset.depreciationMethod === "gwg") {
    if (year === acquisitionYear) {
      return asset.acquisitionCost - asset.residualValue
    }
    return 0
  }

  // Sammelposten: 5 Jahre linear, unabhängig vom Anschaffungsmonat
  if (asset.depreciationMethod === "sammelposten") {
    const endYear = acquisitionYear + 4
    if (year < acquisitionYear || year > endYear) return 0
    return Math.round((asset.acquisitionCost - asset.residualValue) / 5)
  }

  const endYear = acquisitionYear + asset.usefulLifeYears - 1
  if (year < acquisitionYear || year > endYear) return 0

  const depreciableAmount = asset.acquisitionCost - asset.residualValue
  const yearlyAmount = Math.round(depreciableAmount / asset.usefulLifeYears)

  // Im Anschaffungsjahr: zeitanteilige AfA (monatsgenau)
  if (year === acquisitionYear) {
    const remainingMonths = 12 - acquisitionMonth + 1
    return Math.round(yearlyAmount * remainingMonths / 12)
  }

  // Im letzten Jahr: Restbetrag
  if (year === endYear) {
    let accumulated = 0
    for (let y = acquisitionYear; y < endYear; y++) {
      accumulated += calculateLinearDepreciation(asset, y)
    }
    const remaining = depreciableAmount - accumulated
    return Math.max(0, remaining)
  }

  return yearlyAmount
}

/**
 * Degressive AfA berechnen (§7 Abs. 2 EStG)
 * Fester Prozentsatz vom Restbuchwert
 * Maximal 25% und maximal das 2,5-fache des linearen Satzes
 * Wechsel zur linearen AfA wenn diese günstiger ist
 */
export function calculateDegressiveDepreciation(asset: Asset, year: number, rate?: number): number {
  const acquisitionYear = asset.acquisitionDate.getFullYear()
  const acquisitionMonth = asset.acquisitionDate.getMonth() + 1

  if (year < acquisitionYear) return 0

  // Degressiver Satz bestimmen (max. 25%, max. 2.5x linear)
  const linearRate = 100 / asset.usefulLifeYears
  const maxDegressiveRate = Math.min(25, linearRate * 2.5)
  const degressiveRate = rate ? Math.min(rate, maxDegressiveRate) : maxDegressiveRate

  const depreciableAmount = asset.acquisitionCost - asset.residualValue

  // Buchwert am Anfang des Jahres berechnen
  let bookValue = asset.acquisitionCost
  for (let y = acquisitionYear; y < year; y++) {
    bookValue -= calculateDegressiveDepreciation(asset, y, rate)
    if (bookValue <= asset.residualValue) return 0
  }

  if (bookValue <= asset.residualValue) return 0

  // Degressive AfA: Prozentsatz vom Buchwert
  let degressiveAmount = Math.round(bookValue * degressiveRate / 100)

  // Im Anschaffungsjahr: zeitanteilig
  if (year === acquisitionYear) {
    const remainingMonths = 12 - acquisitionMonth + 1
    degressiveAmount = Math.round(degressiveAmount * remainingMonths / 12)
  }

  // Lineare AfA für Vergleich (Restbuchwert / Restjahre)
  const elapsedYears = year - acquisitionYear
  const remainingYears = Math.max(1, asset.usefulLifeYears - elapsedYears)
  const linearAmount = Math.round((bookValue - asset.residualValue) / remainingYears)

  // Wechsel zur linearen AfA wenn günstiger
  const actualAmount = Math.max(degressiveAmount, linearAmount)

  // Nicht unter Restwert abschreiben
  return Math.min(actualAmount, bookValue - asset.residualValue)
}

/**
 * Vollständigen AfA-Plan erstellen
 */
export function generateDepreciationSchedule(asset: Asset): DepreciationScheduleEntry[] {
  const schedule: DepreciationScheduleEntry[] = []
  const acquisitionYear = asset.acquisitionDate.getFullYear()

  let bookValue = asset.acquisitionCost
  let accumulatedDep = 0

  // Maximale Laufzeit bestimmen
  const maxYears = asset.depreciationMethod === "gwg"
    ? 1
    : asset.depreciationMethod === "sammelposten"
      ? 5
      : asset.usefulLifeYears + 1 // +1 für zeitanteilige Abschreibung im ersten Jahr

  for (let i = 0; i < maxYears; i++) {
    const year = acquisitionYear + i

    let depreciation: number
    if (asset.depreciationMethod === "degressive") {
      depreciation = calculateDegressiveDepreciation(asset, year)
    } else {
      depreciation = calculateLinearDepreciation(asset, year)
    }

    if (depreciation <= 0 && i > 0) break

    const startValue = bookValue
    bookValue = Math.max(asset.residualValue, bookValue - depreciation)
    accumulatedDep += depreciation

    schedule.push({
      year,
      startValue,
      depreciation,
      endValue: bookValue,
      accumulatedDepreciation: accumulatedDep,
    })

    if (bookValue <= asset.residualValue) break
  }

  return schedule
}

/**
 * Anlagenspiegel/Anlageverzeichnis generieren
 */
export async function generateAssetRegister(userId: string): Promise<AssetRegister> {
  const assets = await prisma.fixedAsset.findMany({
    where: { userId },
    orderBy: [{ category: "asc" }, { acquisitionDate: "asc" }],
  })

  const currentYear = new Date().getFullYear()
  const entries: AssetRegisterEntry[] = []
  let totalAcquisitionCost = 0
  let totalAccumulatedDepreciation = 0
  let totalBookValue = 0
  const byCategory: AssetRegister["byCategory"] = {}

  for (const dbAsset of assets) {
    const asset: Asset = {
      id: dbAsset.id,
      name: dbAsset.name,
      acquisitionDate: dbAsset.acquisitionDate,
      acquisitionCost: dbAsset.acquisitionCost,
      usefulLifeYears: dbAsset.usefulLifeYears,
      depreciationMethod: dbAsset.depreciationMethod as DepreciationMethod,
      residualValue: dbAsset.residualValue,
      category: dbAsset.category,
      inventoryNumber: dbAsset.inventoryNumber ?? undefined,
    }

    const schedule = generateDepreciationSchedule(asset)

    // Kumulierte AfA bis zum aktuellen Jahr
    let accumulated = 0
    for (const entry of schedule) {
      if (entry.year <= currentYear) {
        accumulated = entry.accumulatedDepreciation
      }
    }

    // Bei veräußerten/ausgeschiedenen Anlagen: volle Abschreibung
    if (dbAsset.disposalDate && dbAsset.disposalDate <= new Date()) {
      accumulated = asset.acquisitionCost - asset.residualValue
    }

    const bookValue = asset.acquisitionCost - accumulated

    entries.push({
      id: dbAsset.id,
      name: dbAsset.name,
      inventoryNumber: dbAsset.inventoryNumber,
      category: dbAsset.category,
      acquisitionDate: dbAsset.acquisitionDate.toISOString().split("T")[0],
      acquisitionCost: asset.acquisitionCost,
      usefulLifeYears: asset.usefulLifeYears,
      depreciationMethod: asset.depreciationMethod,
      accumulatedDepreciation: accumulated,
      bookValue,
      isActive: dbAsset.isActive,
    })

    totalAcquisitionCost += asset.acquisitionCost
    totalAccumulatedDepreciation += accumulated
    totalBookValue += bookValue

    // Kategorie-Gruppierung
    if (!byCategory[dbAsset.category]) {
      byCategory[dbAsset.category] = {
        count: 0,
        acquisitionCost: 0,
        accumulatedDepreciation: 0,
        bookValue: 0,
      }
    }
    byCategory[dbAsset.category].count++
    byCategory[dbAsset.category].acquisitionCost += asset.acquisitionCost
    byCategory[dbAsset.category].accumulatedDepreciation += accumulated
    byCategory[dbAsset.category].bookValue += bookValue
  }

  return {
    entries,
    totalAcquisitionCost,
    totalAccumulatedDepreciation,
    totalBookValue,
    byCategory,
  }
}
