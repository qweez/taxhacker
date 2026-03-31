"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getAuditLogsAction, listBankAccountsAction, toggleAutoSyncAction, getTelegramStatusAction, setupTelegramWebhookAction } from "../actions"
import { Settings, Clock, CheckCircle2, XCircle, RefreshCw, Eye, EyeOff, Send, Bot } from "lucide-react"

type SyncAuditEntry = {
  id: string
  action: string
  target: string | null
  details: any
  createdAt: string
}

type BankAccountInfo = {
  id: string
  bankName: string | null
  iban: string | null
  accountNumber: string
  isActive: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
}

type TelegramStatus = {
  configured: boolean
  botToken: boolean
  chatId: boolean
  webhookSecret: boolean
  webhookUrl: string
}

export default function SyncSettings() {
  const [accounts, setAccounts] = useState<BankAccountInfo[]>([])
  const [syncLogs, setSyncLogs] = useState<SyncAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showSecret, setShowSecret] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null)
  const [telegramSetupLoading, setTelegramSetupLoading] = useState(false)
  const [telegramSetupResult, setTelegramSetupResult] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [accountsResult, logsResult] = await Promise.all([
      listBankAccountsAction(),
      getAuditLogsAction(),
    ])

    if (accountsResult.success && accountsResult.data) {
      setAccounts(accountsResult.data)
    }

    if (logsResult.success && logsResult.data) {
      const cronLogs = logsResult.data
        .filter((l: SyncAuditEntry) =>
          l.action === "bank_account.cron_sync" || l.action === "bank_account.sync"
        )
        .slice(0, 5)
      setSyncLogs(cronLogs)
    }

    const telegramResult = await getTelegramStatusAction()
    if (telegramResult.success && telegramResult.data) {
      setTelegramStatus(telegramResult.data)
    }

    setLoading(false)
  }

  async function handleSetupTelegramWebhook() {
    setTelegramSetupLoading(true)
    setTelegramSetupResult(null)
    const result = await setupTelegramWebhookAction()
    if (result.success) {
      setTelegramSetupResult("Webhook erfolgreich eingerichtet!")
    } else {
      setTelegramSetupResult(`Fehler: ${result.error}`)
    }
    setTelegramSetupLoading(false)
  }

  async function handleToggleAutoSync(accountId: string, currentlyActive: boolean) {
    setTogglingId(accountId)
    const result = await toggleAutoSyncAction(accountId, !currentlyActive)
    if (result.success) {
      setAccounts(prev =>
        prev.map(a => a.id === accountId ? { ...a, isActive: !currentlyActive } : a)
      )
    }
    setTogglingId(null)
  }

  const cronUrl = "/api/cron/fints-sync"
  const maskedSecret = "****"
  const displaySecret = showSecret ? "YOUR_CRON_SECRET" : maskedSecret

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Lade Sync-Einstellungen...</div>
  }

  return (
    <div className="space-y-6">
      {/* Cron URL Info */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Automatische Synchronisierung
        </h3>

        <div className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Cron-Endpunkt fuer automatische Bank-Synchronisierung:
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-muted px-3 py-2 rounded text-sm flex-1 overflow-x-auto">
                curl -H &quot;Authorization: Bearer {displaySecret}&quot; {cronUrl}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSecret(!showSecret)}
                title={showSecret ? "Secret verbergen" : "Secret anzeigen"}
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Setze die Umgebungsvariable <code className="bg-muted px-1 rounded">CRON_SECRET</code> und
            richte einen Cron-Job ein (z.B. alle 6 Stunden: <code className="bg-muted px-1 rounded">0 6,12,18 * * *</code>).
          </p>
        </div>
      </Card>

      {/* Per-account auto-sync toggle */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <RefreshCw className="w-5 h-5" />
          Konten fuer Auto-Sync
        </h3>

        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Bankkonten vorhanden.</p>
        ) : (
          <div className="space-y-3">
            {accounts.map(account => (
              <div
                key={account.id}
                className="flex items-center justify-between p-3 rounded-lg border"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {account.bankName || account.accountNumber}
                    </span>
                    {account.iban && (
                      <span className="text-xs text-muted-foreground">
                        {account.iban}
                      </span>
                    )}
                  </div>
                  {account.lastSyncAt && (
                    <span className="text-xs text-muted-foreground">
                      Letzter Sync: {new Date(account.lastSyncAt).toLocaleString("de-DE")}
                      {account.lastSyncStatus && ` - ${account.lastSyncStatus}`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    className={account.isActive
                      ? "bg-green-600 text-white"
                      : "bg-gray-400 text-white"
                    }
                  >
                    {account.isActive ? "Aktiv" : "Inaktiv"}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={togglingId === account.id}
                    onClick={() => handleToggleAutoSync(account.id, account.isActive)}
                  >
                    {togglingId === account.id ? "..." : account.isActive ? "Deaktivieren" : "Aktivieren"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Last 5 sync results */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Letzte Sync-Ergebnisse
        </h3>

        {syncLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Sync-Ergebnisse vorhanden.</p>
        ) : (
          <div className="space-y-2">
            {syncLogs.map(log => {
              const isCron = log.action === "bank_account.cron_sync"
              const details = log.details as Record<string, unknown> | null
              const hasErrors = details && Array.isArray(details.errors) && details.errors.length > 0

              return (
                <div
                  key={log.id}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors"
                >
                  {hasErrors ? (
                    <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  )}
                  <span className="text-xs text-muted-foreground w-[140px] flex-shrink-0">
                    {new Date(log.createdAt).toLocaleString("de-DE")}
                  </span>
                  <Badge className={isCron ? "bg-purple-600 text-white" : "bg-blue-600 text-white"}>
                    {isCron ? "Cron" : "Manuell"}
                  </Badge>
                  {details && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {typeof details.imported === "number" && `${details.imported} importiert`}
                      {typeof details.skipped === "number" && `, ${details.skipped} uebersprungen`}
                      {hasErrors && `, ${(details.errors as unknown[]).length} Fehler`}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Telegram Bot */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Bot className="w-5 h-5" />
          Telegram Bot
        </h3>

        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Status:</span>
            {telegramStatus?.configured ? (
              <Badge className="bg-green-600 text-white">Verbunden</Badge>
            ) : (
              <Badge className="bg-gray-400 text-white">Nicht verbunden</Badge>
            )}
          </div>

          {/* Configuration checklist */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              {telegramStatus?.botToken ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <span className="text-muted-foreground">TELEGRAM_BOT_TOKEN</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {telegramStatus?.chatId ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <span className="text-muted-foreground">TELEGRAM_CHAT_ID</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {telegramStatus?.webhookSecret ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <span className="text-muted-foreground">TELEGRAM_WEBHOOK_SECRET</span>
            </div>
          </div>

          {/* Webhook URL */}
          {telegramStatus?.webhookUrl && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Webhook-URL:</p>
              <code className="bg-muted px-3 py-2 rounded text-sm block overflow-x-auto">
                {telegramStatus.webhookUrl}
              </code>
            </div>
          )}

          {/* Setup button */}
          {telegramStatus?.configured && telegramStatus?.webhookSecret && (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={telegramSetupLoading}
                onClick={handleSetupTelegramWebhook}
              >
                <Send className="w-4 h-4 mr-2" />
                {telegramSetupLoading ? "Einrichten..." : "Webhook einrichten"}
              </Button>
              {telegramSetupResult && (
                <span className={`text-sm ${telegramSetupResult.startsWith("Fehler") ? "text-red-500" : "text-green-600"}`}>
                  {telegramSetupResult}
                </span>
              )}
            </div>
          )}

          {/* Usage info */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium">So funktioniert der Telegram Bot:</p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Setze <code className="bg-muted px-1 rounded">TELEGRAM_BOT_TOKEN</code>, <code className="bg-muted px-1 rounded">TELEGRAM_CHAT_ID</code> und <code className="bg-muted px-1 rounded">TELEGRAM_WEBHOOK_SECRET</code> in den Umgebungsvariablen.</li>
              <li>Klicke auf &quot;Webhook einrichten&quot; um den Bot zu aktivieren.</li>
              <li>Sende ein Foto oder PDF einer Rechnung an den Bot.</li>
              <li>Der Bot analysiert die Rechnung automatisch mit KI und erstellt eine Transaktion.</li>
            </ol>
          </div>
        </div>
      </Card>
    </div>
  )
}
