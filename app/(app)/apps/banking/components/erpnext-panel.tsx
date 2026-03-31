"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import {
  syncToERPNextAction,
  syncFromERPNextAction,
  getERPNextStatusAction,
  testERPNextConnectionAction,
} from "../actions"
import { RefreshCw, CheckCircle2, AlertCircle, Link2, Upload, Download, Settings } from "lucide-react"

type ERPNextStatus = {
  configured: boolean
  connected: boolean
  url: string | null
  hasApiKey: boolean
  hasApiSecret: boolean
}

type SyncResultData = {
  created: number
  updated: number
  skipped: number
  errors: string[]
  syncedAt: string
}

export default function ERPNextPanel() {
  const [status, setStatus] = useState<ERPNextStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState<"to" | "from" | null>(null)
  const [syncResult, setSyncResult] = useState<SyncResultData | null>(null)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadStatus()
  }, [])

  async function loadStatus() {
    setLoading(true)
    setError(null)
    try {
      const result = await getERPNextStatusAction()
      if (result.success && result.data) {
        setStatus(result.data)
      } else {
        setError(result.error || "Status konnte nicht abgerufen werden.")
      }
    } catch {
      setError("Fehler beim Laden des ERPNext-Status.")
    } finally {
      setLoading(false)
    }
  }

  async function handleTestConnection() {
    setTesting(true)
    setError(null)
    try {
      const result = await testERPNextConnectionAction()
      if (result.success) {
        // Status neu laden nach erfolgreichem Test
        await loadStatus()
      } else {
        setError(result.error || "Verbindungstest fehlgeschlagen.")
      }
    } catch {
      setError("Verbindungstest fehlgeschlagen.")
    } finally {
      setTesting(false)
    }
  }

  async function handleSyncTo() {
    setSyncing("to")
    setSyncResult(null)
    setError(null)
    try {
      const result = await syncToERPNextAction()
      if (result.success && result.data) {
        setSyncResult(result.data)
        setLastSync(new Date().toISOString())
      } else {
        setError(result.error || "Synchronisation fehlgeschlagen.")
      }
    } catch {
      setError("Synchronisation fehlgeschlagen.")
    } finally {
      setSyncing(null)
    }
  }

  async function handleSyncFrom() {
    setSyncing("from")
    setSyncResult(null)
    setError(null)
    try {
      const result = await syncFromERPNextAction()
      if (result.success && result.data) {
        setSyncResult(result.data)
        setLastSync(new Date().toISOString())
      } else {
        setError(result.error || "Import fehlgeschlagen.")
      }
    } catch {
      setError("Import fehlgeschlagen.")
    } finally {
      setSyncing(null)
    }
  }

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" />
          ERPNext-Status wird geladen...
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Verbindungsstatus */}
      <Card className="p-6">
        <CardTitle className="flex items-center gap-2 mb-2">
          <Link2 className="w-5 h-5" />
          ERPNext Verbindung
        </CardTitle>
        <CardDescription className="mb-4">
          Synchronisiere Buchungen, Kunden und Rechnungen mit ERPNext.
        </CardDescription>

        <div className="space-y-3">
          {/* Status-Anzeige */}
          <div className="flex items-center gap-2">
            {status?.connected ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-green-700 dark:text-green-400">Verbunden</span>
              </>
            ) : status?.configured ? (
              <>
                <AlertCircle className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-medium text-orange-700 dark:text-orange-400">Konfiguriert, aber nicht verbunden</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Nicht konfiguriert</span>
              </>
            )}
          </div>

          {/* Konfigurationsdetails */}
          <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 rounded p-3">
            <div className="flex items-center gap-2">
              <Settings className="w-3 h-3" />
              <span className="font-medium">Umgebungsvariablen:</span>
            </div>
            <div className="ml-5 space-y-0.5">
              <p>
                ERPNEXT_URL: {status?.url ? (
                  <span className="text-green-600 dark:text-green-400">{status.url}</span>
                ) : (
                  <span className="text-red-500">nicht gesetzt</span>
                )}
              </p>
              <p>
                ERPNEXT_API_KEY: {status?.hasApiKey ? (
                  <span className="text-green-600 dark:text-green-400">gesetzt</span>
                ) : (
                  <span className="text-red-500">nicht gesetzt</span>
                )}
              </p>
              <p>
                ERPNEXT_API_SECRET: {status?.hasApiSecret ? (
                  <span className="text-green-600 dark:text-green-400">gesetzt</span>
                ) : (
                  <span className="text-red-500">nicht gesetzt</span>
                )}
              </p>
            </div>
          </div>

          {/* Verbindung testen */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={testing || !status?.configured}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${testing ? "animate-spin" : ""}`} />
            {testing ? "Teste..." : "Verbindung testen"}
          </Button>
        </div>
      </Card>

      {/* Synchronisation */}
      {status?.connected && (
        <Card className="p-6">
          <CardTitle className="flex items-center gap-2 mb-2">
            <RefreshCw className="w-5 h-5" />
            Synchronisation
          </CardTitle>
          <CardDescription className="mb-4">
            Daten zwischen TaxHacker und ERPNext synchronisieren.
          </CardDescription>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleSyncTo}
              disabled={syncing !== null}
            >
              <Upload className={`w-4 h-4 mr-1.5 ${syncing === "to" ? "animate-pulse" : ""}`} />
              {syncing === "to" ? "Synchronisiere..." : "Zu ERPNext synchronisieren"}
            </Button>

            <Button
              variant="outline"
              onClick={handleSyncFrom}
              disabled={syncing !== null}
            >
              <Download className={`w-4 h-4 mr-1.5 ${syncing === "from" ? "animate-pulse" : ""}`} />
              {syncing === "from" ? "Importiere..." : "Von ERPNext importieren"}
            </Button>
          </div>

          {/* Letzter Sync */}
          {lastSync && (
            <p className="text-xs text-muted-foreground mt-3">
              Letzter Sync: {new Date(lastSync).toLocaleString("de-DE")}
            </p>
          )}
        </Card>
      )}

      {/* Sync-Ergebnis */}
      {syncResult && (
        <Card className="p-6">
          <CardTitle className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            Synchronisation abgeschlossen
          </CardTitle>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div className="bg-green-50 dark:bg-green-950 rounded p-3 text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{syncResult.created}</div>
              <div className="text-xs text-muted-foreground">Erstellt</div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-950 rounded p-3 text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{syncResult.updated}</div>
              <div className="text-xs text-muted-foreground">Aktualisiert</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 text-center">
              <div className="text-2xl font-bold text-muted-foreground">{syncResult.skipped}</div>
              <div className="text-xs text-muted-foreground">Übersprungen</div>
            </div>
            <div className="bg-red-50 dark:bg-red-950 rounded p-3 text-center">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{syncResult.errors.length}</div>
              <div className="text-xs text-muted-foreground">Fehler</div>
            </div>
          </div>

          {syncResult.errors.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">Fehler:</p>
              <ul className="text-xs text-red-600 dark:text-red-400 space-y-0.5 max-h-32 overflow-y-auto">
                {syncResult.errors.map((err, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Fehlermeldung */}
      {error && (
        <Card className="p-4 border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        </Card>
      )}
    </div>
  )
}
