"use client"

import { useState, useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { FormInput } from "@/components/forms/simple"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  addBankAccountAction,
  syncBankAccountAction,
  deleteBankAccountAction,
  submitTanAction,
  lookupBankAction,
} from "../actions"
import { RefreshCw, Trash2, Plus, Building2, AlertCircle, CheckCircle2, Link2, Shield, FileSpreadsheet, Calculator, Settings, Repeat, BookOpen, Receipt, FileText, TrendingUp, Link, Database, BarChart3, FileOutput } from "lucide-react"
import ReconciliationPanel from "./reconciliation-panel"
import ReceiptMatchingPanel from "./receipt-matching-panel"
import AuditLogPanel from "./audit-log-panel"
import DatevExportPanel from "./datev-export-panel"
import UStPanel from "./ust-panel"
import EUERPanel from "./euer-panel"
import RecurringPanel from "./recurring-panel"
import InflationPanel from "./inflation-panel"
import StatsOverview from "./stats-overview"
import SyncSettings from "./sync-settings"
import InvoiceForm from "./invoice-form"
import ERPNextPanel from "./erpnext-panel"
import SagePanel from "./sage-panel"
import BWAPanel from "./bwa-panel"
import AnlagenPanel from "./anlagen-panel"

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

  return (
    <div className="space-y-6">
      {/* TAN Dialog */}
      {tanState && (
        <Card className="p-6 border-orange-500 bg-orange-50 dark:bg-orange-950">
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
        <Card className="p-4 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <span className="text-sm">{syncResult}</span>
          <Button variant="ghost" size="sm" onClick={() => setSyncResult(null)} className="ml-auto">
            Schließen
          </Button>
        </Card>
      )}

      {/* Stats Overview */}
      <StatsOverview />

      {/* Tabs */}
      <Tabs defaultValue="accounts">
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="accounts" className="flex items-center gap-1.5">
            <Building2 className="w-4 h-4" />
            <span className="hidden sm:inline">Konten</span>
          </TabsTrigger>
          <TabsTrigger value="recurring" className="flex items-center gap-1.5">
            <Repeat className="w-4 h-4" />
            <span className="hidden sm:inline">Daueraufträge</span>
          </TabsTrigger>
          <TabsTrigger value="receipts" className="flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Belege</span>
          </TabsTrigger>
          <TabsTrigger value="reconciliation" className="flex items-center gap-1.5">
            <Link2 className="w-4 h-4" />
            <span className="hidden sm:inline">Abgleich</span>
          </TabsTrigger>
          <TabsTrigger value="invoices" className="flex items-center gap-1.5">
            <Receipt className="w-4 h-4" />
            <span className="hidden sm:inline">Rechnungen</span>
          </TabsTrigger>
          <TabsTrigger value="datev" className="flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4" />
            <span className="hidden sm:inline">DATEV</span>
          </TabsTrigger>
          <TabsTrigger value="ust" className="flex items-center gap-1.5">
            <Calculator className="w-4 h-4" />
            <span className="hidden sm:inline">USt</span>
          </TabsTrigger>
          <TabsTrigger value="euer" className="flex items-center gap-1.5">
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">EÜR</span>
          </TabsTrigger>
          <TabsTrigger value="sync-settings" className="flex items-center gap-1.5">
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">Auto-Sync</span>
          </TabsTrigger>
          <TabsTrigger value="inflation" className="flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">Inflation</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-1.5">
            <Shield className="w-4 h-4" />
            <span className="hidden sm:inline">Audit-Log</span>
          </TabsTrigger>
          <TabsTrigger value="erpnext" className="flex items-center gap-1.5">
            <Link className="w-4 h-4" />
            <span className="hidden sm:inline">ERPNext</span>
          </TabsTrigger>
          <TabsTrigger value="sage" className="flex items-center gap-1.5">
            <FileOutput className="w-4 h-4" />
            <span className="hidden sm:inline">Sage</span>
          </TabsTrigger>
          <TabsTrigger value="bwa" className="flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">BWA</span>
          </TabsTrigger>
          <TabsTrigger value="anlagen" className="flex items-center gap-1.5">
            <Building2 className="w-4 h-4" />
            <span className="hidden sm:inline">Anlagen</span>
          </TabsTrigger>
        </TabsList>

        {/* Accounts Tab */}
        <TabsContent value="accounts">
          <div className="space-y-4">
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
                <p>Noch kein Bankkonto verbunden.</p>
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
        </TabsContent>

        {/* Recurring Transactions Tab */}
        <TabsContent value="recurring">
          <RecurringPanel />
        </TabsContent>

        {/* Receipt Matching Tab */}
        <TabsContent value="receipts">
          <ReceiptMatchingPanel />
        </TabsContent>

        {/* Reconciliation Tab */}
        <TabsContent value="reconciliation">
          <ReconciliationPanel />
        </TabsContent>

        {/* DATEV Export Tab */}
        <TabsContent value="datev">
          <DatevExportPanel />
        </TabsContent>

        {/* USt-Voranmeldung Tab */}
        <TabsContent value="ust">
          <UStPanel />
        </TabsContent>

        {/* EUeR Tab */}
        <TabsContent value="euer">
          <EUERPanel />
        </TabsContent>

        {/* Sync Settings Tab */}
        <TabsContent value="sync-settings">
          <SyncSettings />
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices">
          <InvoiceForm userProfile={userProfile ?? {}} />
        </TabsContent>

        {/* Audit Log Tab */}
        {/* Inflation Tab */}
        <TabsContent value="inflation">
          <InflationPanel />
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit">
          <AuditLogPanel />
        </TabsContent>

        {/* ERPNext Tab */}
        <TabsContent value="erpnext">
          <ERPNextPanel />
        </TabsContent>

        {/* Sage Tab */}
        <TabsContent value="sage">
          <SagePanel />
        </TabsContent>

        {/* BWA Tab */}
        <TabsContent value="bwa">
          <BWAPanel />
        </TabsContent>

        {/* Anlagen Tab */}
        <TabsContent value="anlagen">
          <AnlagenPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
