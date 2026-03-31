"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FormInput } from "@/components/forms/simple"
import { generateInflationReportAction, applyInflationAdjustmentAction } from "../actions"
import { CPI_DATA } from "@/lib/inflation"
import { TrendingUp, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info } from "lucide-react"
import { cn } from "@/lib/utils"

type InflationReportItem = {
  name: string
  merchant: string | null
  baseAmount: number
  baseYear: number
  currentAmount: number
  inflationRate: number
  difference: number
  shouldAdjust: boolean
}

type InflationReport = {
  items: InflationReportItem[]
  totalBaseAmount: number
  totalCurrentAmount: number
  totalDifference: number
  averageInflation: number
  generatedAt: string
  thresholdPercent: number
}

function formatAmount(cents: number): string {
  const value = cents / 100
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value)
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100)
}

export default function InflationPanel() {
  const [threshold, setThreshold] = useState(5.0)
  const [report, setReport] = useState<InflationReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCPI, setShowCPI] = useState(false)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<Record<string, string>>({})

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setReport(null)
    try {
      const result = await generateInflationReportAction(threshold)
      if (result.success && result.data) {
        setReport(result.data)
      } else {
        setError(result.error ?? "Unbekannter Fehler")
      }
    } catch (e: any) {
      setError(e.message ?? "Fehler bei der Berechnung")
    } finally {
      setLoading(false)
    }
  }

  async function handleApply(itemName: string, index: number) {
    const key = `${itemName}-${index}`
    setApplyingId(key)
    try {
      const result = await applyInflationAdjustmentAction(itemName)
      if (result.success) {
        setApplyResult(prev => ({ ...prev, [key]: "success" }))
      } else {
        setApplyResult(prev => ({ ...prev, [key]: result.error ?? "Fehler" }))
      }
    } catch (e: any) {
      setApplyResult(prev => ({ ...prev, [key]: e.message ?? "Fehler" }))
    } finally {
      setApplyingId(null)
    }
  }

  const cpiYears = Object.entries(CPI_DATA).sort(([a], [b]) => Number(a) - Number(b))

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="w-48">
          <label className="text-sm font-medium mb-1 block">Schwellenwert (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value) || 0)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <Button onClick={handleGenerate} disabled={loading}>
          <TrendingUp className="w-4 h-4 mr-2" />
          {loading ? "Berechne..." : "Inflationsanpassung berechnen"}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <Card className="p-4 border-destructive">
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </p>
        </Card>
      )}

      {/* Report */}
      {report && (
        <>
          {/* Summary card */}
          <Card className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Gesamte Mehrkosten durch Inflation</p>
                <p className={cn(
                  "text-2xl font-bold",
                  report.totalDifference > 0 ? "text-red-600" : "text-green-600",
                )}>
                  {report.totalDifference > 0 ? "+" : ""}{formatAmount(report.totalDifference)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Durchschnittliche Inflationsrate</p>
                <p className="text-2xl font-bold">
                  {formatPercent(report.averageInflation)}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              <span>Basisbetrag gesamt: {formatAmount(report.totalBaseAmount)}</span>
              <span>Inflationsbereinigt gesamt: {formatAmount(report.totalCurrentAmount)}</span>
              <span>Schwellenwert: {report.thresholdPercent}%</span>
            </div>
          </Card>

          {/* Results table */}
          {report.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4">Name / Merchant</th>
                    <th className="pb-2 pr-4 text-right">Basisbetrag</th>
                    <th className="pb-2 pr-4 text-right">Inflationsbereinigt</th>
                    <th className="pb-2 pr-4 text-right">Differenz</th>
                    <th className="pb-2 pr-4 text-right">Inflation %</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item, idx) => {
                    const key = `${item.name}-${idx}`
                    return (
                      <tr key={key} className="border-b hover:bg-muted/50">
                        <td className="py-2 pr-4">
                          <span className="font-medium">{item.name}</span>
                          {item.merchant && item.merchant !== item.name && (
                            <span className="text-muted-foreground ml-1">({item.merchant})</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono">
                          {formatAmount(item.baseAmount)}
                          <span className="text-muted-foreground text-xs ml-1">({item.baseYear})</span>
                        </td>
                        <td className="py-2 pr-4 text-right font-mono">
                          {formatAmount(item.currentAmount)}
                        </td>
                        <td className={cn(
                          "py-2 pr-4 text-right font-mono",
                          item.difference > 0 ? "text-red-600" : item.difference < 0 ? "text-green-600" : "",
                        )}>
                          {item.difference > 0 ? "+" : ""}{formatAmount(item.difference)}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono">
                          {formatPercent(item.inflationRate)}
                        </td>
                        <td className="py-2 pr-4">
                          {item.shouldAdjust ? (
                            <Badge variant="destructive" className="text-xs">
                              Anpassung empfohlen
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                              OK
                            </Badge>
                          )}
                        </td>
                        <td className="py-2">
                          {item.shouldAdjust && (
                            <>
                              {applyResult[key] === "success" ? (
                                <span className="text-green-600 flex items-center gap-1 text-xs">
                                  <CheckCircle2 className="w-3 h-3" /> Angepasst
                                </span>
                              ) : applyResult[key] ? (
                                <span className="text-destructive text-xs">{applyResult[key]}</span>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={applyingId === key}
                                  onClick={() => handleApply(item.name, idx)}
                                  className="text-xs h-7"
                                >
                                  {applyingId === key ? "..." : "Anpassen"}
                                </Button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Card className="p-8 text-center text-muted-foreground">
              <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Keine wiederkehrenden Kosten gefunden.</p>
              <p className="text-sm mt-1">Es müssen zunächst wiederkehrende Transaktionen erkannt werden.</p>
            </Card>
          )}

          {/* CPI Table (collapsible) */}
          <Card className="p-4">
            <button
              type="button"
              onClick={() => setShowCPI(!showCPI)}
              className="flex items-center gap-2 w-full text-left text-sm font-medium"
            >
              {showCPI ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              CPI-Tabelle (Verbraucherpreisindex)
            </button>
            {showCPI && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 pr-4">Jahr</th>
                      <th className="pb-2 pr-4 text-right">VPI (2020 = 100)</th>
                      <th className="pb-2 text-right">Veränderung zum Vorjahr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cpiYears.map(([year, cpi], idx) => {
                      const prevCpi = idx > 0 ? Number(cpiYears[idx - 1][1]) : null
                      const change = prevCpi !== null ? ((Number(cpi) - prevCpi) / prevCpi) * 100 : null
                      return (
                        <tr key={year} className="border-b">
                          <td className="py-1 pr-4 font-mono">{year}</td>
                          <td className="py-1 pr-4 text-right font-mono">{Number(cpi).toFixed(1)}</td>
                          <td className="py-1 text-right font-mono">
                            {change !== null ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "-"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Info text */}
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Info className="w-3 h-3" />
            Basierend auf dem Verbraucherpreisindex (VPI) des Statistischen Bundesamtes
          </p>
        </>
      )}
    </div>
  )
}
