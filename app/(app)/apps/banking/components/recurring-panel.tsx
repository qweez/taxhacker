"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  detectRecurringAction,
  listRecurringInvoicesAction,
  createRecurringInvoiceAction,
  updateRecurringInvoiceAction,
  deleteRecurringInvoiceAction,
  generateDueTransactionsAction,
} from "../actions"
import type { SerializedRecurringPattern, SerializedRecurringInvoice } from "../actions"
import { RefreshCw, Repeat, CalendarClock, AlertTriangle, Plus, Trash2, Pencil, Play, ArrowDownToLine, X, Check } from "lucide-react"
import { cn } from "@/lib/utils"

type Frequency = "monthly" | "quarterly" | "yearly" | "weekly"

const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Woechentlich",
  monthly: "Monatlich",
  quarterly: "Quartalsweise",
  yearly: "Jaehrlich",
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
  overdue: "Ueberfaellig",
  cancelled: "Moeglicherweise gekuendigt",
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

type FormData = {
  name: string
  merchant: string
  amount: string
  frequency: string
  startDate: string
  endDate: string
  categoryCode: string
  autoGenerate: boolean
}

const emptyForm: FormData = {
  name: "",
  merchant: "",
  amount: "",
  frequency: "monthly",
  startDate: new Date().toISOString().split("T")[0],
  endDate: "",
  categoryCode: "",
  autoGenerate: false,
}

