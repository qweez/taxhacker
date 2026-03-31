/**
 * UStVA (Umsatzsteuer-Voranmeldung) - Elster XML Generator
 * Generiert ERiC-kompatibles XML für die elektronische Abgabe der UStVA
 */

import { prisma } from "@/lib/db"

/**
 * UStVA-Daten mit allen relevanten Kennzahlen
 */
export type UStVAData = {
  // Steuerpflichtige Umsätze
  kz81: number   // Steuerpflichtige Umsätze 19% (Bemessungsgrundlage in Cent)
  kz86: number   // Steuerpflichtige Umsätze 7% (Bemessungsgrundlage in Cent)
  // Innergemeinschaftliche Erwerbe
  kz35: number   // Innergemeinschaftliche Erwerbe 19%
  kz36: number   // Innergemeinschaftliche Erwerbe 7%
  // Vorsteuer
  kz66: number   // Vorsteuer aus Rechnungen anderer Unternehmer
  kz61: number   // Vorsteuer aus innergemeinschaftlichen Erwerben
  kz62: number   // Entstandene Einfuhrumsatzsteuer
  kz67: number   // Vorsteuer aus Leistungen nach §13b UStG
  kz76: number   // Abziehbare Vorsteuerbeträge (Summe KZ 66+61+62+67)
  // Ergebnis
  kz83: number   // Verbleibende USt-Vorauszahlung (+) / Überschuss (-)
}

// Kategorien mit ermäßigtem Steuersatz (7%)
const REDUCED_RATE_CATEGORIES = new Set(["income_7", "food"])

// Steuerfreie Kategorien (0%)
const EXEMPT_CATEGORIES = new Set(["income_0", "insurance", "interest", "bank_fees", "salary", "tax"])

// EU-Erwerb Kategorien
const EU_ACQUISITION_CATEGORIES = new Set(["eu_erwerb", "eu_acquisition"])

function nettoFromBrutto(bruttoCents: number, rate: number): number {
  if (rate === 0) return bruttoCents
  return Math.round(bruttoCents / (1 + rate / 100))
}

function ustFromBrutto(bruttoCents: number, rate: number): number {
  if (rate === 0) return 0
  const netto = nettoFromBrutto(bruttoCents, rate)
  return bruttoCents - netto
}

/**
 * Ermittelt den USt-Satz für eine Kategorie
 */
function getUStRate(categoryCode: string | null): number {
  if (categoryCode) {
    const code = categoryCode.toLowerCase()
    if (EXEMPT_CATEGORIES.has(code)) return 0
    if (REDUCED_RATE_CATEGORIES.has(code)) return 7
  }
  return 19
}

/**
 * UStVA-Daten berechnen aus den Transaktionen
 */
export async function generateUStVAData(
  userId: string,
  year: number,
  monthOrQuarter: number,
  isQuarterly = false,
): Promise<UStVAData> {
  // Zeitraum bestimmen
  let startMonth: number
  let endMonth: number

  if (isQuarterly) {
    startMonth = (monthOrQuarter - 1) * 3 + 1
    endMonth = startMonth + 2
  } else {
    startMonth = monthOrQuarter
    endMonth = monthOrQuarter
  }

  const dateFrom = new Date(year, startMonth - 1, 1)
  const dateTo = new Date(year, endMonth, 0, 23, 59, 59, 999)

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      issuedAt: { gte: dateFrom, lte: dateTo },
    },
    include: { category: true },
    orderBy: { issuedAt: "asc" },
  })

  const data: UStVAData = {
    kz81: 0, kz86: 0,
    kz35: 0, kz36: 0,
    kz66: 0, kz61: 0, kz62: 0, kz67: 0,
    kz76: 0, kz83: 0,
  }

  let totalOutputTax = 0
  let totalInputTax = 0

  for (const tx of transactions) {
    if (!tx.total) continue

    const brutto = Math.abs(tx.total)
    const categoryCode = tx.categoryCode?.toLowerCase() ?? ""
    const rate = getUStRate(tx.categoryCode)
    const netto = nettoFromBrutto(brutto, rate)
    const ust = ustFromBrutto(brutto, rate)

    const isEUAcquisition = EU_ACQUISITION_CATEGORIES.has(categoryCode)

    if (tx.type === "income") {
      // Ausgangsrechnungen → USt-Bemessungsgrundlage
      if (rate === 19) {
        data.kz81 += netto
        totalOutputTax += ust
      } else if (rate === 7) {
        data.kz86 += netto
        totalOutputTax += ust
      }
      // Steuerfreie Umsätze werden in anderen KZ gemeldet (hier vereinfacht)
    } else {
      // Eingangsrechnungen → Vorsteuer
      if (isEUAcquisition) {
        if (rate === 19) {
          data.kz35 += netto
          data.kz61 += ust
          totalOutputTax += ust // igE werden auch als Ausgangs-USt gebucht
        } else if (rate === 7) {
          data.kz36 += netto
          data.kz61 += ust
          totalOutputTax += ust
        }
        totalInputTax += ust
      } else {
        // Normale Vorsteuer
        if (rate > 0) {
          data.kz66 += ust
          totalInputTax += ust
        }
      }
    }
  }

  // Abziehbare Vorsteuer (Summe)
  data.kz76 = data.kz66 + data.kz61 + data.kz62 + data.kz67

  // Verbleibende USt-Vorauszahlung
  // Positiv = Zahllast an Finanzamt, Negativ = Erstattungsanspruch
  data.kz83 = totalOutputTax - totalInputTax

  return data
}

