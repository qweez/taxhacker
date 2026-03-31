"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  getUnreconciledTransactionsAction,
  findReceiptMatchesAction,
  linkReceiptAction,
} from "../actions"
import { Check, FileText, Link2, Search, Building2 } from "lucide-react"
import { cn } from "@/lib/utils"

type BankTransaction = {
  id: string
  name: string
  merchant: string | null
  total: number | null
  currencyCode: string | null
  type: string | null
  issuedAt: string | null
  categoryCode: string | null
  categoryName: string | null
}

type ReceiptMatch = {
  transactionId: string
  fileId: string
  confidence: number
  matchReasons: string[]
  filename: string | null
  merchant: string | null
  total: number | null
  issuedAt: string | null
}

function formatAmount(total: number | null, currency: string | null, type: string | null) {
  if (!total || !currency) return "\u2013"
  const value = total / 100
  const formatted = new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(value)
  return type === "income" ? `+${formatted}` : `-${formatted}`
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "text-green-600"
  if (confidence >= 0.5) return "text-yellow-600"
  return "text-orange-600"
}

export default function ReceiptMatchingPanel() {
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [selectedTx, setSelectedTx] = useState<BankTransaction | null>(null)
  const [matches, setMatches] = useState<ReceiptMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    loadTransactions()
  }, [])

  async function loadTransactions() {
    setLoading(true)
    const result = await getUnreconciledTransactionsAction()
    if (result.success && result.data) {
      setTransactions(result.data)
    }
    setLoading(false)
  }

  async function handleSearch(tx: BankTransaction) {
    setSelectedTx(tx)
    setMatches([])
    setSearching(true)
    const result = await findReceiptMatchesAction(tx.id)
    if (result.success && result.data) {
      setMatches(result.data)
    }
    setSearching(false)
  }

  async function handleLink(fileId: string) {
    if (!selectedTx) return
    setLinking(true)
    const result = await linkReceiptAction(selectedTx.id, fileId)
    if (result.success) {
      // Remove the linked transaction from the list
      setTransactions((prev) => prev.filter((t) => t.id !== selectedTx.id))
      setSelectedTx(null)
      setMatches([])
    }
    setLinking(false)
  }

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Lade Transaktionen...</div>
  }

  if (transactions.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <Check className="w-12 h-12 mx-auto mb-4 text-green-500 opacity-50" />
        <p className="font-medium">Alle Belege zugeordnet!</p>
        <p className="text-sm mt-1">Es gibt keine offenen Bank-Transaktionen ohne Beleg.</p>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Bank transactions */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          Bank-Transaktionen ({transactions.length} ohne Beleg)
        </h3>
        <div className="space-y-1 max-h-[600px] overflow-y-auto">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className={cn(
                "p-3 rounded-lg border cursor-pointer transition-colors hover:bg-accent",
                selectedTx?.id === tx.id && "border-primary bg-accent",
              )}
              onClick={() => handleSearch(tx)}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{tx.name}</p>
                  {tx.merchant && tx.merchant !== tx.name && (
                    <p className="text-xs text-muted-foreground truncate">{tx.merchant}</p>
                  )}
                  {tx.issuedAt && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(tx.issuedAt).toLocaleDateString("de-DE")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-sm font-mono font-medium whitespace-nowrap",
                      tx.type === "income" ? "text-green-600" : "text-red-600",
                    )}
                  >
                    {formatAmount(tx.total, tx.currencyCode, tx.type)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSearch(tx)
                    }}
                  >
                    <Search className="w-4 h-4" />
                    <span className="ml-1 hidden sm:inline">Beleg suchen</span>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Matching receipts */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Passende Belege
        </h3>

        {!selectedTx && (
          <Card className="p-8 text-center text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              Wähle eine Bank-Transaktion aus oder klicke &quot;Beleg suchen&quot;, um passende
              Belege zu finden.
            </p>
          </Card>
        )}

        {selectedTx && searching && (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="w-6 h-6 mx-auto mb-2 animate-pulse" />
            Suche passende Belege...
          </div>
        )}

        {selectedTx && !searching && matches.length === 0 && (
          <Card className="p-6 text-center text-muted-foreground">
            <p className="text-sm">Keine passenden Belege gefunden.</p>
            <p className="text-xs mt-1">Kriterien: gleicher Betrag, Datum ±5 Tage</p>
          </Card>
        )}

        {selectedTx && !searching && matches.length > 0 && (
          <div className="space-y-2">
            {matches.map((m) => (
              <div
                key={m.fileId}
                className="p-3 rounded-lg border flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <p className="text-sm font-medium truncate">{m.filename ?? "Unbekannte Datei"}</p>
                  </div>
                  {m.merchant && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5 ml-6">
                      {m.merchant}
                    </p>
                  )}
                  {m.issuedAt && (
                    <p className="text-xs text-muted-foreground ml-6">
                      {new Date(m.issuedAt).toLocaleDateString("de-DE")}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1.5 ml-6">
                    {m.matchReasons.map((reason, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {reason}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={cn("text-sm font-mono font-semibold", confidenceColor(m.confidence))}>
                    {formatConfidence(m.confidence)}
                  </span>
                  <Button size="sm" onClick={() => handleLink(m.fileId)} disabled={linking}>
                    <Link2 className="w-4 h-4 mr-1" />
                    Verknüpfen
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
