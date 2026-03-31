"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  listAssetsAction,
  createAssetAction,
  deleteAssetAction,
  getDepreciationScheduleAction,
  getAssetRegisterAction,
} from "../actions"
import { Building2, Plus, Trash2, Calculator, Info, Download } from "lucide-react"

function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const CATEGORIES = [
  { value: "computer", label: "Computer / IT" },
  { value: "software", label: "Software" },
  { value: "bueromoebel", label: "Büromöbel" },
  { value: "pkw", label: "PKW" },
  { value: "lkw", label: "LKW" },
  { value: "drucker", label: "Drucker" },
  { value: "telefon", label: "Telefon" },
  { value: "mobiltelefon", label: "Mobiltelefon" },
  { value: "maschinen", label: "Maschinen" },
  { value: "werkzeug", label: "Werkzeug" },
  { value: "gebaeude", label: "Gebäude (Gewerbe)" },
  { value: "gebaeude_wohn", label: "Gebäude (Wohn)" },
  { value: "photovoltaik", label: "Photovoltaikanlage" },
  { value: "sonstiges", label: "Sonstiges" },
]

const METHOD_LABELS: Record<string, string> = {
  linear: "Linear",
  degressive: "Degressiv",
  gwg: "GWG (Sofort)",
  sammelposten: "Sammelposten (5J)",
}

type SerializedAsset = {
  id: string
  name: string
  description: string | null
  inventoryNumber: string | null
  category: string
  acquisitionDate: string
  acquisitionCost: number
  residualValue: number
  usefulLifeYears: number
  depreciationMethod: string
  isActive: boolean
  disposalDate: string | null
  disposalProceeds: number | null
  createdAt: string
  updatedAt: string
}

type DepreciationEntry = {
  year: number
  startValue: number
  depreciation: number
  endValue: number
  accumulatedDepreciation: number
}

