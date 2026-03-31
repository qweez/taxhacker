"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { detectRecurringAction } from "../actions"
import type { SerializedRecurringPattern } from "../actions"
import { RefreshCw, Repeat, CalendarClock, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

type Frequency = "monthly" | "quarterly" | "yearly" | "weekly"

const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Wöchentlich",
  monthly: "Monatlich",
  quarterly: "Quartalsweise",
  yearly: "Jährlich",
}

const FREQUENCY_ORDER: Frequency[] = ["monthly", "quarterly", "yearly", "weekly"]

const FREQUENCY_BADGE_VARIANT: Record<Frequency, string> = {
  weekly: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  monthly: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  quarterly: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  yearly: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
}

function formatAmount(cents: number): string {
  const value = Math.abs(cents) / 100
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value)
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("de-DE")
}

/**
 * Determine status color:
 * - green: active (next expected is in the future)
 * - yellow: overdue (next expected has passed but less than 2 periods)
 * - red: possibly cancelled (2+ missed periods)
 */
function getStatus(pattern: SerializedRecurringPattern): "active" | "overdue" | "cancelled" {
  const now = new Date()
  const nextExpected = new Date(pattern.nextExpected)

  if (nextExpected > now) return "active"

  const daysSinceExpected = Math.round((now.getTime() - nextExpected.getTime()) / (1000 * 60 * 60 * 24))

  const periodDays: Record<Frequency, number> = {
    weekly: 7,
    monthly: 30,
    quarterly: 91,
    yearly: 365,
  }

  const threshold = periodDays[pattern.frequency] * 2
  if (daysSinceExpected >= threshold) return "cancelled"
  return "overdue"
}

const STATUS_STYLES = {
  active: "border-l-green-500",
  overdue: "border-l-yellow-500",
  cancelled: "border-l-red-500",
}

const STATUS_DOT = {
  active: "bg-green-500",
  overdue: "bg-yellow-500",
  cancelled: "bg-red-500",
}

const STATUS_LABELS = {
  active: "Aktiv",
  overdue: "Überfällig",
  cancelled: "Möglicherweise gekündigt",
}

/**
 * Estimate monthly cost of a pattern in cents.
 */
function monthlyEquivalent(pattern: SerializedRecurringPattern): number {
  const amount = Math.abs(pattern.amount)
  switch (pattern.frequency) {
    case "weekly": return amount * (52 / 12)
    case "monthly": return amount
    case "quarterly": return amount / 3
    case "yearly": return amount / 12
  }
}

export default function RecurringPanel() {
  const [patterns, setPatterns] = useState<SerializedRecurringPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadPatterns()
  }, [])

  async function loadPatterns() {
    setLoading(true)
    setError(null)
    const result = await detectRecurringAction()
    if (result.success && result.data) {
      setPatterns(result.data)
    } else {
      setError(result.error ?? "Unbekannter Fehler")
    }
    setLoading(false)
  }

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Analysiere wiederkehrende Transaktionen...</div>
  }

  if (error) {
    return (
      <Card className="p-6 text-center">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={loadPatterns}>
          Erneut versuchen
        </Button>
      </Card>
    )
  }

  if (patterns.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <Repeat className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p className="font-medium">Keine wiederkehrenden Transaktionen erkannt</p>
        <p className="text-sm mt-1">Es wurden keine regelmäßigen Zahlungsmuster gefunden. Mindestens 3 Transaktionen pro Empfänger sind erforderlich.</p>
      </Card>
    )
  }

  // Calculate total monthly cost (only active/overdue, not cancelled)
  const totalMonthlyCents = patterns
    .filter(p => getStatus(p) !== "cancelled")
    .reduce((sum, p) => sum + monthlyEquivalent(p), 0)

  // Group by frequency
  const grouped = new Map<Frequency, SerializedRecurringPattern[]>()
  for (const freq of FREQUENCY_ORDER) {
    const items = patterns.filter(p => p.frequency === freq)
    if (items.length > 0) {
      grouped.set(freq, items)
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <CalendarClock className="w-5 h-5" />
            Wiederkehrende Zahlungen
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {patterns.length} erkannt &middot; Geschätzte monatliche Kosten:{" "}
            <span className="font-semibold text-foreground">{formatAmount(Math.round(totalMonthlyCents))}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadPatterns} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4 mr-1", loading && "animate-spin")} />
          Aktualisieren
        </Button>
      </div>

      {/* Frequency groups */}
      {Array.from(grouped.entries()).map(([frequency, items]) => (
        <div key={frequency} className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            {FREQUENCY_LABELS[frequency]} ({items.length})
          </h4>
          <div className="space-y-1">
            {items.map((pattern, idx) => {
              const status = getStatus(pattern)
              return (
                <div
                  key={`${pattern.merchant}-${idx}`}
                  className={cn(
                    "p-3 rounded-lg border border-l-4 transition-colors",
                    STATUS_STYLES[status],
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("w-2 h-2 rounded-full flex-shrink-0", STATUS_DOT[status])} />
                        <p className="text-sm font-medium truncate">{pattern.merchant}</p>
                        <Badge
                          variant="secondary"
                          className={cn("text-xs flex-shrink-0", FREQUENCY_BADGE_VARIANT[pattern.frequency])}
                        >
                          {FREQUENCY_LABELS[pattern.frequency]}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 ml-4 text-xs text-muted-foreground">
                        <span>{pattern.occurrences} Buchungen</span>
                        <span>Zuletzt: {formatDate(pattern.lastOccurrence)}</span>
                        <span>
                          Nächste: {formatDate(pattern.nextExpected)}
                          {status === "overdue" && (
                            <span className="text-yellow-600 ml-1">(überfällig)</span>
                          )}
                          {status === "cancelled" && (
                            <span className="text-red-600 ml-1">(möglicherweise gekündigt)</span>
                          )}
                        </span>
                        {status !== "active" && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              status === "overdue" && "border-yellow-500 text-yellow-700 dark:text-yellow-400",
                              status === "cancelled" && "border-red-500 text-red-700 dark:text-red-400",
                            )}
                          >
                            {STATUS_LABELS[status]}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <span className="text-sm font-mono font-medium ml-2 whitespace-nowrap text-red-600">
                      -{formatAmount(pattern.amount)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
