"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  getUnreconciledTransactionsAction,
  getReconciliationCandidatesAction,
  reconcileAction,
} from "../actions"
import { ArrowRight, Check, Link2, Search, Building2 } from "lucide-react"
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

type Candidate = BankTransaction

function formatAmount(total: number | null, currency: string | null, type: string | null) {
  if (!total || !currency) return "–"
  const value = total / 100
  const formatted = new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(value)
  return type === "income" ? `+${formatted}` : `-${formatted}`
}

export default function ReconciliationPanel() {
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [selectedTx, setSelectedTx] = useState<BankTransaction | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [reconciling, setReconciling] = useState(false)

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

  async function handleSelect(tx: BankTransaction) {
    setSelectedTx(tx)
    setSearching(true)
    const result = await getReconciliationCandidatesAction(tx.id)
    if (result.success && result.data) {
      setCandidates(result.data)
    }
    setSearching(false)
  }

  async function handleReconcile(candidateId: string) {
    if (!selectedTx) return
    setReconciling(true)
    await reconcileAction(selectedTx.id, candidateId)
    setTransactions(prev => prev.filter(t => t.id !== selectedTx.id))
    setSelectedTx(null)
    setCandidates([])
    setReconciling(false)
  }

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Lade Transaktionen...</div>
  }

  if (transactions.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <Check className="w-12 h-12 mx-auto mb-4 text-green-500 opacity-50" />
        <p className="font-medium">Alle Transaktionen abgeglichen!</p>
        <p className="text-sm mt-1">Es gibt keine offenen Bank-Transaktionen zum Abgleichen.</p>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Bank transactions */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          Bank-Transaktionen ({transactions.length} offen)
        </h3>
        <div className="space-y-1 max-h-[600px] overflow-y-auto">
          {transactions.map(tx => (
            <div
              key={tx.id}
              className={cn(
                "p-3 rounded-lg border cursor-pointer transition-colors hover:bg-accent",
                selectedTx?.id === tx.id && "border-primary bg-accent"
              )}
              onClick={() => handleSelect(tx)}
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
                <span className={cn(
                  "text-sm font-mono font-medium ml-2 whitespace-nowrap",
                  tx.type === "income" ? "text-green-600" : "text-red-600"
                )}>
                  {formatAmount(tx.total, tx.currencyCode, tx.type)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Candidates or empty state */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <Link2 className="w-4 h-4" />
          Mögliche Zuordnungen
        </h3>

        {!selectedTx && (
          <Card className="p-8 text-center text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Wähle eine Bank-Transaktion links aus, um Zuordnungen zu finden.</p>
          </Card>
        )}

        {selectedTx && searching && (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="w-6 h-6 mx-auto mb-2 animate-pulse" />
            Suche Zuordnungen...
          </div>
        )}

        {selectedTx && !searching && candidates.length === 0 && (
          <Card className="p-6 text-center text-muted-foreground">
            <p className="text-sm">Keine passenden manuellen Transaktionen gefunden.</p>
            <p className="text-xs mt-1">Kriterien: gleicher Betrag, Datum ±3 Tage</p>
          </Card>
        )}

        {selectedTx && !searching && candidates.length > 0 && (
          <div className="space-y-2">
            {candidates.map(c => (
              <div
                key={c.id}
                className="p-3 rounded-lg border flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  {c.merchant && (
                    <p className="text-xs text-muted-foreground truncate">{c.merchant}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {c.issuedAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(c.issuedAt).toLocaleDateString("de-DE")}
                      </span>
                    )}
                    {c.categoryName && (
                      <Badge variant="secondary" className="text-xs">{c.categoryName}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-sm font-mono font-medium whitespace-nowrap",
                    c.type === "income" ? "text-green-600" : "text-red-600"
                  )}>
                    {formatAmount(c.total, c.currencyCode, c.type)}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => handleReconcile(c.id)}
                    disabled={reconciling}
                  >
                    <ArrowRight className="w-4 h-4 mr-1" />
                    Zuordnen
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
