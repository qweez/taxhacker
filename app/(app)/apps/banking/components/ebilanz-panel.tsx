"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { generateEBilanzAction, exportEBilanzXBRLAction } from "../actions"
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet } from "lucide-react"

type EBilanzPosition = {
  taxonomyId: string
  label: string
  value: number
}

type EBilanzData = {
  companyName: string
  taxNumber: string
  fiscalYearFrom: string
  fiscalYearTo: string
  balanceSheet: EBilanzPosition[]
  incomeStatement: EBilanzPosition[]
}

function formatEur(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
}

export default function EBilanzPanel() {
  const [year, setYear] = useState(new Date().getFullYear() - 1)
  const [data, setData] = useState<EBilanzData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setWarnings([])
    try {
      const result = await generateEBilanzAction(year)
      if (result.success && result.data) {
        setData(result.data)
        // Validate: Aktiva should equal Passiva
        const w: string[] = []
        const aktiva = result.data.balanceSheet
          .filter((p: EBilanzPosition) => p.taxonomyId.includes("bs.ass"))
          .reduce((s: number, p: EBilanzPosition) => s + p.value, 0)
        const passiva = result.data.balanceSheet
          .filter((p: EBilanzPosition) => p.taxonomyId.includes("bs.eqLiab"))
          .reduce((s: number, p: EBilanzPosition) => s + p.value, 0)
        if (aktiva !== passiva) {
          w.push(`Bilanz ist nicht ausgeglichen: Aktiva ${formatEur(aktiva)} ≠ Passiva ${formatEur(passiva)}`)
        }
        if (!result.data.taxNumber) {
          w.push("Steuernummer nicht hinterlegt. Bitte im Firmenprofil ergänzen.")
        }
        const emptyPositions = [...result.data.balanceSheet, ...result.data.incomeStatement].filter((p: EBilanzPosition) => p.value === 0)
        if (emptyPositions.length > 5) {
          w.push(`${emptyPositions.length} Positionen haben den Wert 0 — ggf. fehlen Buchungen.`)
        }
        setWarnings(w)
      } else {
        setError(result.error ?? "Fehler bei E-Bilanz-Generierung")
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleDownloadXBRL() {
    const result = await exportEBilanzXBRLAction(year)
    if (result.success && result.data) {
      const blob = new Blob([result.data], { type: "application/xml" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `ebilanz_${year}.xbrl`
      a.click()
      URL.revokeObjectURL(url)
    } else {
      setError(result.error ?? "XBRL-Export fehlgeschlagen")
    }
  }

  const aktivaPositions = data?.balanceSheet.filter(p => p.taxonomyId.includes("bs.ass")) ?? []
  const passivaPositions = data?.balanceSheet.filter(p => p.taxonomyId.includes("bs.eqLiab")) ?? []
  const totalAktiva = aktivaPositions.reduce((s, p) => s + p.value, 0)
  const totalPassiva = passivaPositions.reduce((s, p) => s + p.value, 0)

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium">Geschäftsjahr:</label>
          <select
            className="border rounded px-3 py-1.5"
            value={year}
            onChange={e => setYear(parseInt(e.target.value))}
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <Button onClick={handleGenerate} disabled={loading}>
            <FileSpreadsheet className="w-4 h-4 mr-1" />
            {loading ? "Generiere..." : "E-Bilanz generieren"}
          </Button>
          {data && (
            <Button variant="outline" onClick={handleDownloadXBRL}>
              <Download className="w-4 h-4 mr-1" /> XBRL herunterladen
            </Button>
          )}
        </div>
      </Card>

      {/* Warnings */}
      {warnings.length > 0 && (
        <Card className="p-4 border-yellow-500">
          <CardTitle className="flex items-center gap-2 text-sm mb-2">
            <AlertCircle className="w-4 h-4 text-yellow-500" />
            Validierungshinweise
          </CardTitle>
          <ul className="text-sm space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-yellow-700 dark:text-yellow-300">• {w}</li>
            ))}
          </ul>
        </Card>
      )}

      {error && (
        <Card className="p-3 flex items-center gap-2 border-red-500">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <span className="text-sm">{error}</span>
        </Card>
      )}

      {/* Preview */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Bilanz — Aktiva */}
          <Card className="p-4">
            <CardTitle className="mb-3 text-base">Aktiva</CardTitle>
            <table className="w-full text-sm">
              <tbody>
                {aktivaPositions.map(p => (
                  <tr key={p.taxonomyId} className="border-b">
                    <td className="p-1.5">{p.label}</td>
                    <td className="p-1.5 text-right font-mono">{formatEur(p.value)}</td>
                  </tr>
                ))}
                <tr className="font-bold border-t-2">
                  <td className="p-1.5">Summe Aktiva</td>
                  <td className="p-1.5 text-right font-mono">{formatEur(totalAktiva)}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          {/* Bilanz — Passiva */}
          <Card className="p-4">
            <CardTitle className="mb-3 text-base">Passiva</CardTitle>
            <table className="w-full text-sm">
              <tbody>
                {passivaPositions.map(p => (
                  <tr key={p.taxonomyId} className="border-b">
                    <td className="p-1.5">{p.label}</td>
                    <td className="p-1.5 text-right font-mono">{formatEur(p.value)}</td>
                  </tr>
                ))}
                <tr className="font-bold border-t-2">
                  <td className="p-1.5">Summe Passiva</td>
                  <td className="p-1.5 text-right font-mono">{formatEur(totalPassiva)}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          {/* GuV */}
          <Card className="p-4 lg:col-span-2">
            <CardTitle className="mb-3 text-base">Gewinn- und Verlustrechnung</CardTitle>
            <table className="w-full text-sm">
              <tbody>
                {data.incomeStatement.map(p => (
                  <tr key={p.taxonomyId} className="border-b">
                    <td className="p-1.5">{p.label}</td>
                    <td className="p-1.5 text-right font-mono">{formatEur(p.value)}</td>
                  </tr>
                ))}
                <tr className="font-bold border-t-2">
                  <td className="p-1.5">Jahresergebnis</td>
                  <td className="p-1.5 text-right font-mono">
                    {formatEur(data.incomeStatement.reduce((s, p) => s + p.value, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {!data && !loading && (
        <Card className="p-8 text-center text-muted-foreground">
          <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Wählen Sie ein Geschäftsjahr und generieren Sie die E-Bilanz.</p>
          <p className="text-sm mt-1">Die E-Bilanz wird im XBRL-Format nach HGB-Taxonomie 6.x erstellt.</p>
        </Card>
      )}
    </div>
  )
}
