"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { exportDatevAction } from "../actions"
import { Download, FileSpreadsheet, Calendar } from "lucide-react"

export default function DatevExportPanel() {
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  // Default date range: current year
  const currentYear = new Date().getFullYear()
  const defaultFrom = `${currentYear}-01-01`
  const defaultTo = `${currentYear}-12-31`

  async function handleExport(doDownload: boolean) {
    setExporting(true)
    const from = dateFrom || defaultFrom
    const to = dateTo || defaultTo
    const result = await exportDatevAction(from, to)
    if (result.success && result.data) {
      if (doDownload) {
        const blob = new Blob([result.data], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `EXTF_Buchungsstapel_${from}_${to}.csv`
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
        <CardDescription className="mb-4">
          Exportiere Buchungsdaten im DATEV EXTF-Format (Buchungsstapel) für deinen Steuerberater.
          Kontenrahmen: SKR03.
        </CardDescription>

        <div className="flex flex-wrap items-end gap-4">
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
              className="border rounded px-3 py-2 text-sm"
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
              className="border rounded px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={() => handleExport(true)} disabled={exporting}>
            <Download className="w-4 h-4 mr-1" />
            {exporting ? "Exportiere..." : "CSV herunterladen"}
          </Button>
          <Button variant="outline" onClick={() => handleExport(false)} disabled={exporting}>
            Vorschau
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          Ohne Datumsauswahl werden alle Transaktionen des aktuellen Jahres exportiert.
        </p>
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
