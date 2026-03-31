"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  getOpenItemsAction,
  createOpenItemAction,
  markAsPaidAction,
  autoMatchPaymentsAction,
  getAgingReportAction,
  getDebitSaldenlisteAction,
  getKreditorSaldenlisteAction,
  getDunningCandidatesAction,
  executeDunningAction,
} from "../actions"
import { AlertCircle, CheckCircle2, RefreshCw, Plus, FileWarning, BarChart3, List } from "lucide-react"

type OpenItemRow = {
  id: string
  type: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  merchant: string
  amount: number
  paidAmount: number
  remainingAmount: number
  status: string
  daysPastDue: number
  dunningLevel: number
}

type AgingBucket = {
  label: string
  count: number
  totalAmount: number
}

type SaldenEntry = {
  merchant: string
  openCount: number
  totalAmount: number
  paidAmount: number
  remainingAmount: number
}

function formatEur(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case "paid": return { label: "Bezahlt", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" }
    case "partial": return { label: "Teilzahlung", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" }
    case "overdue": return { label: "Überfällig", className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" }
    case "dunned": return { label: "Gemahnt", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" }
    default: return { label: "Offen", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" }
  }
}

export default function OpenItemsPanel() {
  const [items, setItems] = useState<OpenItemRow[]>([])
  const [aging, setAging] = useState<AgingBucket[]>([])
  const [debitSaldo, setDebitSaldo] = useState<SaldenEntry[]>([])
  const [kreditSaldo, setKreditSaldo] = useState<SaldenEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"table" | "aging" | "saldo">("table")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [showCreateForm, setShowCreateForm] = useState(false)

  const loadData = useCallback(async (type?: string) => {
    setLoading(true)
    try {
      const result = await getOpenItemsAction(type as any, statusFilter || undefined)
      if (result.success && result.data) {
        setItems(result.data.map((i: any) => ({
          ...i,
          invoiceDate: new Date(i.invoiceDate).toLocaleDateString("de-DE"),
          dueDate: new Date(i.dueDate).toLocaleDateString("de-DE"),
        })))
      }
      const agingResult = await getAgingReportAction()
      if (agingResult.success && agingResult.data) {
        setAging(agingResult.data)
      }
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { loadData() }, [loadData])

  async function handleMarkPaid(itemId: string) {
    const result = await markAsPaidAction(itemId)
    if (result.success) {
      setMessage("Zahlung erfasst")
      loadData()
    } else {
      setError(result.error ?? "Fehler")
    }
  }

  async function handleAutoMatch() {
    const result = await autoMatchPaymentsAction()
    if (result.success && result.data) {
      setMessage(`${result.data.matched} Zahlungen zugeordnet, ${result.data.unmatched} offen`)
      loadData()
    } else {
      setError(result.error ?? "Fehler beim Auto-Abgleich")
    }
  }

  async function handleDunning(itemId: string) {
    const result = await executeDunningAction(itemId)
    if (result.success) {
      setMessage("Mahnung erstellt")
      loadData()
    } else {
      setError(result.error ?? "Fehler bei Mahnung")
    }
  }

  async function loadSaldenlisten() {
    const [d, k] = await Promise.all([getDebitSaldenlisteAction(), getKreditorSaldenlisteAction()])
    if (d.success && d.data) setDebitSaldo(d.data)
    if (k.success && k.data) setKreditSaldo(k.data)
  }

  async function handleCreateItem(formData: FormData) {
    const data = {
      type: formData.get("type") as "debitor" | "kreditor",
      invoiceNumber: formData.get("invoiceNumber") as string,
      invoiceDate: formData.get("invoiceDate") as string,
      dueDate: formData.get("dueDate") as string,
      merchant: formData.get("merchant") as string,
      amount: Math.round(parseFloat(formData.get("amount") as string) * 100),
      isB2B: formData.get("isB2B") === "on",
    }
    const result = await createOpenItemAction(data)
    if (result.success) {
      setMessage("Offener Posten erstellt")
      setShowCreateForm(false)
      loadData()
    } else {
      setError(result.error ?? "Fehler beim Erstellen")
    }
  }

  const maxAging = Math.max(...aging.map(a => a.totalAmount), 1)

  return (
    <div className="space-y-4">
      {message && (
        <Card className="p-3 flex items-center gap-2 border-green-500">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <span className="text-sm">{message}</span>
          <Button variant="ghost" size="sm" onClick={() => setMessage(null)} className="ml-auto">Schließen</Button>
        </Card>
      )}
      {error && (
        <Card className="p-3 flex items-center gap-2 border-red-500">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <span className="text-sm">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-auto">Schließen</Button>
        </Card>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <Button variant={view === "table" ? "default" : "outline"} size="sm" onClick={() => setView("table")}>
          <List className="w-4 h-4 mr-1" /> Tabelle
        </Button>
        <Button variant={view === "aging" ? "default" : "outline"} size="sm" onClick={() => setView("aging")}>
          <BarChart3 className="w-4 h-4 mr-1" /> Fälligkeitsanalyse
        </Button>
        <Button variant={view === "saldo" ? "default" : "outline"} size="sm" onClick={() => { setView("saldo"); loadSaldenlisten() }}>
          <FileWarning className="w-4 h-4 mr-1" /> Saldenliste
        </Button>
        <div className="flex-1" />
        <select
          className="border rounded px-2 py-1 text-sm"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">Alle Status</option>
          <option value="open">Offen</option>
          <option value="partial">Teilzahlung</option>
          <option value="overdue">Überfällig</option>
          <option value="dunned">Gemahnt</option>
          <option value="paid">Bezahlt</option>
        </select>
        <Button variant="outline" size="sm" onClick={handleAutoMatch}>
          <RefreshCw className="w-4 h-4 mr-1" /> Auto-Abgleich
        </Button>
        <Button size="sm" onClick={() => setShowCreateForm(!showCreateForm)}>
          <Plus className="w-4 h-4 mr-1" /> Neuer Posten
        </Button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <Card className="p-4">
          <CardTitle className="mb-3 text-base">Neuen offenen Posten erfassen</CardTitle>
          <form action={handleCreateItem} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="block text-sm">
              Typ
              <select name="type" className="w-full border rounded px-2 py-1 mt-1" required>
                <option value="debitor">Debitor (Forderung)</option>
                <option value="kreditor">Kreditor (Verbindlichkeit)</option>
              </select>
            </label>
            <label className="block text-sm">
              Rechnungsnummer
              <input name="invoiceNumber" className="w-full border rounded px-2 py-1 mt-1" required />
            </label>
            <label className="block text-sm">
              Firma
              <input name="merchant" className="w-full border rounded px-2 py-1 mt-1" required />
            </label>
            <label className="block text-sm">
              Rechnungsdatum
              <input name="invoiceDate" type="date" className="w-full border rounded px-2 py-1 mt-1" required />
            </label>
            <label className="block text-sm">
              Fälligkeitsdatum
              <input name="dueDate" type="date" className="w-full border rounded px-2 py-1 mt-1" required />
            </label>
            <label className="block text-sm">
              Betrag (EUR)
              <input name="amount" type="number" step="0.01" min="0.01" className="w-full border rounded px-2 py-1 mt-1" required />
            </label>
            <label className="flex items-center gap-2 text-sm col-span-2">
              <input name="isB2B" type="checkbox" defaultChecked />
              B2B (Geschäftskunde)
            </label>
            <div className="col-span-full flex gap-2">
              <Button type="submit" size="sm">Erstellen</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowCreateForm(false)}>Abbrechen</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Table View */}
      {view === "table" && (
        <Tabs defaultValue="debitoren">
          <TabsList>
            <TabsTrigger value="debitoren">Debitoren</TabsTrigger>
            <TabsTrigger value="kreditoren">Kreditoren</TabsTrigger>
          </TabsList>
          <TabsContent value="debitoren">
            <ItemsTable items={items.filter(i => i.type === "debitor")} loading={loading} onPay={handleMarkPaid} onDunning={handleDunning} showDunning />
          </TabsContent>
          <TabsContent value="kreditoren">
            <ItemsTable items={items.filter(i => i.type === "kreditor")} loading={loading} onPay={handleMarkPaid} onDunning={handleDunning} showDunning={false} />
          </TabsContent>
        </Tabs>
      )}

      {/* Aging Report View */}
      {view === "aging" && (
        <Card className="p-6">
          <CardTitle className="mb-4">Fälligkeitsanalyse</CardTitle>
          <div className="space-y-3">
            {aging.map((bucket) => (
              <div key={bucket.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{bucket.label}</span>
                  <span>{bucket.count} Posten &mdash; {formatEur(bucket.totalAmount)}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      bucket.label.includes("90+") ? "bg-red-500"
                        : bucket.label.includes("61") ? "bg-orange-500"
                        : bucket.label.includes("31") ? "bg-yellow-500"
                        : "bg-green-500"
                    }`}
                    style={{ width: `${Math.max(2, (bucket.totalAmount / maxAging) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Saldenliste View */}
      {view === "saldo" && (
        <div className="space-y-4">
          <Card className="p-4">
            <CardTitle className="mb-3 text-base">Debitorensaldenliste</CardTitle>
            <SaldenTable entries={debitSaldo} />
          </Card>
          <Card className="p-4">
            <CardTitle className="mb-3 text-base">Kreditorensaldenliste</CardTitle>
            <SaldenTable entries={kreditSaldo} />
          </Card>
        </div>
      )}
    </div>
  )
}

function ItemsTable({
  items,
  loading,
  onPay,
  onDunning,
  showDunning,
}: {
  items: OpenItemRow[]
  loading: boolean
  onPay: (id: string) => void
  onDunning: (id: string) => void
  showDunning: boolean
}) {
  if (loading) return <p className="text-sm text-muted-foreground p-4">Laden...</p>
  if (items.length === 0) return <p className="text-sm text-muted-foreground p-4">Keine Einträge vorhanden.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">Rechnungs-Nr.</th>
            <th className="p-2">Datum</th>
            <th className="p-2">Fällig</th>
            <th className="p-2">Firma</th>
            <th className="p-2 text-right">Betrag</th>
            <th className="p-2 text-right">Bezahlt</th>
            <th className="p-2 text-right">Offen</th>
            <th className="p-2">Status</th>
            {showDunning && <th className="p-2">Mahnstufe</th>}
            <th className="p-2">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const badge = statusBadge(item.status)
            return (
              <tr key={item.id} className="border-b hover:bg-muted/50">
                <td className="p-2 font-mono">{item.invoiceNumber}</td>
                <td className="p-2">{item.invoiceDate}</td>
                <td className="p-2">{item.dueDate}</td>
                <td className="p-2">{item.merchant}</td>
                <td className="p-2 text-right">{formatEur(item.amount)}</td>
                <td className="p-2 text-right">{formatEur(item.paidAmount)}</td>
                <td className="p-2 text-right font-semibold">{formatEur(item.remainingAmount)}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                </td>
                {showDunning && (
                  <td className="p-2 text-center">
                    {item.dunningLevel > 0 ? `${item.dunningLevel}. Mahnung` : "-"}
                  </td>
                )}
                <td className="p-2">
                  <div className="flex gap-1">
                    {item.status !== "paid" && (
                      <Button variant="outline" size="sm" onClick={() => onPay(item.id)}>
                        Zahlung
                      </Button>
                    )}
                    {showDunning && item.daysPastDue > 0 && item.status !== "paid" && item.dunningLevel < 3 && (
                      <Button variant="outline" size="sm" className="text-orange-600" onClick={() => onDunning(item.id)}>
                        Mahnung
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SaldenTable({ entries }: { entries: SaldenEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Keine Einträge.</p>

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="p-2">Firma</th>
          <th className="p-2 text-right">Offene Posten</th>
          <th className="p-2 text-right">Gesamtbetrag</th>
          <th className="p-2 text-right">Bezahlt</th>
          <th className="p-2 text-right">Saldo</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, idx) => (
          <tr key={idx} className="border-b">
            <td className="p-2">{e.merchant}</td>
            <td className="p-2 text-right">{e.openCount}</td>
            <td className="p-2 text-right">{formatEur(e.totalAmount)}</td>
            <td className="p-2 text-right">{formatEur(e.paidAmount)}</td>
            <td className="p-2 text-right font-semibold">{formatEur(e.remainingAmount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