/**
 * Steuernummer im Elster-Format (13-stellig)
 * Format: FFBBBUUUUP (FF=Bundesland, BBB=Bezirk, UUUU=Unterscheidungsnummer, P=Prüfziffer)
 */
function formatElsterSteuernummer(steuernummer: string): string {
  // Entferne alle nicht-numerischen Zeichen
  return steuernummer.replace(/[^0-9]/g, "")
}

function formatCentsAsEuro(cents: number): string {
  // Elster erwartet Beträge ohne Nachkommastellen (auf volle Euro gerundet)
  return Math.round(cents / 100).toString()
}

type ElsterPeriod = {
  year: number
  zeitraum: string // "01"-"12" für Monate, "41"-"44" für Quartale
}

/**
 * ERiC-kompatibles Elster XML generieren
 */
export function generateElsterXML(
  data: UStVAData,
  taxNumber: string,
  companyName: string,
  period: ElsterPeriod,
): string {
  const stNr = formatElsterSteuernummer(taxNumber)
  const zeitraum = period.zeitraum

  const kennzahlen: Array<{ kz: string; value: number }> = [
    { kz: "81", value: data.kz81 },
    { kz: "86", value: data.kz86 },
    { kz: "35", value: data.kz35 },
    { kz: "36", value: data.kz36 },
    { kz: "66", value: data.kz66 },
    { kz: "61", value: data.kz61 },
    { kz: "62", value: data.kz62 },
    { kz: "67", value: data.kz67 },
    { kz: "76", value: data.kz76 },
    { kz: "83", value: data.kz83 },
  ]

  // Nur Kennzahlen mit Werten einbeziehen
  const activeKZ = kennzahlen.filter(k => k.value !== 0)

  const kzXml = activeKZ
    .map(k => `          <Kz${k.kz}>${formatCentsAsEuro(k.value)}</Kz${k.kz}>`)
    .join("\n")

  const escapeXml = (str: string) => str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

  return `<?xml version="1.0" encoding="UTF-8"?>
<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">
  <TransferHeader version="11">
    <Verfahren>ElsterAnmeldung</Verfahren>
    <DatenArt>UStVA</DatenArt>
    <Vorgang>send-NoSig</Vorgang>
    <Testmerker>000000000</Testmerker>
    <HerstellerID>74931</HerstellerID>
    <DatenLieferant>${escapeXml(companyName)}</DatenLieferant>
  </TransferHeader>
  <DatenTeil>
    <Nutzdatenblock>
      <NutzdatenHeader version="11">
        <NutzdatenTicket>${Date.now()}</NutzdatenTicket>
        <Empfaenger id="F">L</Empfaenger>
      </NutzdatenHeader>
      <Nutzdaten>
        <Anmeldungssteuern art="UStVA" version="2021"
          xmlns="http://finkonsens.de/elster/elsteranmeldung/ustva/v2021">
          <DatenLieferant>
            <Name>${escapeXml(companyName)}</Name>
            <Strasse></Strasse>
            <PLZ></PLZ>
            <Ort></Ort>
          </DatenLieferant>
          <Erstellungsdatum>${new Date().toISOString().split("T")[0].replace(/-/g, "")}</Erstellungsdatum>
          <Steuerfall>
            <Umsatzsteuervoranmeldung>
              <Jahr>${period.year}</Jahr>
              <Zeitraum>${zeitraum}</Zeitraum>
              <Steuernummer>${stNr}</Steuernummer>
${kzXml}
            </Umsatzsteuervoranmeldung>
          </Steuerfall>
        </Anmeldungssteuern>
      </Nutzdaten>
    </Nutzdatenblock>
  </DatenTeil>
</Elster>`
}
