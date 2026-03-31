"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { FormInput } from "@/components/forms/simple"
import { Plus, Trash2, FileDown, Loader2, FileCode2, FileCheck } from "lucide-react"
import { generateInvoiceAction, generateXRechnungAction, validateXRechnungAction } from "../actions"
import type { InvoiceData } from "@/lib/invoice-generator"
import type { XRechnungData } from "@/lib/fints/xrechnung-generator"
import type { ValidationResult } from "@/lib/fints/xrechnung-validator"

type InvoiceFormat = "pdf" | "xrechnung" | "zugferd"

type LineItem = {
  position: number
  description: string
  quantity: number
  unit: string
  unitPrice: number // in cents
  taxRate: number
}

/** Map display unit names to UN/ECE Rec 20 codes for XRechnung */
const UNIT_CODE_MAP: Record<string, string> = {
  Stunden: "HUR",
  "Stück": "H87",
  Pauschal: "C62",
  Tage: "DAY",
  Monate: "MON",
  km: "KMT",
}

/** Map tax rates to tax category codes */
function taxCategoryForRate(rate: number): string {
  if (rate > 0) return "S"
  return "Z"
}

type UserProfile = {
  businessName?: string | null
  businessAddress?: string | null
  businessBankDetails?: string | null
  businessLogo?: string | null
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function generateInvoiceNumber(): string {
  const now = new Date()
  const year = now.getFullYear()
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")
  return `RE-${year}-${seq}`
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function InvoiceForm({ userProfile }: { userProfile: UserProfile }) {
  const [sellerName, setSellerName] = useState(userProfile.businessName ?? "")
  const [sellerAddress, setSellerAddress] = useState(userProfile.businessAddress ?? "")
  const [sellerBankDetails, setSellerBankDetails] = useState(userProfile.businessBankDetails ?? "")
  const [sellerTaxId, setSellerTaxId] = useState("")
  const [sellerVatId, setSellerVatId] = useState("")
  const [sellerEmail, setSellerEmail] = useState("")
  const [sellerPhone, setSellerPhone] = useState("")

  const [buyerName, setBuyerName] = useState("")
  const [buyerAddress, setBuyerAddress] = useState("")
  const [buyerVatId, setBuyerVatId] = useState("")

  const [invoiceNumber, setInvoiceNumber] = useState(generateInvoiceNumber)
  const [invoiceDate, setInvoiceDate] = useState(todayISO)
  const [serviceDate, setServiceDate] = useState("")
  const [dueDate, setDueDate] = useState(() => addDays(todayISO(), 14))

  const [items, setItems] = useState<LineItem[]>([
    { position: 1, description: "", quantity: 1, unit: "Stunden", unitPrice: 0, taxRate: 19 },
  ])

  const [note, setNote] = useState("")
  const [reverseCharge, setReverseCharge] = useState(false)
  const [kleinunternehmer, setKleinunternehmer] = useState(false)

  const [invoiceFormat, setInvoiceFormat] = useState<InvoiceFormat>("pdf")
  const [buyerLeitwegId, setBuyerLeitwegId] = useState("")
  const [buyerReference, setBuyerReference] = useState("")
  const [sellerIban, setSellerIban] = useState("")
  const [sellerBic, setSellerBic] = useState("")
  const [sellerBankName, setSellerBankName] = useState("")

  const [xmlPreview, setXmlPreview] = useState<string | null>(null)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        position: prev.length + 1,
        description: "",
        quantity: 1,
        unit: "Stunden",
        unitPrice: 0,
        taxRate: 19,
      },
    ])
  }

  function removeItem(index: number) {
    setItems((prev) => {
      const updated = prev.filter((_, i) => i !== index)
      return updated.map((item, i) => ({ ...item, position: i + 1 }))
    })
  }

  function updateItem(index: number, field: keyof LineItem, value: string | number) {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        return { ...item, [field]: value }
      })
    )
  }

  const totals = useMemo(() => {
    const taxMap = new Map<number, number>()
    let netTotal = 0

    for (const item of items) {
      const lineNet = item.quantity * item.unitPrice
      netTotal += lineNet
      taxMap.set(item.taxRate, (taxMap.get(item.taxRate) ?? 0) + lineNet)
    }

    const taxBreakdown = Array.from(taxMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([rate, net]) => ({
        rate,
        net,
        tax: Math.round((net * rate) / 100),
      }))

    const totalTax = kleinunternehmer ? 0 : taxBreakdown.reduce((sum, t) => sum + t.tax, 0)

    return {
      netTotal,
      taxBreakdown,
      grossTotal: netTotal + totalTax,
    }
  }, [items, kleinunternehmer])

  function buildInvoiceData(): InvoiceData {
    return {
      sellerName,
      sellerAddress,
      sellerTaxId: sellerTaxId || undefined,
      sellerVatId: sellerVatId || undefined,
      sellerBankDetails: sellerBankDetails || undefined,
      sellerEmail: sellerEmail || undefined,
      sellerPhone: sellerPhone || undefined,
      buyerName,
      buyerAddress,
      buyerVatId: buyerVatId || undefined,
      invoiceNumber,
      invoiceDate,
      serviceDate: serviceDate || undefined,
      dueDate: dueDate || undefined,
      items,
      note: note || undefined,
      reverseCharge,
      kleinunternehmer,
    }
  }

  function buildXRechnungData(): XRechnungData {
    // Parse seller address into street/city/postalCode
    const addressLines = sellerAddress.split("\n").map((l) => l.trim()).filter(Boolean)
    const sellerStreet = addressLines[0] || undefined
    let sellerCity: string | undefined
    let sellerPostalCode: string | undefined
    if (addressLines[1]) {
      const match = addressLines[1].match(/^(\d{5})\s+(.+)$/)
      if (match) {
        sellerPostalCode = match[1]
        sellerCity = match[2]
      } else {
        sellerCity = addressLines[1]
      }
    }

    // Parse buyer address
    const buyerLines = buyerAddress.split("\n").map((l) => l.trim()).filter(Boolean)
    const buyerStreet = buyerLines[0] || undefined
    let buyerCity: string | undefined
    let buyerPostalCode: string | undefined
    if (buyerLines[1]) {
      const match = buyerLines[1].match(/^(\d{5})\s+(.+)$/)
      if (match) {
        buyerPostalCode = match[1]
        buyerCity = match[2]
      } else {
        buyerCity = buyerLines[1]
      }
    }

    return {
      invoiceNumber,
      invoiceDate,
      dueDate: dueDate || undefined,
      seller: {
        name: sellerName,
        street: sellerStreet,
        city: sellerCity,
        postalCode: sellerPostalCode,
        country: "DE",
        taxId: sellerTaxId || undefined,
        vatId: sellerVatId || undefined,
        email: sellerEmail || undefined,
        phone: sellerPhone || undefined,
      },
      buyer: {
        name: buyerName,
        street: buyerStreet,
        city: buyerCity,
        postalCode: buyerPostalCode,
        country: "DE",
        vatId: buyerVatId || undefined,
        leitweg_id: buyerLeitwegId || undefined,
      },
      lineItems: items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit: UNIT_CODE_MAP[item.unit] ?? "C62",
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        taxCategory: taxCategoryForRate(item.taxRate),
      })),
      currency: "EUR",
      paymentMeans: sellerIban
        ? {
            iban: sellerIban || undefined,
            bic: sellerBic || undefined,
            bankName: sellerBankName || undefined,
          }
        : undefined,
      note: note || undefined,
      buyerReference: buyerReference || buyerLeitwegId || undefined,
    }
  }

  function triggerDownload(content: string | Uint8Array, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleGeneratePDF() {
    const data = buildInvoiceData()
    const result = await generateInvoiceAction(data)
    if (!result.success || !result.data) {
      setError(result.error ?? "PDF-Erstellung fehlgeschlagen.")
      return
    }
    const byteCharacters = atob(result.data)
    const byteNumbers = new Uint8Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    triggerDownload(byteNumbers, `${invoiceNumber}.pdf`, "application/pdf")
  }

  async function handleGenerateXRechnung() {
    const xrData = buildXRechnungData()
    const result = await generateXRechnungAction(xrData)
    if (result.data) {
      setXmlPreview(result.data.xml)
      setValidationResult(result.data.validation)
    }
    if (!result.success) {
      setError(result.error ?? "XRechnung-Erstellung fehlgeschlagen.")
      // Still show the XML preview even on validation failure
      return
    }
    triggerDownload(result.data!.xml, `${invoiceNumber}.xml`, "application/xml")
  }

  async function handleGenerateZUGFeRD() {
    // Generate both PDF and XRechnung XML
    const xrData = buildXRechnungData()
    const xmlResult = await generateXRechnungAction(xrData)
    if (xmlResult.data) {
      setXmlPreview(xmlResult.data.xml)
      setValidationResult(xmlResult.data.validation)
    }

    const data = buildInvoiceData()
    const pdfResult = await generateInvoiceAction(data)
    if (!pdfResult.success || !pdfResult.data) {
      setError(pdfResult.error ?? "PDF-Erstellung fehlgeschlagen.")
      return
    }

    // Download PDF
    const byteCharacters = atob(pdfResult.data)
    const byteNumbers = new Uint8Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    triggerDownload(byteNumbers, `${invoiceNumber}.pdf`, "application/pdf")

    // Download XML alongside
    if (xmlResult.data) {
      triggerDownload(xmlResult.data.xml, `${invoiceNumber}.xml`, "application/xml")
    }
  }

  async function handleGenerate() {
    setError(null)
    setXmlPreview(null)
    setValidationResult(null)

    if (!sellerName.trim()) {
      setError("Bitte Absendername angeben.")
      return
    }
    if (!buyerName.trim()) {
      setError("Bitte Empfängername angeben.")
      return
    }
    if (items.length === 0 || items.every((i) => !i.description.trim())) {
      setError("Bitte mindestens eine Position mit Beschreibung angeben.")
      return
    }
    if ((invoiceFormat === "xrechnung" || invoiceFormat === "zugferd") && !buyerReference && !buyerLeitwegId) {
      setError("Fuer XRechnung ist eine Buyer Reference oder Leitweg-ID erforderlich.")
      return
    }

    setGenerating(true)
    try {
      switch (invoiceFormat) {
        case "pdf":
          await handleGeneratePDF()
          break
        case "xrechnung":
          await handleGenerateXRechnung()
          break
        case "zugferd":
          await handleGenerateZUGFeRD()
          break
      }
    } catch (e: any) {
      setError(e.message ?? "Unbekannter Fehler")
    } finally {
      setGenerating(false)
    }
  }

  async function handleValidateUploadedXml(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setValidationResult(null)

    try {
      const text = await file.text()
      setXmlPreview(text)
      const result = await validateXRechnungAction(text)
      if (result.success && result.data) {
        setValidationResult(result.data)
      } else {
        setError(result.error ?? "Validierung fehlgeschlagen.")
      }
    } catch (e: any) {
      setError(e.message ?? "Fehler beim Lesen der Datei.")
    }
  }

  return (
    <div className="space-y-6">
      {/* Seller Info */}
      <Card className="p-6">
        <CardTitle className="mb-4">Absender (Rechnungssteller)</CardTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput
            title="Name / Firma"
            name="sellerName"
            value={sellerName}
            onChange={(e) => setSellerName(e.target.value)}
            required
          />
          <FormInput
            title="E-Mail"
            name="sellerEmail"
            value={sellerEmail}
            onChange={(e) => setSellerEmail(e.target.value)}
          />
          <div className="md:col-span-2">
            <label className="text-sm font-medium mb-1 block">Adresse</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              value={sellerAddress}
              onChange={(e) => setSellerAddress(e.target.value)}
              placeholder="Straße Nr.&#10;PLZ Ort"
            />
          </div>
          <FormInput
            title="Telefon"
            name="sellerPhone"
            value={sellerPhone}
            onChange={(e) => setSellerPhone(e.target.value)}
          />
          <FormInput
            title="Steuernummer"
            name="sellerTaxId"
            value={sellerTaxId}
            onChange={(e) => setSellerTaxId(e.target.value)}
            placeholder="12/345/67890"
          />
          <FormInput
            title="USt-IdNr."
            name="sellerVatId"
            value={sellerVatId}
            onChange={(e) => setSellerVatId(e.target.value)}
            placeholder="DE123456789"
          />
          <div>
            <label className="text-sm font-medium mb-1 block">Bankverbindung</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              value={sellerBankDetails}
              onChange={(e) => setSellerBankDetails(e.target.value)}
              placeholder="IBAN: DE89 3704 0044 0532 0130 00&#10;BIC: COBADEFFXXX&#10;Bank: Commerzbank"
            />
          </div>
          {(invoiceFormat === "xrechnung" || invoiceFormat === "zugferd") && (
            <>
              <FormInput
                title="IBAN"
                name="sellerIban"
                value={sellerIban}
                onChange={(e) => setSellerIban(e.target.value)}
                placeholder="DE89370400440532013000"
              />
              <FormInput
                title="BIC"
                name="sellerBic"
                value={sellerBic}
                onChange={(e) => setSellerBic(e.target.value)}
                placeholder="COBADEFFXXX"
              />
              <FormInput
                title="Bankname"
                name="sellerBankName"
                value={sellerBankName}
                onChange={(e) => setSellerBankName(e.target.value)}
                placeholder="Commerzbank"
              />
            </>
          )}
        </div>
      </Card>

      {/* Invoice Format Toggle */}
      <Card className="p-6">
        <CardTitle className="mb-4">Rechnungsformat</CardTitle>
        <div className="flex flex-wrap gap-3">
          {(
            [
              { value: "pdf", label: "PDF", desc: "Standard-PDF-Rechnung" },
              { value: "xrechnung", label: "XRechnung (XML)", desc: "UBL 2.1 XML fuer oeffentliche Auftraggeber" },
              { value: "zugferd", label: "ZUGFeRD (PDF+XML)", desc: "PDF-Rechnung mit eingebettetem XML" },
            ] as const
          ).map((fmt) => (
            <button
              key={fmt.value}
              type="button"
              onClick={() => setInvoiceFormat(fmt.value)}
              className={`flex-1 min-w-[180px] p-4 rounded-lg border-2 text-left transition-colors ${
                invoiceFormat === fmt.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              <div className="font-medium text-sm">{fmt.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{fmt.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Buyer Info */}
      <Card className="p-6">
        <CardTitle className="mb-4">Empfänger (Rechnungsempfänger)</CardTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput
            title="Name / Firma"
            name="buyerName"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            required
          />
          <FormInput
            title="USt-IdNr."
            name="buyerVatId"
            value={buyerVatId}
            onChange={(e) => setBuyerVatId(e.target.value)}
          />
          <div className="md:col-span-2">
            <label className="text-sm font-medium mb-1 block">Adresse</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              value={buyerAddress}
              onChange={(e) => setBuyerAddress(e.target.value)}
              placeholder="Straße Nr.&#10;PLZ Ort"
            />
          </div>
          {(invoiceFormat === "xrechnung" || invoiceFormat === "zugferd") && (
            <>
              <FormInput
                title="Leitweg-ID"
                name="buyerLeitwegId"
                value={buyerLeitwegId}
                onChange={(e) => setBuyerLeitwegId(e.target.value)}
                placeholder="04011000-1234512345-06"
              />
              <FormInput
                title="Buyer Reference (BT-10)"
                name="buyerReference"
                value={buyerReference}
                onChange={(e) => setBuyerReference(e.target.value)}
                placeholder="Leitweg-ID oder Bestellnummer"
              />
            </>
          )}
        </div>
      </Card>

      {/* Invoice Details */}
      <Card className="p-6">
        <CardTitle className="mb-4">Rechnungsdetails</CardTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <FormInput
            title="Rechnungsnummer"
            name="invoiceNumber"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            required
          />
          <FormInput
            title="Rechnungsdatum"
            name="invoiceDate"
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            required
          />
          <FormInput
            title="Leistungsdatum"
            name="serviceDate"
            type="date"
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
          />
          <FormInput
            title="Zahlungsziel"
            name="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div className="flex gap-6 mt-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={kleinunternehmer}
              onChange={(e) => setKleinunternehmer(e.target.checked)}
              className="rounded border-gray-300"
            />
            Kleinunternehmer (§19 UStG)
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={reverseCharge}
              onChange={(e) => setReverseCharge(e.target.checked)}
              className="rounded border-gray-300"
            />
            Reverse Charge (§13b UStG)
          </label>
        </div>
      </Card>

      {/* Line Items */}
      <Card className="p-6">
        <CardTitle className="mb-4">Positionen</CardTitle>
        <div className="space-y-3">
          {/* Header */}
          <div className="hidden md:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
            <div className="col-span-1">Pos.</div>
            <div className="col-span-3">Beschreibung</div>
            <div className="col-span-1">Menge</div>
            <div className="col-span-2">Einheit</div>
            <div className="col-span-2">Einzelpreis (EUR)</div>
            <div className="col-span-1">USt %</div>
            <div className="col-span-1 text-right">Gesamt</div>
            <div className="col-span-1"></div>
          </div>

          {items.map((item, index) => {
            const lineTotal = item.quantity * item.unitPrice
            return (
              <div
                key={index}
                className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md p-2 md:border-0 md:p-0"
              >
                <div className="col-span-1 text-sm text-muted-foreground text-center">
                  {item.position}
                </div>
                <div className="col-span-3">
                  <input
                    className="flex w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    placeholder="Beschreibung"
                    value={item.description}
                    onChange={(e) => updateItem(index, "description", e.target.value)}
                  />
                </div>
                <div className="col-span-1">
                  <input
                    className="flex w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-right"
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, "quantity", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="col-span-2">
                  <select
                    className="flex w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={item.unit}
                    onChange={(e) => updateItem(index, "unit", e.target.value)}
                  >
                    <option value="Stunden">Stunden</option>
                    <option value="Stück">Stück</option>
                    <option value="Pauschal">Pauschal</option>
                    <option value="Tage">Tage</option>
                    <option value="Monate">Monate</option>
                    <option value="km">km</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <input
                    className="flex w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-right"
                    type="number"
                    min="0"
                    step="0.01"
                    value={(item.unitPrice / 100).toFixed(2)}
                    onChange={(e) =>
                      updateItem(index, "unitPrice", Math.round(parseFloat(e.target.value || "0") * 100))
                    }
                  />
                </div>
                <div className="col-span-1">
                  <select
                    className="flex w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={item.taxRate}
                    onChange={(e) => updateItem(index, "taxRate", parseInt(e.target.value))}
                  >
                    <option value={19}>19%</option>
                    <option value={7}>7%</option>
                    <option value={0}>0%</option>
                  </select>
                </div>
                <div className="col-span-1 text-sm text-right font-medium">
                  {formatCents(lineTotal)}
                </div>
                <div className="col-span-1 text-right">
                  {items.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(index)}
                      className="h-7 w-7 p-0"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <Button variant="outline" size="sm" onClick={addItem} className="mt-3">
          <Plus className="w-3.5 h-3.5 mr-1" /> Position hinzufügen
        </Button>
      </Card>

      {/* Totals Preview */}
      <Card className="p-6">
        <CardTitle className="mb-4">Summen</CardTitle>
        <div className="space-y-2 max-w-sm ml-auto">
          <div className="flex justify-between text-sm">
            <span>Nettobetrag</span>
            <span>{formatCents(totals.netTotal)} EUR</span>
          </div>
          {!kleinunternehmer &&
            totals.taxBreakdown.map((tax) => (
              <div key={tax.rate} className="flex justify-between text-sm text-muted-foreground">
                <span>USt {tax.rate}%</span>
                <span>{formatCents(tax.tax)} EUR</span>
              </div>
            ))}
          <div className="flex justify-between font-semibold text-base border-t pt-2">
            <span>Bruttobetrag</span>
            <span>{formatCents(totals.grossTotal)} EUR</span>
          </div>
          {kleinunternehmer && (
            <p className="text-xs text-muted-foreground italic">
              Gemäß §19 UStG wird keine Umsatzsteuer berechnet.
            </p>
          )}
          {reverseCharge && (
            <p className="text-xs text-muted-foreground italic">
              Steuerschuldnerschaft des Leistungsempfängers (§13b UStG)
            </p>
          )}
        </div>
      </Card>

      {/* Note */}
      <Card className="p-6">
        <CardTitle className="mb-4">Freitext / Hinweis</CardTitle>
        <textarea
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optionaler Hinweis auf der Rechnung..."
        />
      </Card>

      {/* XRechnung: Upload & Validate */}
      {(invoiceFormat === "xrechnung" || invoiceFormat === "zugferd") && (
        <Card className="p-6">
          <CardTitle className="mb-4">XRechnung validieren (optional)</CardTitle>
          <p className="text-sm text-muted-foreground mb-3">
            Laden Sie eine bestehende XRechnung-XML-Datei zur Validierung hoch.
          </p>
          <input
            type="file"
            accept=".xml,application/xml,text/xml"
            onChange={handleValidateUploadedXml}
            className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
          />
        </Card>
      )}

      {/* Validation Results */}
      {validationResult && (
        <Card className="p-6">
          <CardTitle className="mb-4 flex items-center gap-2">
            <FileCheck className="w-5 h-5" />
            Validierungsergebnis
          </CardTitle>
          {validationResult.valid ? (
            <div className="text-sm text-green-700 bg-green-50 p-3 rounded-md mb-3">
              XRechnung ist gueltig.
            </div>
          ) : (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md mb-3">
              XRechnung-Validierung fehlgeschlagen.
            </div>
          )}
          {validationResult.errors.length > 0 && (
            <div className="mb-3">
              <h4 className="text-sm font-medium text-destructive mb-1">Fehler:</h4>
              <ul className="list-disc list-inside space-y-1">
                {validationResult.errors.map((err, i) => (
                  <li key={i} className="text-sm text-destructive">{err}</li>
                ))}
              </ul>
            </div>
          )}
          {validationResult.warnings.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-yellow-700 mb-1">Warnungen:</h4>
              <ul className="list-disc list-inside space-y-1">
                {validationResult.warnings.map((warn, i) => (
                  <li key={i} className="text-sm text-yellow-700">{warn}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* XML Preview */}
      {xmlPreview && (invoiceFormat === "xrechnung" || invoiceFormat === "zugferd") && (
        <Card className="p-6">
          <CardTitle className="mb-4 flex items-center gap-2">
            <FileCode2 className="w-5 h-5" />
            XML-Vorschau
          </CardTitle>
          <div className="relative">
            <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto max-h-96 overflow-y-auto font-mono whitespace-pre-wrap">
              {xmlPreview}
            </pre>
            <Button
              variant="outline"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => {
                triggerDownload(xmlPreview, `${invoiceNumber}.xml`, "application/xml")
              }}
            >
              <FileDown className="w-3.5 h-3.5 mr-1" />
              XML herunterladen
            </Button>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
      )}

      {/* Generate Buttons */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={handleGenerate} disabled={generating} size="lg">
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {invoiceFormat === "pdf" ? "PDF wird erstellt..." : invoiceFormat === "xrechnung" ? "XRechnung wird erstellt..." : "ZUGFeRD wird erstellt..."}
            </>
          ) : (
            <>
              {invoiceFormat === "xrechnung" ? (
                <FileCode2 className="w-4 h-4 mr-2" />
              ) : (
                <FileDown className="w-4 h-4 mr-2" />
              )}
              {invoiceFormat === "pdf"
                ? "PDF erstellen"
                : invoiceFormat === "xrechnung"
                  ? "XRechnung erstellen"
                  : "ZUGFeRD erstellen (PDF + XML)"}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
