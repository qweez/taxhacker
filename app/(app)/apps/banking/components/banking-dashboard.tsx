"use client"

import { useState, useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { FormInput } from "@/components/forms/simple"
import {
  addBankAccountAction,
  syncBankAccountAction,
  deleteBankAccountAction,
  submitTanAction,
  lookupBankAction,
} from "../actions"
import { RefreshCw, Trash2, Plus, Building2, AlertCircle, CheckCircle2 } from "lucide-react"
import ReconciliationPanel from "./reconciliation-panel"
import ReceiptMatchingPanel from "./receipt-matching-panel"
import AuditLogPanel from "./audit-log-panel"
import DatevExportPanel from "./datev-export-panel"
import UStPanel from "./ust-panel"
import EUERPanel from "./euer-panel"
import RecurringPanel from "./recurring-panel"
import InflationPanel from "./inflation-panel"
import SyncSettings from "./sync-settings"
import InvoiceForm from "./invoice-form"
import ERPNextPanel from "./erpnext-panel"
import SagePanel from "./sage-panel"
import BWAPanel from "./bwa-panel"
import AnlagenPanel from "./anlagen-panel"
import SidebarNav, { type SidebarSection } from "./sidebar-nav"
import DashboardOverview from "./dashboard-overview"
import QuickActionsBar from "./quick-actions-bar"

type SafeBankAccount = {
  id: string
  bankCode: string
  bankName: string | null
  accountNumber: string
  iban: string | null
  bic: string | null
  fintsUrl: string
  lastSyncAt: string | null
  lastSyncStatus: string | null
  isActive: boolean
}

type UserProfile = {
  businessName?: string | null
  businessAddress?: string | null
  businessBankDetails?: string | null
  businessLogo?: string | null
}

export default function BankingDashboard({ accounts: initialAccounts, userProfile }: { accounts: SafeBankAccount[]; userProfile?: UserProfile }) {
  const [accounts, setAccounts] = useState(initialAccounts)
  const [showAddForm, setShowAddForm] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [tanState, setTanState] = useState<{
    bankAccountId: string
    tanChallenge: string
    tanReference: string
  } | null>(null)
  const [tanInput, setTanInput] = useState("")
  const [blzValue, setBlzValue] = useState("")
  const [bankNameValue, setBankNameValue] = useState("")
  const [fintsUrlValue, setFintsUrlValue] = useState("")
  const [blzLookedUp, setBlzLookedUp] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<SidebarSection>("overview")

  const [addState, addAction, addPending] = useActionState(addBankAccountAction, null)

  async function handleBlzChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setBlzValue(val)
    if (/^\d{8}$/.test(val) && val !== blzLookedUp) {
      setBlzLookedUp(val)
      const result = await lookupBankAction(val)
      if (result.success && result.data) {
        setBankNameValue(result.data.bankName)
        setFintsUrlValue(result.data.fintsUrl)
      }
    }
  }

  async function handleSync(accountId: string) {
    setSyncingId(accountId)
    setSyncResult(null)
    try {
      const result = await syncBankAccountAction(accountId)
      if (result.success && result.data?.requiresTan) {
        setTanState({
          bankAccountId: accountId,
          tanChallenge: result.data.tanChallenge,
          tanReference: result.data.tanReference,
        })
      } else if (result.success) {
        setSyncResult(`Importiert: ${result.data.imported}, Übersprungen: ${result.data.skipped}`)
      } else {
        setSyncResult(`Fehler: ${result.error}`)
      }
    } finally {
      setSyncingId(null)
    }
  }

  async function handleTanSubmit() {
    if (!tanState) return
    const result = await submitTanAction(tanState.bankAccountId, tanState.tanReference, tanInput)
    if (result.success && !result.data?.requiresTan) {
      setTanState(null)
      setTanInput("")
      handleSync(tanState.bankAccountId)
    } else if (!result.success) {
      setSyncResult(`TAN Fehler: ${result.error}`)
      setTanState(null)
    }
  }

  async function handleDelete(accountId: string) {
    if (!confirm("Bankkonto wirklich löschen? Importierte Transaktionen bleiben erhalten.")) return
    await deleteBankAccountAction(accountId)
    setAccounts(prev => prev.filter(a => a.id !== accountId))
  }

  function handleNavigate(section: SidebarSection) {
    setActiveSection(section)
  }

  function renderAccountsPanel() {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Bankkonten</h2>
            <p className="text-sm text-muted-foreground">
              Verwalte deine Bankkonten und synchronisiere Umsätze via FinTS.
            </p>
          </div>
          {!showAddForm && (
            <Button onClick={() => setShowAddForm(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" /> Bankkonto verbinden
            </Button>
          )}
        </div>

        {accounts.map(account => (
          <Card key={account.id} className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="w-8 h-8 text-muted-foreground" />
                <div>
                  <h3 className="font-semibold">{account.bankName || `BLZ ${account.bankCode}`}</h3>
                  <p className="text-sm text-muted-foreground">
                    {account.iban || account.accountNumber}
                  </p>
                  {account.lastSyncAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Letzter Sync: {new Date(account.lastSyncAt).toLocaleString("de-DE")}
                      {account.lastSyncStatus && ` — ${account.lastSyncStatus}`}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSync(account.id)}
                  disabled={syncingId === account.id}
                >
                  <RefreshCw className={`w-4 h-4 mr-1 ${syncingId === account.id ? "animate-spin" : ""}`} />
                  {syncingId === account.id ? "Sync..." : "Sync"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(account.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          </Card>
        ))}

        {accounts.length === 0 && !showAddForm && (
          <Card className="p-8 text-center text-muted-foreground">
            <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium">Noch kein Bankkonto verbunden.</p>
            <p className="text-sm mt-1">Verbinde dein Bankkonto via FinTS um Umsätze automatisch zu importieren.</p>
          </Card>
        )}

        {showAddForm ? (
          <Card className="p-6">
            <CardTitle className="mb-4">Neues Bankkonto verbinden</CardTitle>
            <form action={addAction} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormInput title="BLZ (Bankleitzahl)" name="bankCode" required value={blzValue} onChange={handleBlzChange} maxLength={8} />
                <FormInput title="Bankname" name="bankName" value={bankNameValue} onChange={(e) => setBankNameValue(e.target.value)} />
                <FormInput title="FinTS URL" name="fintsUrl" placeholder="https://banking-xx.s-fints-pt-xx.de/fints30" required value={fintsUrlValue} onChange={(e) => setFintsUrlValue(e.target.value)} />
                <FormInput title="IBAN" name="iban" />
                <FormInput title="Benutzername (Online-Banking)" name="fintsUser" required />
                <FormInput title="PIN" name="fintsPin" type="password" required />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={addPending}>
                  {addPending ? "Verbinde..." : "Verbinden & Testen"}
                </Button>
                <Button variant="outline" type="button" onClick={() => setShowAddForm(false)}>
                  Abbrechen
                </Button>
              </div>
              {addState?.error && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {addState.error}
                </p>
              )}
              {addState?.success && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  Bankkonto verbunden!
                </p>
              )}
            </form>
          </Card>
        ) : (
          <Button onClick={() => setShowAddForm(true)}>
            <Plus className="w-4 h-4 mr-1" /> Bankkonto verbinden
          </Button>
        )}
      </div>
    )
  }

  function renderContent() {
    switch (activeSection) {
      case "overview":
        return <DashboardOverview onNavigate={handleNavigate} />
      case "accounts":
        return renderAccountsPanel()
      case "recurring":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Daueraufträge</h2>
              <p className="text-sm text-muted-foreground">
                Wiederkehrende Zahlungen erkennen und verwalten.
              </p>
            </div>
            <RecurringPanel />
          </div>
        )
      case "receipts":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Belege zuordnen</h2>
              <p className="text-sm text-muted-foreground">
                Belege automatisch zu Bank-Transaktionen zuordnen.
              </p>
            </div>
            <ReceiptMatchingPanel />
          </div>
        )
      case "reconciliation":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Abgleich</h2>
              <p className="text-sm text-muted-foreground">
                Bank-Transaktionen mit manuellen Buchungen abgleichen.
              </p>
            </div>
            <ReconciliationPanel />
          </div>
        )
      case "invoices":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Rechnungen erstellen</h2>
              <p className="text-sm text-muted-foreground">
                PDF, XRechnung und ZUGFeRD Rechnungen erstellen und verwalten.
              </p>
            </div>
            <InvoiceForm userProfile={userProfile ?? {}} />
          </div>
        )
      case "datev":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">DATEV Export</h2>
              <p className="text-sm text-muted-foreground">
                Buchungsdaten im DATEV EXTF-Format exportieren.
              </p>
            </div>
            <DatevExportPanel />
          </div>
        )
      case "ust":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">USt-Voranmeldung</h2>
              <p className="text-sm text-muted-foreground">
                Umsatzsteuer-Voranmeldung berechnen und vorbereiten.
              </p>
            </div>
            <UStPanel />
          </div>
        )
      case "euer":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Einnahmenüberschussrechnung</h2>
              <p className="text-sm text-muted-foreground">
                Anlage EÜR für Kleinunternehmer und Freiberufler berechnen.
              </p>
            </div>
            <EUERPanel />
          </div>
        )
      case "bwa":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Betriebswirtschaftliche Auswertung</h2>
              <p className="text-sm text-muted-foreground">
                Monatliche BWA nach DATEV-Standard erstellen.
              </p>
            </div>
            <BWAPanel />
          </div>
        )
      case "anlagen":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Anlagenspiegel</h2>
              <p className="text-sm text-muted-foreground">
                Anlagegüter und Abschreibungen verwalten.
              </p>
            </div>
            <AnlagenPanel />
          </div>
        )
      case "sync-settings":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Auto-Sync & Telegram</h2>
              <p className="text-sm text-muted-foreground">
                Automatische Synchronisierung und Telegram-Bot konfigurieren.
              </p>
            </div>
            <SyncSettings />
          </div>
        )
      case "inflation":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Inflationsanpassung</h2>
              <p className="text-sm text-muted-foreground">
                Wiederkehrende Kosten auf Inflationseffekte prüfen.
              </p>
            </div>
            <InflationPanel />
          </div>
        )
      case "audit":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Audit-Log</h2>
              <p className="text-sm text-muted-foreground">
                Protokoll aller Aktionen und Änderungen.
              </p>
            </div>
            <AuditLogPanel />
          </div>
        )
      case "erpnext":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">ERPNext Integration</h2>
              <p className="text-sm text-muted-foreground">
                Buchungen und Stammdaten mit ERPNext synchronisieren.
              </p>
            </div>
            <ERPNextPanel />
          </div>
        )
      case "sage":
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Sage Export</h2>
              <p className="text-sm text-muted-foreground">
                Daten im Sage Warenwirtschaft 7.1 Format exportieren.
              </p>
            </div>
            <SagePanel />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex h-[calc(100vh-60px)] md:h-screen overflow-hidden">
      {/* Sidebar Navigation */}
      <SidebarNav activeSection={activeSection} onSelect={handleNavigate} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Quick Actions Bar */}
        <QuickActionsBar onNavigate={handleNavigate} />

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 max-w-6xl">
            {/* TAN Dialog */}
            {tanState && (
              <Card className="p-6 border-orange-500 bg-orange-50 dark:bg-orange-950 mb-6">
                <CardTitle className="flex items-center gap-2 mb-4">
                  <AlertCircle className="w-5 h-5 text-orange-500" />
                  TAN erforderlich
                </CardTitle>
                <p className="mb-4 text-sm">{tanState.tanChallenge}</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tanInput}
                    onChange={e => setTanInput(e.target.value)}
                    placeholder="TAN eingeben"
                    className="flex-1 border rounded px-3 py-2"
                  />
                  <Button onClick={handleTanSubmit}>Bestätigen</Button>
                  <Button variant="outline" onClick={() => { setTanState(null); setTanInput("") }}>
                    Abbrechen
                  </Button>
                </div>
              </Card>
            )}

            {/* Sync result */}
            {syncResult && (
              <Card className="p-4 flex items-center gap-2 mb-6">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-sm">{syncResult}</span>
                <Button variant="ghost" size="sm" onClick={() => setSyncResult(null)} className="ml-auto">
                  Schließen
                </Button>
              </Card>
            )}

            {/* Active Panel Content */}
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  )
}