export default function RecurringPanel() {
  const [patterns, setPatterns] = useState<SerializedRecurringPattern[]>([])
  const [invoices, setInvoices] = useState<SerializedRecurringInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<{ generated: number; skipped: number } | null>(null)

  const loadPatterns = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await detectRecurringAction()
    if (result.success && result.data) {
      setPatterns(result.data)
    } else {
      setError(result.error ?? "Unbekannter Fehler")
    }
    setLoading(false)
  }, [])

  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true)
    const result = await listRecurringInvoicesAction()
    if (result.success && result.data) {
      setInvoices(result.data)
    }
    setInvoicesLoading(false)
  }, [])

  useEffect(() => {
    loadPatterns()
    loadInvoices()
  }, [loadPatterns, loadInvoices])

  function resetForm() {
    setForm(emptyForm)
    setShowForm(false)
    setEditingId(null)
  }

  function startEdit(inv: SerializedRecurringInvoice) {
    setForm({
      name: inv.name,
      merchant: inv.merchant ?? "",
      amount: (Math.abs(inv.amount) / 100).toFixed(2),
      frequency: inv.frequency,
      startDate: inv.startDate.split("T")[0],
      endDate: inv.endDate ? inv.endDate.split("T")[0] : "",
      categoryCode: inv.categoryCode ?? "",
      autoGenerate: inv.autoGenerate,
    })
    setEditingId(inv.id)
    setShowForm(true)
  }

  function createFromPattern(pattern: SerializedRecurringPattern) {
    setForm({
      name: pattern.merchant,
      merchant: pattern.merchant,
      amount: (Math.abs(pattern.amount) / 100).toFixed(2),
      frequency: pattern.frequency,
      startDate: new Date(pattern.nextExpected).toISOString().split("T")[0],
      endDate: "",
      categoryCode: pattern.categoryCode ?? "",
      autoGenerate: false,
    })
    setEditingId(null)
    setShowForm(true)
  }

  async function handleSave() {
    setSaving(true)
    const amountCents = Math.round(parseFloat(form.amount) * 100)
    if (isNaN(amountCents) || amountCents <= 0) {
      setSaving(false)
      return
    }

    const data = {
      name: form.name,
      merchant: form.merchant || null,
      amount: amountCents,
      frequency: form.frequency,
      startDate: form.startDate,
      endDate: form.endDate || null,
      nextDueDate: form.startDate,
      categoryCode: form.categoryCode || null,
      autoGenerate: form.autoGenerate,
    }

    if (editingId) {
      await updateRecurringInvoiceAction(editingId, data)
    } else {
      await createRecurringInvoiceAction(data)
    }

    resetForm()
    await loadInvoices()
    setSaving(false)
  }

  async function handleDelete(id: string) {
    await deleteRecurringInvoiceAction(id)
    await loadInvoices()
  }

  async function handleGenerate() {
    setGenerating(true)
    setGenerateResult(null)
    const result = await generateDueTransactionsAction()
    if (result.success && result.data) {
      setGenerateResult(result.data)
      await loadInvoices()
    }
    setGenerating(false)
  }

  // Auto-detected patterns section
  const patternsSection = (() => {
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
          <p className="text-sm mt-1">Es wurden keine regelmaessigen Zahlungsmuster gefunden. Mindestens 3 Transaktionen pro Empfaenger sind erforderlich.</p>
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
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              {patterns.length} erkannt &middot; Geschaetzte monatliche Kosten:{" "}
              <span className="font-semibold text-foreground">{formatAmount(Math.round(totalMonthlyCents))}</span>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={loadPatterns} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-1", loading && "animate-spin")} />
            Aktualisieren
          </Button>
        </div>

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
                            Naechste: {formatDate(pattern.nextExpected)}
                            {status === "overdue" && (
                              <span className="text-yellow-600 ml-1">(ueberfaellig)</span>
                            )}
                            {status === "cancelled" && (
                              <span className="text-red-600 ml-1">(moeglicherweise gekuendigt)</span>
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
                      <div className="flex items-center gap-2 ml-2">
                        <span className="text-sm font-mono font-medium whitespace-nowrap text-red-600">
                          -{formatAmount(pattern.amount)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Aus erkanntem Muster erstellen"
                          onClick={() => createFromPattern(pattern)}
                        >
                          <ArrowDownToLine className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  })()

  return (
    <div className="space-y-8">
      {/* Auto-detected patterns */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <CalendarClock className="w-5 h-5" />
          Erkannte wiederkehrende Zahlungen
        </h3>
        {patternsSection}
      </div>

      {/* Managed recurring invoices */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Repeat className="w-5 h-5" />
            Verwaltete Dauerauftraege
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
            >
              <Play className={cn("w-4 h-4 mr-1", generating && "animate-spin")} />
              Faellige generieren
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => { setEditingId(null); setForm(emptyForm); setShowForm(true) }}
            >
              <Plus className="w-4 h-4 mr-1" />
              Neuer Dauerauftrag
            </Button>
          </div>
        </div>

        {generateResult && (
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 text-sm">
            {generateResult.generated} Transaktionen generiert, {generateResult.skipped} uebersprungen.
          </div>
        )}

        {/* Add/Edit form */}
        {showForm && (
          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">
                {editingId ? "Dauerauftrag bearbeiten" : "Neuer Dauerauftrag"}
              </h4>
              <Button variant="ghost" size="sm" onClick={resetForm}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ri-name">Name *</Label>
                <Input
                  id="ri-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="z.B. Bueromiete"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ri-merchant">Empfaenger</Label>
                <Input
                  id="ri-merchant"
                  value={form.merchant}
                  onChange={(e) => setForm({ ...form, merchant: e.target.value })}
                  placeholder="z.B. Vermieter GmbH"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ri-amount">Betrag (EUR) *</Label>
                <Input
                  id="ri-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ri-frequency">Frequenz</Label>
                <Select
                  value={form.frequency}
                  onValueChange={(v) => setForm({ ...form, frequency: v })}
                >
                  <SelectTrigger id="ri-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Woechentlich</SelectItem>
                    <SelectItem value="monthly">Monatlich</SelectItem>
                    <SelectItem value="quarterly">Quartalsweise</SelectItem>
                    <SelectItem value="yearly">Jaehrlich</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ri-start">Startdatum *</Label>
                <Input
                  id="ri-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ri-end">Enddatum (optional)</Label>
                <Input
                  id="ri-end"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ri-category">Kategorie-Code</Label>
                <Input
                  id="ri-category"
                  value={form.categoryCode}
                  onChange={(e) => setForm({ ...form, categoryCode: e.target.value })}
                  placeholder="optional"
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="ri-auto"
                  checked={form.autoGenerate}
                  onChange={(e) => setForm({ ...form, autoGenerate: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="ri-auto">Automatisch generieren</Label>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={resetForm}>
                Abbrechen
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !form.name || !form.amount || !form.startDate}
              >
                {saving ? (
                  <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 mr-1" />
                )}
                {editingId ? "Speichern" : "Erstellen"}
              </Button>
            </div>
          </Card>
        )}

        {/* Invoice list */}
        {invoicesLoading ? (
          <div className="text-center py-4 text-muted-foreground text-sm">Lade Dauerauftraege...</div>
        ) : invoices.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            <p className="text-sm">Noch keine Dauerauftraege angelegt. Erstellen Sie einen neuen oder uebernehmen Sie ein erkanntes Muster.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className={cn(
                  "p-3 rounded-lg border border-l-4 transition-colors",
                  inv.isActive ? "border-l-green-500" : "border-l-gray-400",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("w-2 h-2 rounded-full flex-shrink-0", inv.isActive ? "bg-green-500" : "bg-gray-400")} />
                      <p className="text-sm font-medium truncate">{inv.name}</p>
                      {inv.merchant && (
                        <span className="text-xs text-muted-foreground truncate">({inv.merchant})</span>
                      )}
                      <Badge
                        variant="secondary"
                        className={cn("text-xs flex-shrink-0", FREQUENCY_BADGE_VARIANT[inv.frequency as Frequency] ?? "")}
                      >
                        {FREQUENCY_LABELS[inv.frequency as Frequency] ?? inv.frequency}
                      </Badge>
                      {inv.isActive ? (
                        <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Aktiv</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Inaktiv</Badge>
                      )}
                      {inv.autoGenerate && (
                        <Badge variant="secondary" className="text-xs">Auto</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 ml-4 text-xs text-muted-foreground">
                      <span>Naechste Faelligkeit: {formatDate(inv.nextDueDate)}</span>
                      {inv.lastGeneratedAt && (
                        <span>Zuletzt generiert: {formatDate(inv.lastGeneratedAt)}</span>
                      )}
                      {inv.endDate && (
                        <span>Ende: {formatDate(inv.endDate)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <span className="text-sm font-mono font-medium whitespace-nowrap">
                      {formatAmount(inv.amount)}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(inv)} title="Bearbeiten">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(inv.id)} title="Loeschen" className="text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
