"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  PenLine,
  Plus,
  Trash2,
  Copy,
  Lock,
  Save,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Loader2,
  BookTemplate,
} from "lucide-react"
import { SKR04_COMMON_ACCOUNTS } from "@/lib/manual-booking"
import {
  listBookingSessionsAction,
  createBookingSessionAction,
  updateBookingSessionAction,
  deleteBookingSessionAction,
  lockBookingSessionAction,
  listBookingEntriesAction,
  createBookingEntryAction,
  updateBookingEntryAction,
  deleteBookingEntryAction,
  duplicateBookingEntryAction,
  postBookingSessionAction,
  getBookingTemplatesAction,
} from "../actions"

type BookingSession = {
  id: string
  name: string
  description: string | null
  periodMonth: number
  periodYear: number
  status: string
  lockedAt: string | null
  createdAt: string
  entryCount: number
  totalAmount: number
}

type BookingEntry = {
  id: string
  bookingDate: string
  receiptNumber: string | null
  receiptDate: string | null
  description: string
  debitAccount: string
  creditAccount: string
  amount: number
  taxRate: number | null
  taxAmount: number | null
  costCenter: string | null
  merchant: string | null
  notes: string | null
  isTemplate: boolean
  templateName: string | null
  transactionId: string | null
}

type Template = BookingEntry

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
]

const TAX_RATES = [
  { value: "19", label: "19%" },
  { value: "7", label: "7%" },
  { value: "0", label: "0%" },
  { value: "none", label: "Ohne" },
]

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseCentsFromInput(value: string): number {
  // Accept comma or period as decimal separator
  const normalized = value.replace(/\./g, "").replace(",", ".")
  const parsed = parseFloat(normalized)
  if (isNaN(parsed)) return 0
  return Math.round(parsed * 100)
}

function formatDateForInput(dateStr: string | null): string {
  if (!dateStr) return ""
  return dateStr.substring(0, 10)
}

function getAccountLabel(code: string): string {
  const account = SKR04_COMMON_ACCOUNTS.find(a => a.code === code)
  return account ? `${code} - ${account.name}` : code
}

function statusLabel(status: string): string {
  switch (status) {
    case "open": return "Offen"
    case "reviewed": return "Geprüft"
    case "locked": return "Festgeschrieben"
    default: return status
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "open": return "text-green-600"
    case "reviewed": return "text-yellow-600"
    case "locked": return "text-red-600"
    default: return ""
  }
}

const defaultEntry = {
  bookingDate: new Date().toISOString().substring(0, 10),
  receiptNumber: "",
  receiptDate: "",
  description: "",
  debitAccount: "",
  creditAccount: "",
  amount: "",
  taxRate: "19",
  taxAmount: "",
  costCenter: "",
  merchant: "",
  notes: "",
  saveAsTemplate: false,
  templateName: "",
}

