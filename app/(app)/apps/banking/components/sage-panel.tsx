"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import {
  exportSageBuchungsstapelAction,
  exportSageDebitorenAction,
  exportSageKreditorenAction,
  exportGDPdUAction,
} from "../actions"
import { Download, Database, Calendar, Info, Package, Users, Truck } from "lucide-react"

type ExportType = "buchungsstapel" | "debitoren" | "kreditoren" | "gdpdu"

export default function SagePanel() {
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [exporting, setExporting] = useState<ExportType | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = useState("")

  const currentYear = new Date().getFullYear()
  const defaultFrom = `${currentYear}-01-01`
  const defaultTo = `${currentYear}-12-31`

  function downloadFile(content: string, filename: string, mimeType: string = "text/csv;charset=utf-8;") {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleBuchungsstapel(doDownload: boolean) {
    setExporting("buchungsstapel")
    const from = dateFrom || defaultFrom
    const to = dateTo || defaultTo
    const result = await exportSageBuchungsstapelAction(from, to)
    if (result.success && result.data) {
      if (doDownload) {
        downloadFile(result.data, `Sage_Buchungsstapel_${from}_${to}.csv`)
      } else {
        setPreviewTitle("Buchungsstapel")
        setPreview(result.data)
      }
    }
    setExporting(null)
  }

  async function handleDebitoren(doDownload: boolean) {
    setExporting("debitoren")
    const result = await exportSageDebitorenAction()
    if (result.success && result.data) {
      if (doDownload) {
        downloadFile(result.data, "Sage_Debitoren.csv")
      } else {
        setPreviewTitle("Debitoren")
        setPreview(result.data)
      }
    }
    setExporting(null)
  }

  async function handleKreditoren(doDownload: boolean) {
    setExporting("kreditoren")
    const result = await exportSageKreditorenAction()
    if (result.success && result.data) {
      if (doDownload) {
        downloadFile(result.data, "Sage_Kreditoren.csv")
      } else {
        setPreviewTitle("Kreditoren")
        setPreview(result.data)
      }
    }
    setExporting(null)
  }

  async function handleGDPdU() {
    setExporting("gdpdu")
    const from = dateFrom || defaultFrom
    const to = dateTo || defaultTo
    const result = await exportGDPdUAction(from, to)
    if (result.success && result.data) {
      const pkg = result.data
      // Download each file in the GDPdU package
      downloadFile(pkg["index.xml"], "index.xml", "application/xml;charset=utf-8;")
      downloadFile(pkg["buchungen.csv"], "buchungen.csv")
      downloadFile(pkg["debitoren.csv"], "debitoren.csv")
      downloadFile(pkg["kreditoren.csv"], "kreditoren.csv")
    }
    setExporting(null)
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <CardTitle className="flex items-center gap-2 mb-2">
          <Database className="w-5 h-5" />
          Sage Warenwirtschaft 7.1 Export
        </CardTitle>
        <CardDescription className="mb-6">
          Exportiere Buchungs- und Stammdaten im CSV-Format kompatibel mit Sage Warenwirtschaft 7.1 (2016).
          Die Dateien werden als semikolongetrennte CSV-Dateien mit Windows-1252-kompatiblem Encoding erzeugt.
        </CardDescription>

        {/* Date range for Buchungsstapel and GDPdU */}
        <div className="grid grid-cols-2 gap-4 mb-6">
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
        </div>

        {/* Export sections */}
        <div className="space-y-4">
          {/* Buchungsstapel */}
          <div className="border rounded-lg p-4">
            <h3 className="font-medium flex items-center gap-2 mb-2">
              <Database className="w-4 h-4" />
              Buchungsstapel
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Alle Buchungen im Sage-CSV-Format mit SKR04-Kontierung, Steuerschlüsseln und Belegdaten.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => handleBuchungsstapel(true)}
                disabled={exporting === "buchungsstapel"}
                size="sm"
              >
                <Download className="w-4 h-4 mr-1" />
                {exporting === "buchungsstapel" ? "Exportiere..." : "CSV herunterladen"}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleBuchungsstapel(false)}
                disabled={exporting === "buchungsstapel"}
                size="sm"
              >
                Vorschau
              </Button>
            </div>
          </div>

          {/* Debitoren */}
          <div className="border rounded-lg p-4">
            <h3 className="font-medium flex items-center gap-2 mb-2">
              <Users className="w-4 h-4" />
              Debitoren (Kunden)
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Kundenstammdaten aus Einnahme-Transaktionen. Debitorennummern: 10000-69999.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => handleDebitoren(true)}
                disabled={exporting === "debitoren"}
                size="sm"
              >
                <Download className="w-4 h-4 mr-1" />
                {exporting === "debitoren" ? "Exportiere..." : "CSV herunterladen"}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleDebitoren(false)}
                disabled={exporting === "debitoren"}
                size="sm"
              >
                Vorschau
              </Button>
            </div>
          </div>

          {/* Kreditoren */}
          <div className="border rounded-lg p-4">
            <h3 className="font-medium flex items-center gap-2 mb-2">
              <Truck className="w-4 h-4" />
              Kreditoren (Lieferanten)
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Lieferantenstammdaten aus Ausgabe-Transaktionen. Kreditorennummern: 70000-99999.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => handleKreditoren(true)}
                disabled={exporting === "kreditoren"}
                size="sm"
              >
                <Download className="w-4 h-4 mr-1" />
                {exporting === "kreditoren" ? "Exportiere..." : "CSV herunterladen"}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleKreditoren(false)}
                disabled={exporting === "kreditoren"}
                size="sm"
              >
                Vorschau
              </Button>
            </div>
          </div>

          {/* GDPdU */}
          <div className="border rounded-lg p-4">
            <h3 className="font-medium flex items-center gap-2 mb-2">
              <Package className="w-4 h-4" />
              GDPdU-Paket (Betriebsprüfung)
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              GDPdU/GoBD-konformes Exportpaket mit index.xml und allen CSV-Dateien.
              Für die digitale Betriebsprüfung durch das Finanzamt.
            </p>
            <Button
              onClick={handleGDPdU}
              disabled={exporting === "gdpdu"}
              size="sm"
            >
              <Download className="w-4 h-4 mr-1" />
              {exporting === "gdpdu" ? "Exportiere..." : "GDPdU-Paket herunterladen"}
            </Button>
          </div>
        </div>

        {/* Info text */}
        <div className="mt-6 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
          <p className="flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              <strong>Import in Sage 7.1:</strong> Datei &rarr; Import &rarr; ASCII/CSV-Import.
              Wähle die heruntergeladene CSV-Datei und bestätige die Feldzuordnung.
            </span>
          </p>
          <p className="flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Kontenrahmen: SKR04. Bankverbindung: Konto 1800. Trennzeichen: Semikolon.</span>
          </p>
          <p className="flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Ohne Datumsauswahl: alle Transaktionen des laufenden Jahres ({currentYear}).</span>
          </p>
          <p className="flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Das GDPdU-Paket enthält eine index.xml zur Beschreibung der Datenstruktur (GDPdU v1.0 Standard).</span>
          </p>
        </div>
      </Card>

      {/* Preview */}
      {preview && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Vorschau: {previewTitle} (erste 20 Zeilen)</span>
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
