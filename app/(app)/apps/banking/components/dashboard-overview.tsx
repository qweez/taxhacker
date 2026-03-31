"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  TrendingUp,
  TrendingDown,
  Euro,
  BarChart3,
  FileText,
  Receipt,
  FileSpreadsheet,
  Calculator,
  Upload,
  AlertTriangle,
  Clock,
  ArrowRight,
} from "lucide-react"
import { getDashboardStatsAction, type DashboardStats } from "../actions"
import { cn } from "@/lib/utils"
import type { SidebarSection } from "./sidebar-nav"

const eurFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
})

function formatCents(cents: number): string {
  return eurFormatter.format(cents / 100)
}

type QuickAction = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  section: SidebarSection
  variant?: "default" | "outline"
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Neue Rechnung", icon: Receipt, section: "invoices" },
  { label: "DATEV Export", icon: FileSpreadsheet, section: "datev", variant: "outline" },
  { label: "USt berechnen", icon: Calculator, section: "ust", variant: "outline" },
  { label: "Belege zuordnen", icon: Upload, section: "receipts", variant: "outline" },
]

export default function DashboardOverview({
  onNavigate,
}: {
  onNavigate: (section: SidebarSection) => void
}) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDashboardStatsAction()
      .then((result) => {
        if (result.success && result.data) {
          setStats(result.data)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="animate-pulse h-48" />
          <Card className="animate-pulse h-48" />
        </div>
      </div>
    )
  }

  const kpiCards = stats
    ? [
        {
          title: "Einnahmen (Monat)",
          value: formatCents(stats.currentMonth.income),
          icon: TrendingUp,
          color: "text-green-600",
          bgColor: "bg-green-50 dark:bg-green-950",
          borderColor: "border-green-200 dark:border-green-800",
        },
        {
          title: "Ausgaben (Monat)",
          value: formatCents(stats.currentMonth.expenses),
          icon: TrendingDown,
          color: "text-red-600",
          bgColor: "bg-red-50 dark:bg-red-950",
          borderColor: "border-red-200 dark:border-red-800",
        },
        {
          title: "Ergebnis (Monat)",
          value: formatCents(stats.currentMonth.net),
          icon: Euro,
          color: stats.currentMonth.net >= 0 ? "text-green-600" : "text-red-600",
          bgColor: "bg-blue-50 dark:bg-blue-950",
          borderColor: "border-blue-200 dark:border-blue-800",
        },
        {
          title: "Offene Posten",
          value: String(stats.unreconciledCount),
          icon: BarChart3,
          color: stats.unreconciledCount > 0 ? "text-orange-600" : "text-green-600",
          bgColor: "bg-orange-50 dark:bg-orange-950",
          borderColor: "border-orange-200 dark:border-orange-800",
        },
      ]
    : []

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.title} className={card.borderColor}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <div className={cn("p-2 rounded-lg", card.bgColor)}>
                  <Icon className={cn("w-4 h-4", card.color)} />
                </div>
              </CardHeader>
              <CardContent>
                <div className={cn("text-2xl font-bold", card.color)}>{card.value}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Schnellzugriff</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon
              return (
                <Button
                  key={action.label}
                  variant={action.variant ?? "default"}
                  size="sm"
                  onClick={() => onNavigate(action.section)}
                >
                  <Icon className="w-4 h-4 mr-1.5" />
                  {action.label}
                </Button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Year-to-Date Summary */}
        {stats && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" />
                Jahresübersicht
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {/* Simple bar comparison */}
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Einnahmen</span>
                      <span className="font-medium text-green-600">
                        {formatCents(stats.yearToDate.income)}
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{
                          width: `${
                            stats.yearToDate.income + stats.yearToDate.expenses > 0
                              ? (stats.yearToDate.income /
                                  (stats.yearToDate.income + stats.yearToDate.expenses)) *
                                100
                              : 50
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Ausgaben</span>
                      <span className="font-medium text-red-600">
                        {formatCents(stats.yearToDate.expenses)}
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500 rounded-full"
                        style={{
                          width: `${
                            stats.yearToDate.income + stats.yearToDate.expenses > 0
                              ? (stats.yearToDate.expenses /
                                  (stats.yearToDate.income + stats.yearToDate.expenses)) *
                                100
                              : 50
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Netto</p>
                    <p
                      className={cn(
                        "text-lg font-semibold",
                        stats.yearToDate.net >= 0 ? "text-green-600" : "text-red-600"
                      )}
                    >
                      {formatCents(stats.yearToDate.net)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Transaktionen</p>
                    <p className="text-lg font-semibold">{stats.yearToDate.count}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alerts & Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
              Hinweise
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats && stats.unreconciledCount > 0 && (
                <button
                  onClick={() => onNavigate("reconciliation")}
                  className="flex items-center justify-between w-full p-2.5 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950 hover:bg-orange-100 dark:hover:bg-orange-900 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-600" />
                    <span className="text-sm">
                      <span className="font-medium">{stats.unreconciledCount}</span>{" "}
                      unabgeglichene Transaktionen
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-orange-600" />
                </button>
              )}

              {stats && stats.unreconciledCount === 0 && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-sm text-green-700 dark:text-green-400">
                    Alle Transaktionen abgeglichen
                  </span>
                </div>
              )}

              <button
                onClick={() => onNavigate("receipts")}
                className="flex items-center justify-between w-full p-2.5 rounded-lg border hover:bg-accent transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">Belege prüfen und zuordnen</span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </button>

              <button
                onClick={() => onNavigate("ust")}
                className="flex items-center justify-between w-full p-2.5 rounded-lg border hover:bg-accent transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">USt-Voranmeldung berechnen</span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Last sync info */}
      {stats?.lastSyncAt && (
        <p className="text-xs text-muted-foreground text-center">
          Letzter Sync: {new Date(stats.lastSyncAt).toLocaleString("de-DE")}
        </p>
      )}
    </div>
  )
}

function Separator() {
  return <div className="border-t" />
}
