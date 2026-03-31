"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown, ArrowUp, ArrowDown, Euro, BarChart3 } from "lucide-react"
import { getDashboardStatsAction, type DashboardStats } from "../actions"

const eurFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
})

function formatCents(cents: number): string {
  return eurFormatter.format(cents / 100)
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / Math.abs(previous)) * 100)
}

function ChangeIndicator({ current, previous, invert = false }: { current: number; previous: number; invert?: boolean }) {
  const pct = percentChange(current, previous)
  if (pct === null) return <span className="text-xs text-muted-foreground">Keine Vormonatsdaten</span>

  const isPositive = invert ? pct < 0 : pct > 0
  const Arrow = pct >= 0 ? ArrowUp : ArrowDown
  const color = isPositive ? "text-green-600" : "text-red-600"

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Arrow className="w-3 h-3" />
      {Math.abs(pct)}% gg. Vormonat
    </span>
  )
}

export default function StatsOverview() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDashboardStatsAction()
      .then(result => {
        if (result.success && result.data) {
          setStats(result.data)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-2">
              <div className="h-4 bg-muted rounded w-24" />
            </CardHeader>
            <CardContent>
              <div className="h-7 bg-muted rounded w-32 mb-2" />
              <div className="h-3 bg-muted rounded w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!stats) return null

  const cards = [
    {
      title: "Einnahmen (diesen Monat)",
      value: formatCents(stats.currentMonth.income),
      icon: TrendingUp,
      color: "text-green-600",
      bgColor: "bg-green-50 dark:bg-green-950",
      borderColor: "border-green-200 dark:border-green-800",
      change: (
        <ChangeIndicator
          current={stats.currentMonth.income}
          previous={stats.previousMonth.income}
        />
      ),
    },
    {
      title: "Ausgaben (diesen Monat)",
      value: formatCents(stats.currentMonth.expenses),
      icon: TrendingDown,
      color: "text-red-600",
      bgColor: "bg-red-50 dark:bg-red-950",
      borderColor: "border-red-200 dark:border-red-800",
      change: (
        <ChangeIndicator
          current={stats.currentMonth.expenses}
          previous={stats.previousMonth.expenses}
          invert
        />
      ),
    },
    {
      title: "Netto (diesen Monat)",
      value: formatCents(stats.currentMonth.net),
      icon: Euro,
      color: "text-blue-600",
      bgColor: "bg-blue-50 dark:bg-blue-950",
      borderColor: "border-blue-200 dark:border-blue-800",
      change: (
        <ChangeIndicator
          current={stats.currentMonth.net}
          previous={stats.previousMonth.net}
        />
      ),
    },
    {
      title: "Offen (unabgeglichen)",
      value: String(stats.unreconciledCount),
      icon: BarChart3,
      color: "text-orange-600",
      bgColor: "bg-orange-50 dark:bg-orange-950",
      borderColor: "border-orange-200 dark:border-orange-800",
      change: (
        <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
          {stats.currentMonth.count} Transaktionen
        </Badge>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <Card key={card.title} className={`${card.borderColor}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <div className={`p-2 rounded-lg ${card.bgColor}`}>
                  <Icon className={`w-4 h-4 ${card.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
                <div className="mt-1">{card.change}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Year-to-date Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            Jahresübersicht (Year-to-Date)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Einnahmen</p>
              <p className="text-lg font-semibold text-green-600">{formatCents(stats.yearToDate.income)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Ausgaben</p>
              <p className="text-lg font-semibold text-red-600">{formatCents(stats.yearToDate.expenses)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Netto</p>
              <p className={`text-lg font-semibold ${stats.yearToDate.net >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCents(stats.yearToDate.net)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Transaktionen</p>
              <p className="text-lg font-semibold">{stats.yearToDate.count}</p>
            </div>
          </div>
          {stats.lastSyncAt && (
            <p className="text-xs text-muted-foreground mt-3">
              Letzter Sync: {new Date(stats.lastSyncAt).toLocaleString("de-DE")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
