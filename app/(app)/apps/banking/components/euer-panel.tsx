"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { generateEUERAction } from "../actions"
import { Calculator, Download, Info } from "lucide-react"
import type { EUERData } from "@/lib/fints/euer-export"

function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

type EinnahmenRow = {
  kz: string
  label: string
  key: keyof EUERData["einnahmen"]
  isSummary?: boolean
}

type AusgabenRow = {
  kz: string
  label: string
  key: keyof EUERData["ausgaben"]
  isSummary?: boolean
}

const EINNAHMEN_ROWS: EinnahmenRow[] = [
  { kz: "111", label: "Betriebseinnahmen als Kleinunternehmer", key: "kz111" },
  { kz: "112", label: "Umsatzerloese 19%", key: "kz112" },
  { kz: "113", label: "Umsatzerloese 7%", key: "kz113" },
  { kz: "114", label: "Steuerfreie Umsaetze", key: "kz114" },
  { kz: "120", label: "Vereinnahmte Umsatzsteuer", key: "kz120" },
  { kz: "125", label: "Vom Finanzamt erstattete USt", key: "kz125" },
  { kz: "185", label: "Summe Betriebseinnahmen", key: "kz185", isSummary: true },
]

const AUSGABEN_ROWS: AusgabenRow[] = [
  { kz: "210", label: "Waren, Rohstoffe, Hilfsstoffe", key: "kz210" },
  { kz: "220", label: "Bezogene Fremdleistungen", key: "kz220" },
  { kz: "230", label: "Gehaelter / Loehne", key: "kz230" },
  { kz: "240", label: "Soziale Abgaben", key: "kz240" },
  { kz: "250", label: "Abschreibungen (AfA)", key: "kz250" },
  { kz: "260", label: "Raumkosten / Miete", key: "kz260" },
  { kz: "270", label: "Sonstige Grundstuecksaufwendungen", key: "kz270" },
  { kz: "280", label: "Kfz-Kosten", key: "kz280" },
  { kz: "285", label: "Reisekosten", key: "kz285" },
  { kz: "290", label: "Bewirtungskosten (70%)", key: "kz290" },
  { kz: "295", label: "Geschenke", key: "kz295" },
  { kz: "300", label: "Telefon / Internet", key: "kz300" },
  { kz: "310", label: "Porto", key: "kz310" },
  { kz: "315", label: "Buerobedarf", key: "kz315" },
  { kz: "320", label: "Rechts- und Beratungskosten", key: "kz320" },
  { kz: "325", label: "Versicherungen", key: "kz325" },
  { kz: "330", label: "Beitraege", key: "kz330" },
  { kz: "340", label: "Werbekosten", key: "kz340" },
  { kz: "345", label: "Schulungen / Fortbildung", key: "kz345" },
  { kz: "350", label: "Nebenkosten Geldverkehr", key: "kz350" },
  { kz: "355", label: "Sonstige Betriebsausgaben", key: "kz355" },
  { kz: "359", label: "Gezahlte Vorsteuer", key: "kz359" },
  { kz: "360", label: "An Finanzamt gezahlte USt", key: "kz360" },
  { kz: "399", label: "Summe Betriebsausgaben", key: "kz399", isSummary: true },
]

export default function EUERPanel() {
  const currentYear = new Date().getFullYear()

  const [year, setYear] = useState(currentYear - 1)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<EUERData | null>(null)
  const [csv, setCsv] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setData(null)
    setCsv(null)
    const result = await generateEUERAction(year)
    if (result.success && result.data) {
      setData(result.data.euer as EUERData)
      setCsv(result.data.csv)
    } else {
      setError(result.error || "Fehler beim Erstellen der EUER.")
    }
    setLoading(false)
  }

  function handleDownload() {
    if (!csv) return
    const bom = "\uFEFF"
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `Anlage_EUER_${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <CardTitle className="flex items-center gap-2 mb-2">
          <Calculator className="w-5 h-5" />
          Anlage EUER
        </CardTitle>
        <CardDescription className="mb-6">
          Einnahmenueberschussrechnung fuer Kleinunternehmer und Freiberufler.
          Berechnung der Betriebseinnahmen und -ausgaben nach Kennzahlen der Anlage EUER.
        </CardDescription>

        {/* Year selector */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div>
            <label className="text-sm font-medium block mb-1">Jahr</label>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="border rounded px-3 py-2 text-sm bg-background"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={handleGenerate} disabled={loading}>
              <Calculator className="w-4 h-4 mr-1" />
              {loading ? "Berechne..." : "Berechnen"}
            </Button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive mb-4">{error}</p>
        )}

        {data && (
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">EUER {data.year}</Badge>
              <span className="text-sm text-muted-foreground">
                01.01.{data.year} &ndash; 31.12.{data.year}
              </span>
            </div>

            {/* Betriebseinnahmen */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Betriebseinnahmen</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium w-16">KZ</th>
                      <th className="text-left py-2 pr-4 font-medium">Bezeichnung</th>
                      <th className="text-right py-2 font-medium w-32">Betrag (EUR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EINNAHMEN_ROWS.map(row => {
                      const value = data.einnahmen[row.key]
                      if (!row.isSummary && value === 0) return null
                      return (
                        <tr
                          key={row.kz}
                          className={
                            row.isSummary
                              ? "border-t-2 font-semibold"
                              : "border-b"
                          }
                        >
                          <td className="py-2 pr-4 font-mono">{row.kz}</td>
                          <td className="py-2 pr-4">{row.label}</td>
                          <td className="py-2 text-right font-mono">
                            {formatEuro(value)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Betriebsausgaben */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Betriebsausgaben</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium w-16">KZ</th>
                      <th className="text-left py-2 pr-4 font-medium">Bezeichnung</th>
                      <th className="text-right py-2 font-medium w-32">Betrag (EUR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {AUSGABEN_ROWS.map(row => {
                      const value = data.ausgaben[row.key]
                      if (!row.isSummary && value === 0) return null
                      return (
                        <tr
                          key={row.kz}
                          className={
                            row.isSummary
                              ? "border-t-2 font-semibold"
                              : "border-b"
                          }
                        >
                          <td className="py-2 pr-4 font-mono">{row.kz}</td>
                          <td className="py-2 pr-4">{row.label}</td>
                          <td className="py-2 text-right font-mono">
                            {formatEuro(value)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Gewinn / Verlust */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-t-2 border-b-2 font-bold text-base">
                    <td className="py-3 pr-4 w-16" />
                    <td className="py-3 pr-4">
                      {data.gewinnVerlust >= 0 ? "Gewinn" : "Verlust"}
                    </td>
                    <td
                      className={`py-3 text-right font-mono w-32 ${
                        data.gewinnVerlust >= 0
                          ? "text-green-600"
                          : "text-destructive"
                      }`}
                    >
                      {formatEuro(data.gewinnVerlust)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Download */}
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleDownload}>
                <Download className="w-4 h-4 mr-1" />
                CSV herunterladen
              </Button>
            </div>

            {/* Info */}
            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
              <p className="flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  Diese Uebersicht dient als Vorbereitung fuer die Anlage EUER.
                  Bitte pruefen Sie die Werte mit Ihrem Steuerberater.
                </span>
              </p>
              <p className="flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  Bewirtungskosten (KZ 290) werden automatisch mit 70% angesetzt
                  (steuerlich abzugsfaehiger Anteil).
                </span>
              </p>
              <p className="flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  Alle Betraege in Euro. Zeilen mit 0,00 EUR werden ausgeblendet.
                </span>
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
