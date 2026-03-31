"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getUStSummaryAction } from "../actions"
import { Calculator, Info } from "lucide-react"

type UStData = {
  period: { from: string; to: string }
  outputTax: {
    rate19: { netto: number; ust: number; brutto: number; count: number }
    rate7: { netto: number; ust: number; brutto: number; count: number }
    rate0: { netto: number; brutto: number; count: number }
  }
  inputTax: {
    rate19: { netto: number; vorsteuer: number; brutto: number; count: number }
    rate7: { netto: number; vorsteuer: number; brutto: number; count: number }
  }
  zahllast: number
}

function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function getQuarterDates(year: number, quarter: number): { from: string; to: string } {
  const startMonth = (quarter - 1) * 3
  const from = new Date(year, startMonth, 1)
  const to = new Date(year, startMonth + 3, 0) // last day of quarter
  const pad = (n: number) => n.toString().padStart(2, "0")
  return {
    from: `${year}-${pad(startMonth + 1)}-01`,
    to: `${year}-${pad(startMonth + 3)}-${pad(to.getDate())}`,
  }
}

export default function UStPanel() {
  const currentYear = new Date().getFullYear()
  const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3)

  const [year, setYear] = useState(currentYear)
  const [quarter, setQuarter] = useState(currentQuarter)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<UStData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCalculate() {
    setLoading(true)
    setError(null)
    setData(null)
    const { from, to } = getQuarterDates(year, quarter)
    const result = await getUStSummaryAction(from, to)
    if (result.success && result.data) {
      setData(result.data)
    } else {
      setError(result.error || "Fehler beim Berechnen der USt-Zusammenfassung.")
    }
    setLoading(false)
  }

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i)

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <CardTitle className="flex items-center gap-2 mb-2">
          <Calculator className="w-5 h-5" />
          USt-Voranmeldung
        </CardTitle>
        <CardDescription className="mb-6">
          Berechnung der Umsatzsteuer-Voranmeldung nach Quartal. Die Werte dienen als
          Grundlage zur Meldung an das Finanzamt.
        </CardDescription>

        {/* Quarter + Year selector */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div>
            <label className="text-sm font-medium block mb-1">Quartal</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuarter(q)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    quarter === q
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-accent"
                  }`}
                >
                  Q{q}
                </button>
              ))}
            </div>
          </div>
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
            <Button onClick={handleCalculate} disabled={loading}>
              <Calculator className="w-4 h-4 mr-1" />
              {loading ? "Berechne..." : "Berechnen"}
            </Button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive mb-4">{error}</p>
        )}

        {data && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">Q{quarter} / {year}</Badge>
              <span className="text-sm text-muted-foreground">
                {new Date(data.period.from).toLocaleDateString("de-DE")} &ndash; {new Date(data.period.to).toLocaleDateString("de-DE")}
              </span>
            </div>

            {/* USt-Voranmeldung table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium">KZ</th>
                    <th className="text-left py-2 pr-4 font-medium">Bezeichnung</th>
                    <th className="text-right py-2 pr-4 font-medium">Bemessungsgrundlage</th>
                    <th className="text-right py-2 font-medium">Steuer</th>
                  </tr>
                </thead>
                <tbody>
                  {/* KZ 81: Umsätze 19% */}
                  <tr className="border-b">
                    <td className="py-2 pr-4 font-mono">81</td>
                    <td className="py-2 pr-4">
                      Steuerpflichtige Umsätze (19%)
                      {data.outputTax.rate19.count > 0 && (
                        <Badge variant="secondary" className="ml-2">{data.outputTax.rate19.count}</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">{formatEuro(data.outputTax.rate19.netto)}</td>
                    <td className="py-2 text-right font-mono">{formatEuro(data.outputTax.rate19.ust)}</td>
                  </tr>

                  {/* KZ 86: Umsätze 7% */}
                  <tr className="border-b">
                    <td className="py-2 pr-4 font-mono">86</td>
                    <td className="py-2 pr-4">
                      Steuerpflichtige Umsätze (7%)
                      {data.outputTax.rate7.count > 0 && (
                        <Badge variant="secondary" className="ml-2">{data.outputTax.rate7.count}</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">{formatEuro(data.outputTax.rate7.netto)}</td>
                    <td className="py-2 text-right font-mono">{formatEuro(data.outputTax.rate7.ust)}</td>
                  </tr>

                  {/* Steuerfreie Umsätze (informational) */}
                  {data.outputTax.rate0.count > 0 && (
                    <tr className="border-b text-muted-foreground">
                      <td className="py-2 pr-4 font-mono">&ndash;</td>
                      <td className="py-2 pr-4">
                        Steuerfreie Umsätze
                        <Badge variant="secondary" className="ml-2">{data.outputTax.rate0.count}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">{formatEuro(data.outputTax.rate0.netto)}</td>
                      <td className="py-2 text-right font-mono">&ndash;</td>
                    </tr>
                  )}

                  {/* Separator */}
                  <tr>
                    <td colSpan={4} className="py-1" />
                  </tr>

                  {/* KZ 66: Vorsteuer */}
                  <tr className="border-b">
                    <td className="py-2 pr-4 font-mono">66</td>
                    <td className="py-2 pr-4">
                      Vorsteuerbeträge aus Rechnungen
                      {(data.inputTax.rate19.count + data.inputTax.rate7.count) > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {data.inputTax.rate19.count + data.inputTax.rate7.count}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {formatEuro(data.inputTax.rate19.netto + data.inputTax.rate7.netto)}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {formatEuro(data.inputTax.rate19.vorsteuer + data.inputTax.rate7.vorsteuer)}
                    </td>
                  </tr>

                  {/* Separator */}
                  <tr>
                    <td colSpan={4} className="py-1" />
                  </tr>

                  {/* KZ 83: Zahllast */}
                  <tr className="border-t-2 font-semibold">
                    <td className="py-3 pr-4 font-mono">83</td>
                    <td className="py-3 pr-4">Verbleibende USt-Voranmeldung</td>
                    <td className="py-3 pr-4 text-right" />
                    <td className={`py-3 text-right font-mono ${data.zahllast >= 0 ? "text-destructive" : "text-green-600"}`}>
                      {formatEuro(data.zahllast)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
              <p className="flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  {data.zahllast >= 0
                    ? `Zahllast: ${formatEuro(data.zahllast)} EUR an das Finanzamt abzuführen.`
                    : `Erstattungsanspruch: ${formatEuro(Math.abs(data.zahllast))} EUR vom Finanzamt.`}
                </span>
              </p>
              <p className="flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Alle Beträge in Euro. Angaben ohne Gewähr — bitte mit dem Steuerberater abstimmen.</span>
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
