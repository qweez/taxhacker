"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { generateBWAAction } from "../actions"
import { BarChart3, Download, Info } from "lucide-react"

function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

type BWALineItem = {
  currentMonth: number
  previousMonth: number
  ytd: number
  previousYearYtd: number
  percentOfRevenue: number
}

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
]

export default function BWAPanel() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<any>(null)
  const [csv, setCsv] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 4 + i)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setReport(null)
    const result = await generateBWAAction(year, month)
    if (result.success && result.data) {
      setReport(result.data.report)
      setCsv(result.data.csv)
      setHtml(result.data.html)
    } else {
      setError(result.error || "Fehler beim Erstellen der BWA.")
    }
    setLoading(false)
  }

  function handleDownloadCSV() {
    if (!csv) return
    const bom = "\uFEFF"
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `BWA_${year}_${String(month).padStart(2, "0")}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleDownloadHTML() {
    if (!html) return
    const blob = new Blob([html], { type: "text/html;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `BWA_${year}_${String(month).padStart(2, "0")}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  function Row({ label, item, bold = false }: { label: string; item: BWALineItem; bold?: boolean }) {
    const cls = bold ? "font-semibold border-t-2" : "border-b"
    return (
      <tr className={cls}>
        <td className="py-2 pr-4">{label}</td>
        <td className="py-2 text-right font-mono">{formatEuro(item.currentMonth)}</td>
        <td className="py-2 text-right font-mono">{formatEuro(item.previousMonth)}</td>
        <td className="py-2 text-right font-mono">{formatEuro(item.ytd)}</td>
        <td className="py-2 text-right font-mono">{formatEuro(item.previousYearYtd)}</td>
        <td className="py-2 text-right font-mono">{item.percentOfRevenue.toFixed(1)}%</td>
      </tr>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <CardTitle className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-5 h-5" />
          BWA (Betriebswirtschaftliche Auswertung)
        </CardTitle>
        <CardDescription className="mb-6">
          Monatliches Controlling-Report mit Umsatz, Kosten und Ergebnis.
          Standard-BWA nach DATEV-Schema (kurzfristige Erfolgsrechnung).
        </CardDescription>

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
          <div>
            <label className="text-sm font-medium block mb-1">Monat</label>
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="border rounded px-3 py-2 text-sm bg-background"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={handleGenerate} disabled={loading}>
              <BarChart3 className="w-4 h-4 mr-1" />
              {loading ? "Berechne..." : "BWA erstellen"}
            </Button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive mb-4">{error}</p>
        )}

        {report && (
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">BWA {MONTH_NAMES[report.month - 1]} {report.year}</Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium">Position</th>
                    <th className="text-right py-2 font-medium w-28">{MONTH_NAMES[report.month - 1]}</th>
                    <th className="text-right py-2 font-medium w-28">Vormonat</th>
                    <th className="text-right py-2 font-medium w-28">YTD</th>
                    <th className="text-right py-2 font-medium w-28">VJ YTD</th>
                    <th className="text-right py-2 font-medium w-20">% Umsatz</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-muted/30"><td colSpan={6} className="py-1 font-semibold text-xs uppercase tracking-wide">Gesamtleistung</td></tr>
                  <Row label="Umsatzerlöse" item={report.umsatzerloese} />
                  <Row label="Bestandsveränderungen" item={report.bestandsveraenderungen} />
                  <Row label="Aktivierte Eigenleistungen" item={report.aktivierteEigenleistungen} />
                  <Row label="Gesamtleistung" item={report.gesamtleistung} bold />

                  <tr><td colSpan={6} className="py-1" /></tr>
                  <Row label="Materialaufwand / Wareneinsatz" item={report.materialaufwand} />
                  <Row label="Rohertrag" item={report.rohertrag} bold />

                  <tr className="bg-muted/30"><td colSpan={6} className="py-1 font-semibold text-xs uppercase tracking-wide">Kosten</td></tr>
                  <Row label="Löhne und Gehälter" item={report.loehneGehaelter} />
                  <Row label="Soziale Abgaben" item={report.sozialeAbgaben} />
                  <Row label="Personalkosten" item={report.personalkosten} bold />

                  <Row label="Miete" item={report.miete} />
                  <Row label="Nebenkosten" item={report.nebenkosten} />
                  <Row label="Raumkosten" item={report.raumkosten} bold />

                  <Row label="Betriebliche Steuern" item={report.betrieblicheSteuern} />
                  <Row label="Versicherungen/Beiträge" item={report.versicherungenBeitraege} />
                  <Row label="Kfz-Kosten" item={report.kfzKosten} />
                  <Row label="Werbe-/Reisekosten" item={report.werbeReisekosten} />
                  <Row label="Verschiedene Kosten" item={report.verschiedeneKosten} />
                  <Row label="Gesamtkosten" item={report.gesamtkosten} bold />

                  <tr className="bg-muted/30"><td colSpan={6} className="py-1 font-semibold text-xs uppercase tracking-wide">Ergebnis</td></tr>
                  <Row label="Betriebsergebnis (EBIT)" item={report.betriebsergebnis} bold />
                  <Row label="Zinsen und ähnliche Aufwendungen" item={report.zinsen} />
                  <Row label="Ergebnis vor Steuern (EBT)" item={report.ergebnisVorSteuern} bold />
                  <Row label="Steuern vom Einkommen/Ertrag" item={report.einkommenSteuern} />
                  <Row label="Vorläufiges Ergebnis" item={report.vorlaeufgesErgebnis} bold />
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={handleDownloadCSV}>
                <Download className="w-4 h-4 mr-1" />
                CSV herunterladen
              </Button>
              <Button variant="outline" onClick={handleDownloadHTML}>
                <Download className="w-4 h-4 mr-1" />
                HTML herunterladen
              </Button>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
              <p className="flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  Die BWA wird aus den vorhandenen Transaktionen berechnet.
                  Bitte prüfen Sie die Werte mit Ihrem Steuerberater.
                </span>
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