export default function BookingMask() {
  const now = new Date()
  const [filterYear, setFilterYear] = useState(now.getFullYear())
  const [filterMonth, setFilterMonth] = useState<number | undefined>(undefined)

  const [sessions, setSessions] = useState<BookingSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [entries, setEntries] = useState<BookingEntry[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [showTemplates, setShowTemplates] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // New session form
  const [showNewSession, setShowNewSession] = useState(false)
  const [newSessionName, setNewSessionName] = useState("")
  const [newSessionDesc, setNewSessionDesc] = useState("")
  const [newSessionMonth, setNewSessionMonth] = useState(now.getMonth() + 1)
  const [newSessionYear, setNewSessionYear] = useState(now.getFullYear())

  // Edit session
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editSessionName, setEditSessionName] = useState("")

  // Booking entry form
  const [form, setForm] = useState({ ...defaultEntry })
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)

  // Account search
  const [debitSearch, setDebitSearch] = useState("")
  const [creditSearch, setCreditSearch] = useState("")
  const [showDebitDropdown, setShowDebitDropdown] = useState(false)
  const [showCreditDropdown, setShowCreditDropdown] = useState(false)

  const selectedSession = sessions.find(s => s.id === selectedSessionId)
  const isSessionLocked = selectedSession?.status === "locked"

  // ─── Data Loading ──────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listBookingSessionsAction(filterYear, filterMonth)
      if (result.success && result.data) {
        setSessions(result.data)
      } else {
        setError(result.error || "Fehler beim Laden der Sitzungen.")
      }
    } catch {
      setError("Fehler beim Laden der Sitzungen.")
    } finally {
      setLoading(false)
    }
  }, [filterYear, filterMonth])

  const loadEntries = useCallback(async (sessionId: string) => {
    try {
      const result = await listBookingEntriesAction(sessionId)
      if (result.success && result.data) {
        setEntries(result.data)
      }
    } catch {
      setError("Fehler beim Laden der Einträge.")
    }
  }, [])

  const loadTemplates = useCallback(async () => {
    try {
      const result = await getBookingTemplatesAction()
      if (result.success && result.data) {
        setTemplates(result.data)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])
  useEffect(() => { loadTemplates() }, [loadTemplates])
  useEffect(() => {
    if (selectedSessionId) loadEntries(selectedSessionId)
    else setEntries([])
  }, [selectedSessionId, loadEntries])

  // Auto-clear messages
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 3000)
      return () => clearTimeout(t)
    }
  }, [successMsg])
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(t)
    }
  }, [error])

  // ─── Session Actions ───────────────────────────────────────

  async function handleCreateSession() {
    if (!newSessionName.trim()) return
    try {
      const result = await createBookingSessionAction({
        name: newSessionName,
        description: newSessionDesc || undefined,
        periodMonth: newSessionMonth,
        periodYear: newSessionYear,
      })
      if (result.success) {
        setShowNewSession(false)
        setNewSessionName("")
        setNewSessionDesc("")
        setSuccessMsg("Sitzung erstellt.")
        await loadSessions()
      } else {
        setError(result.error || "Fehler beim Erstellen.")
      }
    } catch {
      setError("Fehler beim Erstellen der Sitzung.")
    }
  }

  async function handleDeleteSession(id: string) {
    if (!confirm("Buchungssitzung und alle Einträge wirklich löschen?")) return
    try {
      const result = await deleteBookingSessionAction(id)
      if (result.success) {
        if (selectedSessionId === id) {
          setSelectedSessionId(null)
          setEntries([])
        }
        setSuccessMsg("Sitzung gelöscht.")
        await loadSessions()
      } else {
        setError(result.error || "Fehler beim Löschen.")
      }
    } catch {
      setError("Fehler beim Löschen der Sitzung.")
    }
  }

  async function handleLockSession(id: string) {
    if (!confirm("Sitzung wirklich festschreiben? Dies kann nicht rückgängig gemacht werden.")) return
    try {
      const result = await lockBookingSessionAction(id)
      if (result.success) {
        setSuccessMsg("Sitzung festgeschrieben.")
        await loadSessions()
      } else {
        setError(result.error || "Fehler beim Festschreiben.")
      }
    } catch {
      setError("Fehler beim Festschreiben.")
    }
  }

  async function handlePostSession(id: string) {
    if (!confirm("Alle Einträge als Transaktionen verbuchen und Sitzung festschreiben?")) return
    try {
      const result = await postBookingSessionAction(id)
      if (result.success) {
        setSuccessMsg(`${result.data?.transactionCount} Transaktionen erstellt und Sitzung festgeschrieben.`)
        await loadSessions()
        if (selectedSessionId === id) await loadEntries(id)
      } else {
        setError(result.error || "Fehler beim Verbuchen.")
      }
    } catch {
      setError("Fehler beim Verbuchen.")
    }
  }

  async function handleUpdateSessionName(id: string) {
    if (!editSessionName.trim()) return
    try {
      const result = await updateBookingSessionAction(id, { name: editSessionName })
      if (result.success) {
        setEditingSessionId(null)
        await loadSessions()
      } else {
        setError(result.error || "Fehler beim Aktualisieren.")
      }
    } catch {
      setError("Fehler beim Aktualisieren.")
    }
  }

  // ─── Entry Actions ─────────────────────────────────────────

  function calculateAutoTax(amountStr: string, taxRateStr: string): string {
    const cents = parseCentsFromInput(amountStr)
    if (cents <= 0 || taxRateStr === "none") return ""
    const rate = parseFloat(taxRateStr)
    if (isNaN(rate) || rate <= 0) return ""
    const net = cents / (1 + rate / 100)
    const tax = Math.round(cents - net)
    return (tax / 100).toFixed(2).replace(".", ",")
  }

  function handleFormChange(field: string, value: string) {
    const newForm = { ...form, [field]: value }
    // Auto-calculate tax when amount or taxRate changes
    if (field === "amount" || field === "taxRate") {
      const amt = field === "amount" ? value : form.amount
      const rate = field === "taxRate" ? value : form.taxRate
      newForm.taxAmount = calculateAutoTax(amt, rate)
    }
    setForm(newForm)
  }

  async function handleSubmitEntry(andNext: boolean) {
    if (!selectedSessionId) return

    const amountCents = parseCentsFromInput(form.amount)
    if (amountCents <= 0) {
      setError("Betrag muss positiv sein.")
      return
    }
    if (!form.description.trim()) {
      setError("Buchungstext ist erforderlich.")
      return
    }
    if (!form.debitAccount) {
      setError("Sollkonto ist erforderlich.")
      return
    }
    if (!form.creditAccount) {
      setError("Habenkonto ist erforderlich.")
      return
    }

    const taxRate = form.taxRate === "none" ? undefined : parseFloat(form.taxRate)
    const taxAmountCents = form.taxAmount ? parseCentsFromInput(form.taxAmount) : undefined

    const entryData = {
      bookingDate: form.bookingDate,
      receiptNumber: form.receiptNumber || undefined,
      receiptDate: form.receiptDate || undefined,
      description: form.description,
      debitAccount: form.debitAccount,
      creditAccount: form.creditAccount,
      amount: amountCents,
      taxRate,
      taxAmount: taxAmountCents,
      costCenter: form.costCenter || undefined,
      merchant: form.merchant || undefined,
      notes: form.notes || undefined,
      isTemplate: form.saveAsTemplate,
      templateName: form.saveAsTemplate ? form.templateName : undefined,
    }

    try {
      let result
      if (editingEntryId) {
        result = await updateBookingEntryAction(editingEntryId, entryData)
      } else {
        result = await createBookingEntryAction(selectedSessionId, entryData)
      }

      if (result.success) {
        setSuccessMsg(editingEntryId ? "Eintrag aktualisiert." : "Eintrag erstellt.")
        setEditingEntryId(null)
        if (andNext || !editingEntryId) {
          setForm({ ...defaultEntry })
        }
        await loadEntries(selectedSessionId)
        await loadSessions()
        if (form.saveAsTemplate) await loadTemplates()
      } else {
        setError(result.error || "Fehler beim Speichern.")
      }
    } catch {
      setError("Fehler beim Speichern des Eintrags.")
    }
  }

  async function handleDeleteEntry(entryId: string) {
    if (!selectedSessionId) return
    if (!confirm("Buchungseintrag wirklich löschen?")) return
    try {
      const result = await deleteBookingEntryAction(entryId)
      if (result.success) {
        setSuccessMsg("Eintrag gelöscht.")
        await loadEntries(selectedSessionId)
        await loadSessions()
      } else {
        setError(result.error || "Fehler beim Löschen.")
      }
    } catch {
      setError("Fehler beim Löschen.")
    }
  }

  async function handleDuplicateEntry(entryId: string) {
    if (!selectedSessionId) return
    try {
      const result = await duplicateBookingEntryAction(entryId)
      if (result.success) {
        setSuccessMsg("Eintrag dupliziert.")
        await loadEntries(selectedSessionId)
        await loadSessions()
      } else {
        setError(result.error || "Fehler beim Duplizieren.")
      }
    } catch {
      setError("Fehler beim Duplizieren.")
    }
  }

  function handleEditEntry(entry: BookingEntry) {
    setEditingEntryId(entry.id)
    setForm({
      bookingDate: formatDateForInput(entry.bookingDate),
      receiptNumber: entry.receiptNumber || "",
      receiptDate: formatDateForInput(entry.receiptDate),
      description: entry.description,
      debitAccount: entry.debitAccount,
      creditAccount: entry.creditAccount,
      amount: formatCents(entry.amount),
      taxRate: entry.taxRate !== null ? String(entry.taxRate) : "none",
      taxAmount: entry.taxAmount !== null ? formatCents(entry.taxAmount) : "",
      costCenter: entry.costCenter || "",
      merchant: entry.merchant || "",
      notes: entry.notes || "",
      saveAsTemplate: false,
      templateName: "",
    })
  }

  function handleUseTemplate(template: Template) {
    setEditingEntryId(null)
    setForm({
      bookingDate: new Date().toISOString().substring(0, 10),
      receiptNumber: "",
      receiptDate: "",
      description: template.description,
      debitAccount: template.debitAccount,
      creditAccount: template.creditAccount,
      amount: formatCents(template.amount),
      taxRate: template.taxRate !== null ? String(template.taxRate) : "none",
      taxAmount: template.taxAmount !== null ? formatCents(template.taxAmount) : "",
      costCenter: template.costCenter || "",
      merchant: template.merchant || "",
      notes: template.notes || "",
      saveAsTemplate: false,
      templateName: "",
    })
  }

  // Quick booking presets
  function applyQuickBooking(preset: "bank_erloese" | "aufwand_bank" | "vorsteuer") {
    setEditingEntryId(null)
    const base = { ...defaultEntry }
    switch (preset) {
      case "bank_erloese":
        base.debitAccount = "1800"
        base.creditAccount = "4400"
        base.taxRate = "19"
        base.description = "Erlös"
        break
      case "aufwand_bank":
        base.debitAccount = "6815"
        base.creditAccount = "1800"
        base.taxRate = "19"
        base.description = "Betriebsausgabe"
        break
      case "vorsteuer":
        base.debitAccount = "1576"
        base.creditAccount = "1800"
        base.taxRate = "19"
        base.description = "Vorsteuer-Buchung"
        break
    }
    setForm(base)
  }

  // Totals
  const debitTotal = entries.reduce((sum, e) => sum + e.amount, 0)
  const creditTotal = entries.reduce((sum, e) => sum + e.amount, 0)
  const difference = debitTotal - creditTotal

  // Account dropdown filter
  const filteredDebitAccounts = SKR04_COMMON_ACCOUNTS.filter(a =>
    debitSearch === "" || a.code.includes(debitSearch) || a.name.toLowerCase().includes(debitSearch.toLowerCase())
  )
  const filteredCreditAccounts = SKR04_COMMON_ACCOUNTS.filter(a =>
    creditSearch === "" || a.code.includes(creditSearch) || a.name.toLowerCase().includes(creditSearch.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Error/Success Messages */}
      {error && (
        <Card className="p-3 border-destructive bg-destructive/10">
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </p>
        </Card>
      )}
      {successMsg && (
        <Card className="p-3 border-green-500 bg-green-50 dark:bg-green-950">
          <p className="text-sm text-green-700 dark:text-green-300">{successMsg}</p>
        </Card>
      )}

      {/* ─── Session Management ─────────────────────────────── */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <CardTitle className="flex items-center gap-2">
            <PenLine className="w-5 h-5" />
            Buchungssitzungen
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={String(filterYear)} onValueChange={v => setFilterYear(Number(v))}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026, 2027].map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filterMonth !== undefined ? String(filterMonth) : "all"}
              onValueChange={v => setFilterMonth(v === "all" ? undefined : Number(v))}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Monate</SelectItem>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setShowNewSession(!showNewSession)}>
              <Plus className="w-4 h-4 mr-1" /> Neue Sitzung
            </Button>
          </div>
        </div>

        {/* New session form */}
        {showNewSession && (
          <Card className="p-4 mb-4 bg-muted/50">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={newSessionName}
                  onChange={e => setNewSessionName(e.target.value)}
                  placeholder="z.B. Buchungssitzung März 2026"
                />
              </div>
              <div>
                <Label>Beschreibung</Label>
                <Input
                  value={newSessionDesc}
                  onChange={e => setNewSessionDesc(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label>Monat</Label>
                <Select value={String(newSessionMonth)} onValueChange={v => setNewSessionMonth(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Jahr</Label>
                <Select value={String(newSessionYear)} onValueChange={v => setNewSessionYear(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={handleCreateSession}>Erstellen</Button>
              <Button size="sm" variant="outline" onClick={() => setShowNewSession(false)}>Abbrechen</Button>
            </div>
          </Card>
        )}

        {/* Session list */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Keine Buchungssitzungen vorhanden. Erstelle eine neue Sitzung um loszulegen.
          </p>
        ) : (
          <div className="space-y-2">
            {sessions.map(session => (
              <div
                key={session.id}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedSessionId === session.id
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => setSelectedSessionId(selectedSessionId === session.id ? null : session.id)}
              >
                <div className="flex items-center gap-3">
                  {selectedSessionId === session.id ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  <div>
                    {editingSessionId === session.id ? (
                      <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                        <Input
                          value={editSessionName}
                          onChange={e => setEditSessionName(e.target.value)}
                          className="h-7 text-sm"
                          onKeyDown={e => {
                            if (e.key === "Enter") handleUpdateSessionName(session.id)
                            if (e.key === "Escape") setEditingSessionId(null)
                          }}
                        />
                        <Button size="sm" variant="ghost" onClick={() => handleUpdateSessionName(session.id)}>
                          <Save className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <span className="font-medium text-sm">{session.name}</span>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{MONTHS[session.periodMonth - 1]} {session.periodYear}</span>
                      <span className={statusColor(session.status)}>{statusLabel(session.status)}</span>
                      <span>{session.entryCount} Einträge</span>
                      <span>{formatCents(session.totalAmount)} EUR</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  {session.status !== "locked" && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingSessionId(session.id)
                          setEditSessionName(session.name)
                        }}
                        title="Bearbeiten"
                      >
                        <PenLine className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handlePostSession(session.id)}
                        title="Verbuchen & Festschreiben"
                      >
                        <Save className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleLockSession(session.id)}
                        title="Festschreiben"
                      >
                        <Lock className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteSession(session.id)}
                        title="Löschen"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </>
                  )}
                  {session.status === "locked" && (
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ─── Booking Entry Form ─────────────────────────────── */}
      {selectedSessionId && !isSessionLocked && (
        <Card className="p-6">
          <CardTitle className="mb-4 text-base">
            {editingEntryId ? "Eintrag bearbeiten" : "Neuer Buchungseintrag"}
          </CardTitle>

          {/* Quick booking buttons */}
          <div className="flex gap-2 mb-4">
            <Button size="sm" variant="outline" onClick={() => applyQuickBooking("bank_erloese")}>
              Bank an Erlöse
            </Button>
            <Button size="sm" variant="outline" onClick={() => applyQuickBooking("aufwand_bank")}>
              Aufwand an Bank
            </Button>
            <Button size="sm" variant="outline" onClick={() => applyQuickBooking("vorsteuer")}>
              Vorsteuer-Buchung
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Buchungsdatum */}
            <div>
              <Label>Buchungsdatum</Label>
              <Input
                type="date"
                value={form.bookingDate}
                onChange={e => handleFormChange("bookingDate", e.target.value)}
              />
            </div>

            {/* Belegnummer */}
            <div>
              <Label>Belegnummer</Label>
              <Input
                value={form.receiptNumber}
                onChange={e => handleFormChange("receiptNumber", e.target.value)}
                placeholder="z.B. RE-2026-001"
              />
            </div>

            {/* Belegdatum */}
            <div>
              <Label>Belegdatum</Label>
              <Input
                type="date"
                value={form.receiptDate}
                onChange={e => handleFormChange("receiptDate", e.target.value)}
              />
            </div>

            {/* Buchungstext */}
            <div>
              <Label>Buchungstext</Label>
              <Input
                value={form.description}
                onChange={e => handleFormChange("description", e.target.value)}
                placeholder="Beschreibung der Buchung"
              />
            </div>

            {/* Sollkonto */}
            <div className="relative">
              <Label>Sollkonto</Label>
              <Input
                value={form.debitAccount ? getAccountLabel(form.debitAccount) : debitSearch}
                onChange={e => {
                  setDebitSearch(e.target.value)
                  handleFormChange("debitAccount", "")
                  setShowDebitDropdown(true)
                }}
                onFocus={() => setShowDebitDropdown(true)}
                onBlur={() => setTimeout(() => setShowDebitDropdown(false), 200)}
                placeholder="Konto suchen..."
              />
              {showDebitDropdown && filteredDebitAccounts.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-md max-h-48 overflow-auto">
                  {filteredDebitAccounts.map(a => (
                    <div
                      key={a.code}
                      className="px-3 py-1.5 text-sm cursor-pointer hover:bg-muted"
                      onMouseDown={() => {
                        handleFormChange("debitAccount", a.code)
                        setDebitSearch("")
                        setShowDebitDropdown(false)
                      }}
                    >
                      {a.code} - {a.name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Habenkonto */}
            <div className="relative">
              <Label>Habenkonto</Label>
              <Input
                value={form.creditAccount ? getAccountLabel(form.creditAccount) : creditSearch}
                onChange={e => {
                  setCreditSearch(e.target.value)
                  handleFormChange("creditAccount", "")
                  setShowCreditDropdown(true)
                }}
                onFocus={() => setShowCreditDropdown(true)}
                onBlur={() => setTimeout(() => setShowCreditDropdown(false), 200)}
                placeholder="Konto suchen..."
              />
              {showCreditDropdown && filteredCreditAccounts.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-md max-h-48 overflow-auto">
                  {filteredCreditAccounts.map(a => (
                    <div
                      key={a.code}
                      className="px-3 py-1.5 text-sm cursor-pointer hover:bg-muted"
                      onMouseDown={() => {
                        handleFormChange("creditAccount", a.code)
                        setCreditSearch("")
                        setShowCreditDropdown(false)
                      }}
                    >
                      {a.code} - {a.name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Betrag */}
            <div>
              <Label>Betrag (EUR)</Label>
              <Input
                value={form.amount}
                onChange={e => handleFormChange("amount", e.target.value)}
                placeholder="0,00"
              />
            </div>

            {/* USt-Satz */}
            <div>
              <Label>USt-Satz</Label>
              <Select value={form.taxRate} onValueChange={v => handleFormChange("taxRate", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TAX_RATES.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* USt-Betrag */}
            <div>
              <Label>USt-Betrag (EUR)</Label>
              <Input
                value={form.taxAmount}
                onChange={e => handleFormChange("taxAmount", e.target.value)}
                placeholder="auto"
              />
            </div>

            {/* Kostenstelle */}
            <div>
              <Label>Kostenstelle</Label>
              <Input
                value={form.costCenter}
                onChange={e => handleFormChange("costCenter", e.target.value)}
                placeholder="Optional"
              />
            </div>

            {/* Händler */}
            <div>
              <Label>Händler/Lieferant</Label>
              <Input
                value={form.merchant}
                onChange={e => handleFormChange("merchant", e.target.value)}
                placeholder="Optional"
              />
            </div>

            {/* Notizen */}
            <div>
              <Label>Notizen</Label>
              <Input
                value={form.notes}
                onChange={e => handleFormChange("notes", e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          {/* Template checkbox */}
          <div className="flex items-center gap-3 mt-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.saveAsTemplate}
                onChange={e => setForm({ ...form, saveAsTemplate: e.target.checked })}
              />
              Als Vorlage speichern
            </label>
            {form.saveAsTemplate && (
              <Input
                value={form.templateName}
                onChange={e => setForm({ ...form, templateName: e.target.value })}
                placeholder="Vorlagenname"
                className="w-64"
              />
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 mt-4">
            <Button onClick={() => handleSubmitEntry(false)}>
              {editingEntryId ? "Speichern" : "Buchen"}
            </Button>
            {!editingEntryId && (
              <Button variant="outline" onClick={() => handleSubmitEntry(true)}>
                Buchen & Nächste
              </Button>
            )}
            {editingEntryId && (
              <Button variant="outline" onClick={() => { setEditingEntryId(null); setForm({ ...defaultEntry }) }}>
                Abbrechen
              </Button>
            )}
          </div>
        </Card>
      )}

      {isSessionLocked && selectedSessionId && (
        <Card className="p-4 bg-muted/50">
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Lock className="w-4 h-4" />
            Diese Sitzung ist festgeschrieben. Einträge können nicht mehr bearbeitet werden.
          </p>
        </Card>
      )}

      {/* ─── Entry List ─────────────────────────────────────── */}
      {selectedSessionId && entries.length > 0 && (
        <Card className="p-6">
          <CardTitle className="mb-4 text-base">
            Buchungseinträge ({entries.length})
          </CardTitle>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Beleg-Nr</TableHead>
                  <TableHead>Buchungstext</TableHead>
                  <TableHead>Soll</TableHead>
                  <TableHead>Haben</TableHead>
                  <TableHead className="text-right">Betrag</TableHead>
                  <TableHead className="text-right">USt</TableHead>
                  <TableHead>KSt</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(entry => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm">{formatDateForInput(entry.bookingDate)}</TableCell>
                    <TableCell className="text-sm">{entry.receiptNumber || "-"}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{entry.description}</TableCell>
                    <TableCell className="text-sm">{getAccountLabel(entry.debitAccount)}</TableCell>
                    <TableCell className="text-sm">{getAccountLabel(entry.creditAccount)}</TableCell>
                    <TableCell className="text-sm text-right">{formatCents(entry.amount)}</TableCell>
                    <TableCell className="text-sm text-right">
                      {entry.taxAmount !== null ? formatCents(entry.taxAmount) : "-"}
                    </TableCell>
                    <TableCell className="text-sm">{entry.costCenter || "-"}</TableCell>
                    <TableCell className="text-right">
                      {!isSessionLocked && (
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => handleEditEntry(entry)} title="Bearbeiten">
                            <PenLine className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDuplicateEntry(entry.id)} title="Duplizieren">
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteEntry(entry.id)} title="Löschen">
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Totals */}
          <div className="flex items-center justify-end gap-6 mt-4 pt-3 border-t text-sm">
            <span>Soll-Summe: <strong>{formatCents(debitTotal)} EUR</strong></span>
            <span>Haben-Summe: <strong>{formatCents(creditTotal)} EUR</strong></span>
            {difference !== 0 && (
              <span className="text-destructive flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Differenz: {formatCents(Math.abs(difference))} EUR
              </span>
            )}
          </div>
        </Card>
      )}

      {/* ─── Templates Sidebar ──────────────────────────────── */}
      {selectedSessionId && !isSessionLocked && (
        <Card className="p-4">
          <button
            className="flex items-center gap-2 text-sm font-medium w-full text-left"
            onClick={() => setShowTemplates(!showTemplates)}
          >
            <BookTemplate className="w-4 h-4" />
            Buchungsvorlagen ({templates.length})
            {showTemplates ? <ChevronDown className="w-4 h-4 ml-auto" /> : <ChevronRight className="w-4 h-4 ml-auto" />}
          </button>
          {showTemplates && (
            <div className="mt-3 space-y-2">
              {templates.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Noch keine Vorlagen gespeichert. Aktiviere &quot;Als Vorlage speichern&quot; beim Buchen.
                </p>
              ) : (
                templates.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-2 rounded border text-sm">
                    <button className="text-left flex-1" onClick={() => handleUseTemplate(t)}>
                      <span className="font-medium">{t.templateName || t.description}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {t.debitAccount} an {t.creditAccount} | {formatCents(t.amount)} EUR
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteEntry(t.id)}
                      title="Vorlage löschen"
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
