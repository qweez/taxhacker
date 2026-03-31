"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { exportDatevAction } from "../actions"
import { Download, FileSpreadsheet, Calendar, Info } from "lucide-react"

export default function DatevExportPanel() {
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [chart, setChart] = useState<"SKR03" | "SKR04">("SKR04")
  const [consultantNumber, setConsultantNumber] = useState("")
  const [clientNumber, setClientNumber] = useState("")
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  const currentYear = new Date().getFullYear()
  const defaultFrom = `${currentYear}-01-01`
  const defaultTo = `${currentYear}-12-31`

  async function handleExport(doDownload: boolean) {
    setExporting(true)
    const from = dateFrom || defaultFrom
    const to = dateTo || defaultTo
    const result = await exportDatevAction(from, to, chart, consultantNumber || undefined, clientNumber || undefined)
    if (result.success && result.data) {
      if (doDownload) {
        // DATEV expects Windows-1252, but UTF-8 with BOM works for most imports
        const bom = "\uFEFF"
        const blob = new Blob([bom + result.data], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `EXTF_Buchungsstapel_${chart}_${from}_${to}.csv`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        setPreview(result.data)
      }
    }
    setExporting(false)
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <CardTitle className="flex items-center gap-2 mb-2">
          <FileSpreadsheet className="w-5 h-5" />
          DATEV EXTF Export
        </CardTitle>
        <CardDescription className="mb-6">
          Exportiere Buchungsdaten im DATEV EXTF-Format (Buchungsstapel) zum direkten Import
          in DATEV Unternehmen Online oder DATEV Kanzlei-Rechnungswesen.
        </CardDescription>

        {/* SKR Selection */}
        <div className="mb-6">
          <label className="text-sm font-medium block mb-2">Kontenrahmen</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setChart("SKR03")}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                chart === "SKR03"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
            >
              SKR03
            </button>
            <button
              type="button"
              onClick={() => setChart("SKR04")}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                chart === "SKR04"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
            >
              SKR04
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {chart === "SKR03"
              ? "SKR03: Gliederung nach Kontenarten (häufig bei Einzelunternehmen und Personengesellschaften)"
              : "SKR04: Gliederung nach Bilanzstruktur (häufig bei Kapitalgesellschaften, GmbH, UG)"}
          </p>
        </div>

        {/* Date range + DATEV numbers */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="text-sm font-medium block mb-1">
              <Calendar className="w-3 h-3 inline mr-1" />
              Von
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              placeholder={defaultFrom}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">
              <Calendar className="w-3 h-3 inline mr-1" />
              Bis
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              placeholder={defaultTo}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Beraternummer</label>
            <input
              type="text"
              value={consultantNumber}
              onChange={e => setConsultantNumber(e.target.value)}
              placeholder="10000"
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Mandantennummer</label>
            <input
              type="text"
              value={clientNumber}
              onChange={e => setClientNumber(e.target.value)}
              placeholder="10001"
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => handleExport(true)} disabled={exporting}>
            <Download className="w-4 h-4 mr-1" />
            {exporting ? "Exportiere..." : "CSV herunterladen"}
          </Button>
          <Button variant="outline" onClick={() => handleExport(false)} disabled={exporting}>
            Vorschau
          </Button>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
          <p className="flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Ohne Datumsauswahl: alle Transaktionen des laufenden Jahres ({currentYear}).</span>
          </p>
          <p className="flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Format: EXTF v12, Buchungsstapel. Direkt importierbar in DATEV Unternehmen Online.</span>
          </p>
          <p className="flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Buchungen werden mit Festschreibung=0 exportiert (Steuerberater kann bearbeiten).</span>
          </p>
        </div>
      </Card>

      {preview && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Vorschau (erste 20 Zeilen)</span>
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
              Schließen
            </Button>
          </div>
          <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-[400px] overflow-y-auto font-mono">
            {preview.split("\n").slice(0, 20).join("\n")}
          </pre>
        </Card>
      )}
    </div>
  )
}