export default function AnlagenPanel() {
  const [assets, setAssets] = useState<SerializedAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [schedule, setSchedule] = useState<DepreciationEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  // Formular-State
  const [formName, setFormName] = useState("")
  const [formCategory, setFormCategory] = useState("computer")
  const [formDate, setFormDate] = useState("")
  const [formCost, setFormCost] = useState("")
  const [formMethod, setFormMethod] = useState("linear")
  const [formDescription, setFormDescription] = useState("")
  const [addPending, setAddPending] = useState(false)

  useEffect(() => {
    loadAssets()
  }, [])

  async function loadAssets() {
    setLoading(true)
    const result = await listAssetsAction()
    if (result.success && result.data) {
      setAssets(result.data as SerializedAsset[])
    }
    setLoading(false)
  }

  async function handleAdd() {
    setAddPending(true)
    setAddError(null)

    const costCents = Math.round(parseFloat(formCost.replace(",", ".")) * 100)
    if (isNaN(costCents) || costCents <= 0) {
      setAddError("Bitte gültige Anschaffungskosten eingeben.")
      setAddPending(false)
      return
    }

    const result = await createAssetAction({
      name: formName,
      category: formCategory,
      acquisitionDate: formDate,
      acquisitionCost: costCents,
      depreciationMethod: formMethod,
      description: formDescription || undefined,
    })

    if (result.success && result.data) {
      setAssets(prev => [...prev, result.data as SerializedAsset])
      setShowAddForm(false)
      setFormName("")
      setFormCost("")
      setFormDate("")
      setFormDescription("")
    } else {
      setAddError(result.error || "Fehler beim Anlegen.")
    }
    setAddPending(false)
  }

  async function handleDelete(id: string) {
    if (!confirm("Anlage wirklich löschen?")) return
    const result = await deleteAssetAction(id)
    if (result.success) {
      setAssets(prev => prev.filter(a => a.id !== id))
      if (selectedAssetId === id) {
        setSelectedAssetId(null)
        setSchedule(null)
      }
    }
  }

  async function handleShowSchedule(id: string) {
    if (selectedAssetId === id) {
      setSelectedAssetId(null)
      setSchedule(null)
      return
    }
    setSelectedAssetId(id)
    setSchedule(null)
    const result = await getDepreciationScheduleAction(id)
    if (result.success && result.data) {
      setSchedule(result.data as DepreciationEntry[])
    } else {
      setError(result.error || "Fehler beim Laden des AfA-Plans.")
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <CardTitle className="flex items-center gap-2 mb-2">
          <Building2 className="w-5 h-5" />
          Anlagenbuchhaltung
        </CardTitle>
        <CardDescription className="mb-6">
          Verwaltung von Anlagegütern mit automatischer AfA-Berechnung nach deutschem Steuerrecht.
          GWG bis 800 EUR werden sofort abgeschrieben.
        </CardDescription>

        {loading ? (
          <p className="text-sm text-muted-foreground">Lade Anlagen...</p>
        ) : (
          <div className="space-y-4">
            {assets.length === 0 && !showAddForm && (
              <div className="text-center py-8 text-muted-foreground">
                <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Noch keine Anlagegüter erfasst.</p>
              </div>
            )}

            {assets.map(asset => (
              <Card key={asset.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{asset.name}</h3>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <Badge variant="outline">{CATEGORIES.find(c => c.value === asset.category)?.label ?? asset.category}</Badge>
                      <Badge variant="secondary">{METHOD_LABELS[asset.depreciationMethod] ?? asset.depreciationMethod}</Badge>
                      <Badge variant="secondary">{asset.usefulLifeYears} Jahre ND</Badge>
                      {!asset.isActive && <Badge variant="destructive">Ausgeschieden</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Anschaffung: {new Date(asset.acquisitionDate).toLocaleDateString("de-DE")} | AHK: {formatEuro(asset.acquisitionCost)} EUR
                    </p>
                    {asset.description && (
                      <p className="text-xs text-muted-foreground mt-1">{asset.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleShowSchedule(asset.id)}
                    >
                      <Calculator className="w-4 h-4 mr-1" />
                      AfA-Plan
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(asset.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {selectedAssetId === asset.id && schedule && (
                  <div className="mt-4 border-t pt-4">
                    <h4 className="text-sm font-semibold mb-2">AfA-Plan</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-1 pr-4">Jahr</th>
                            <th className="text-right py-1">Buchwert Anfang</th>
                            <th className="text-right py-1">AfA</th>
                            <th className="text-right py-1">Buchwert Ende</th>
                            <th className="text-right py-1">Kum. AfA</th>
                          </tr>
                        </thead>
                        <tbody>
                          {schedule.map(entry => (
                            <tr key={entry.year} className="border-b">
                              <td className="py-1 pr-4 font-mono">{entry.year}</td>
                              <td className="py-1 text-right font-mono">{formatEuro(entry.startValue)}</td>
                              <td className="py-1 text-right font-mono">{formatEuro(entry.depreciation)}</td>
                              <td className="py-1 text-right font-mono">{formatEuro(entry.endValue)}</td>
                              <td className="py-1 text-right font-mono">{formatEuro(entry.accumulatedDepreciation)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Card>
            ))}

            {showAddForm ? (
              <Card className="p-6">
                <h3 className="font-semibold mb-4">Neue Anlage erfassen</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium block mb-1">Bezeichnung *</label>
                    <input
                      type="text"
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm"
                      placeholder="z.B. MacBook Pro 16"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Kategorie *</label>
                    <select
                      value={formCategory}
                      onChange={e => setFormCategory(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                    >
                      {CATEGORIES.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Anschaffungsdatum *</label>
                    <input
                      type="date"
                      value={formDate}
                      onChange={e => setFormDate(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Anschaffungskosten (EUR) *</label>
                    <input
                      type="text"
                      value={formCost}
                      onChange={e => setFormCost(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm"
                      placeholder="z.B. 2499,00"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">AfA-Methode</label>
                    <select
                      value={formMethod}
                      onChange={e => setFormMethod(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                    >
                      <option value="linear">Linear</option>
                      <option value="degressive">Degressiv</option>
                      <option value="gwg">GWG (Sofortabschreibung)</option>
                      <option value="sammelposten">Sammelposten (5 Jahre)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Beschreibung</label>
                    <input
                      type="text"
                      value={formDescription}
                      onChange={e => setFormDescription(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm"
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button onClick={handleAdd} disabled={addPending || !formName || !formDate || !formCost}>
                    {addPending ? "Speichere..." : "Anlage erfassen"}
                  </Button>
                  <Button variant="outline" onClick={() => setShowAddForm(false)}>
                    Abbrechen
                  </Button>
                </div>
                {addError && (
                  <p className="text-sm text-destructive mt-2">{addError}</p>
                )}
              </Card>
            ) : (
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="w-4 h-4 mr-1" /> Anlage erfassen
              </Button>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive mt-4">{error}</p>
        )}

        <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1 mt-6">
          <p className="flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              GWG (geringwertige Wirtschaftsgüter) bis 800 EUR netto werden im Anschaffungsjahr
              sofort abgeschrieben. Die Nutzungsdauer wird automatisch aus der amtlichen AfA-Tabelle ermittelt.
            </span>
          </p>
        </div>
      </Card>
    </div>
  )
}
