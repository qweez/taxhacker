"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getAuditLogsAction } from "../actions"
import { Shield, Clock } from "lucide-react"

type AuditEntry = {
  id: string
  action: string
  target: string | null
  details: any
  createdAt: string
}

const actionLabels: Record<string, { label: string; color: string }> = {
  "bank_account.create": { label: "Konto erstellt", color: "bg-green-600" },
  "bank_account.sync": { label: "Sync", color: "bg-blue-600" },
  "bank_account.delete": { label: "Konto gelöscht", color: "bg-red-600" },
  "bank_account.tan_submit": { label: "TAN gesendet", color: "bg-orange-600" },
}

export default function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadLogs()
  }, [])

  async function loadLogs() {
    setLoading(true)
    const result = await getAuditLogsAction()
    if (result.success && result.data) {
      setLogs(result.data)
    }
    setLoading(false)
  }

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Lade Audit-Log...</div>
  }

  if (logs.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>Noch keine Audit-Einträge vorhanden.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-1">
      {logs.map(log => {
        const actionInfo = actionLabels[log.action] || { label: log.action, color: "bg-gray-600" }
        return (
          <div key={log.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors">
            <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground w-[140px] flex-shrink-0">
              {new Date(log.createdAt).toLocaleString("de-DE")}
            </span>
            <Badge className={`${actionInfo.color} text-white whitespace-nowrap`}>
              {actionInfo.label}
            </Badge>
            {log.target && (
              <span className="text-sm text-muted-foreground truncate">
                {log.target}
              </span>
            )}
            {log.details && typeof log.details === "object" && (
              <span className="text-xs text-muted-foreground ml-auto">
                {Object.entries(log.details as Record<string, unknown>)
                  .filter(([, v]) => typeof v === "number")
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ")}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
