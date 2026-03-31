"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Building2,
  ArrowRight,
  ArrowLeft,
  Rocket,
  Landmark,
  BookOpen,
  Puzzle,
  PartyPopper,
  CheckCircle2,
  AlertCircle,
  Loader2,
  SkipForward,
  Search,
} from "lucide-react"
import StepIndicator from "./step-indicator"
import {
  saveCompanyProfileAction,
  completeOnboardingAction,
  validateTaxNumberAction,
  validateVatIdAction,
  lookupBankForOnboardingAction,
  type CompanyProfileData,
} from "../actions"

const LEGAL_FORMS = [
  { code: "einzelunternehmen", name: "Einzelunternehmen", skr: "SKR03" },
  { code: "gmbh", name: "GmbH", skr: "SKR04" },
  { code: "ug", name: "UG (haftungsbeschränkt)", skr: "SKR04" },
  { code: "gbr", name: "GbR", skr: "SKR03" },
  { code: "freiberufler", name: "Freiberufler", skr: "SKR03" },
  { code: "verein", name: "Verein", skr: "SKR03" },
]

const SKR_INFO = {
  SKR03: {
    name: "SKR03 (Prozessgliederungsprinzip)",
    description: "Gliederung nach betrieblichen Abläufen. Standard für Einzelunternehmen, Freiberufler und Personengesellschaften.",
    accounts: [
      "0100-0999: Anlage- und Kapitalkonten",
      "1000-1999: Finanz- und Privatkonten",
      "2000-2999: Abgrenzungskonten",
      "3000-3999: Wareneingangskonten",
      "4000-4999: Betriebliche Aufwendungen",
      "8000-8999: Erlöskonten",
    ],
  },
  SKR04: {
    name: "SKR04 (Abschlussgliederungsprinzip)",
    description: "Gliederung nach Bilanzpositionen. Standard für Kapitalgesellschaften (GmbH, UG).",
    accounts: [
      "0100-0999: Anlagevermögen",
      "1000-1999: Umlaufvermögen",
      "2000-2999: Eigenkapital",
      "3000-3999: Fremdkapital",
      "4000-4999: Betriebliche Erträge",
      "5000-7999: Betriebliche Aufwendungen",
    ],
  },
}

type BankLookupResult = { bankName: string; fintsUrl: string; bic: string } | null

export default function OnboardingWizard({ initialData }: { initialData?: CompanyProfileData | null }) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1: Welcome
  const [legalForm, setLegalForm] = useState(initialData?.legalForm || "")

  // Step 2: Company data
  const [companyName, setCompanyName] = useState(initialData?.companyName || "")
  const [street, setStreet] = useState(initialData?.street || "")
  const [zipCode, setZipCode] = useState(initialData?.zipCode || "")
  const [city, setCity] = useState(initialData?.city || "")
  const [taxNumber, setTaxNumber] = useState(initialData?.taxNumber || "")
  const [taxNumberValid, setTaxNumberValid] = useState<boolean | null>(null)
  const [vatId, setVatId] = useState(initialData?.vatId || "")
  const [vatIdValid, setVatIdValid] = useState<boolean | null>(null)
  const [taxOffice, setTaxOffice] = useState(initialData?.taxOffice || "")
  const [fiscalYearStart, setFiscalYearStart] = useState(initialData?.fiscalYearStart || "01-01")
  const [phone, setPhone] = useState(initialData?.phone || "")
  const [email, setEmail] = useState(initialData?.email || "")
  const [website, setWebsite] = useState(initialData?.website || "")

  // Step 3: Bank
  const [bankSetup, setBankSetup] = useState<"fints" | "skip">("skip")
  const [blz, setBlz] = useState("")
  const [bankLookup, setBankLookup] = useState<BankLookupResult>(null)
  const [bankLookupLoading, setBankLookupLoading] = useState(false)
  const [bankLookupError, setBankLookupError] = useState<string | null>(null)

  // Step 4: Chart of accounts
  const recommendedSKR = LEGAL_FORMS.find((f) => f.code === legalForm)?.skr || "SKR04"
  const [chartOfAccounts, setChartOfAccounts] = useState(initialData?.chartOfAccounts || recommendedSKR)

  // Step 5: Integrations
  const [erpnextUrl, setErpnextUrl] = useState(initialData?.erpnextUrl || "")
  const [erpnextApiKey, setErpnextApiKey] = useState(initialData?.erpnextApiKey || "")
  const [erpnextApiSecret, setErpnextApiSecret] = useState(initialData?.erpnextApiSecret || "")
  const [sageExportEnabled, setSageExportEnabled] = useState(initialData?.sageExportEnabled || false)
  const [telegramBotToken, setTelegramBotToken] = useState(initialData?.telegramBotToken || "")
  const [telegramChatId, setTelegramChatId] = useState(initialData?.telegramChatId || "")
  const [datevConsultant, setDatevConsultant] = useState(initialData?.datevConsultant || "")
  const [datevClient, setDatevClient] = useState(initialData?.datevClient || "")

  const getProfileData = useCallback((): CompanyProfileData => ({
    companyName,
    legalForm,
    street,
    zipCode,
    city,
    taxNumber,
    vatId,
    taxOffice,
    fiscalYearStart,
    phone,
    email,
    website,
    chartOfAccounts,
    erpnextUrl: erpnextUrl || undefined,
    erpnextApiKey: erpnextApiKey || undefined,
    erpnextApiSecret: erpnextApiSecret || undefined,
    sageExportEnabled,
    telegramBotToken: telegramBotToken || undefined,
    telegramChatId: telegramChatId || undefined,
    datevConsultant: datevConsultant || undefined,
    datevClient: datevClient || undefined,
  }), [
    companyName, legalForm, street, zipCode, city, taxNumber, vatId, taxOffice,
    fiscalYearStart, phone, email, website, chartOfAccounts, erpnextUrl,
    erpnextApiKey, erpnextApiSecret, sageExportEnabled, telegramBotToken,
    telegramChatId, datevConsultant, datevClient,
  ])

  async function handleSaveAndNext() {
    setSaving(true)
    setError(null)
    try {
      const result = await saveCompanyProfileAction(getProfileData())
      if (!result.success) {
        setError(result.error || "Fehler beim Speichern")
        return
      }
      setCurrentStep((prev) => Math.min(prev + 1, 6))
    } catch {
      setError("Ein unerwarteter Fehler ist aufgetreten.")
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete() {
    setCompleting(true)
    setError(null)
    try {
      // Save final data
      await saveCompanyProfileAction(getProfileData())
      const result = await completeOnboardingAction()
      if (!result.success) {
        setError(result.error || "Fehler beim Abschließen")
        return
      }
      router.push("/")
    } catch {
      setError("Ein unerwarteter Fehler ist aufgetreten.")
    } finally {
      setCompleting(false)
    }
  }

  async function handleValidateTaxNumber(value: string) {
    setTaxNumber(value)
    if (value.length >= 10) {
      const result = await validateTaxNumberAction(value)
      setTaxNumberValid(result.data?.valid ?? null)
    } else {
      setTaxNumberValid(null)
    }
  }

  async function handleValidateVatId(value: string) {
    setVatId(value)
    if (value.length >= 11) {
      const result = await validateVatIdAction(value)
      setVatIdValid(result.data?.valid ?? null)
    } else {
      setVatIdValid(null)
    }
  }

  async function handleBankLookup() {
    if (!blz || blz.length !== 8) return
    setBankLookupLoading(true)
    setBankLookupError(null)
    try {
      const result = await lookupBankForOnboardingAction(blz)
      if (result.success && result.data) {
        setBankLookup(result.data)
      } else {
        setBankLookupError(result.error || "Bank nicht gefunden.")
        setBankLookup(null)
      }
    } catch {
      setBankLookupError("Fehler bei der Banksuche.")
    } finally {
      setBankLookupLoading(false)
    }
  }

  function handleBack() {
    setCurrentStep((prev) => Math.max(prev - 1, 1))
    setError(null)
  }

  // --- Step renderers ---

  function renderStep1() {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-2">
            <Rocket className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold">Willkommen bei TaxHacker!</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Dein persönlicher KI-Buchhalter. In wenigen Schritten richten wir alles für
            dein Unternehmen ein.
          </p>
        </div>

        <div className="space-y-3">
          <Label className="text-base font-semibold">Welche Rechtsform hat dein Unternehmen?</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {LEGAL_FORMS.map((form) => (
              <button
                key={form.code}
                type="button"
                onClick={() => {
                  setLegalForm(form.code)
                  setChartOfAccounts(form.skr)
                }}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 text-left transition-colors ${
                  legalForm === form.code
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <Building2 className={`w-5 h-5 flex-shrink-0 ${legalForm === form.code ? "text-primary" : "text-muted-foreground"}`} />
                <div>
                  <div className="font-medium">{form.name}</div>
                  <div className="text-xs text-muted-foreground">Empfohlen: {form.skr}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderStep2() {
    const selectedForm = LEGAL_FORMS.find((f) => f.code === legalForm)
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Building2 className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">Unternehmensdaten</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="companyName">Firmenname</Label>
            <Input
              id="companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Mein Unternehmen GmbH"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Rechtsform</Label>
            <Input value={selectedForm?.name || "Nicht ausgewählt"} disabled className="bg-muted" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="taxOffice">Finanzamt</Label>
            <Input
              id="taxOffice"
              value={taxOffice}
              onChange={(e) => setTaxOffice(e.target.value)}
              placeholder="Finanzamt München I"
            />
          </div>

          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="street">Straße und Hausnummer</Label>
            <Input
              id="street"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="Musterstraße 1"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="zipCode">PLZ</Label>
            <Input
              id="zipCode"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
              placeholder="80331"
              maxLength={5}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="city">Ort</Label>
            <Input
              id="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="München"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="taxNumber">
              Steuernummer
              {taxNumberValid === true && <CheckCircle2 className="inline w-4 h-4 ml-1 text-green-500" />}
              {taxNumberValid === false && <AlertCircle className="inline w-4 h-4 ml-1 text-destructive" />}
            </Label>
            <Input
              id="taxNumber"
              value={taxNumber}
              onChange={(e) => handleValidateTaxNumber(e.target.value)}
              placeholder="123/456/78901"
            />
            <p className="text-xs text-muted-foreground">Format: FF/BBB/UUUUP oder FFB/BB/UUUUP</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vatId">
              USt-IdNr.
              {vatIdValid === true && <CheckCircle2 className="inline w-4 h-4 ml-1 text-green-500" />}
              {vatIdValid === false && <AlertCircle className="inline w-4 h-4 ml-1 text-destructive" />}
            </Label>
            <Input
              id="vatId"
              value={vatId}
              onChange={(e) => handleValidateVatId(e.target.value)}
              placeholder="DE123456789"
            />
            <p className="text-xs text-muted-foreground">Format: DE + 9 Ziffern</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fiscalYearStart">Geschäftsjahr-Beginn</Label>
            <Input
              id="fiscalYearStart"
              value={fiscalYearStart}
              onChange={(e) => setFiscalYearStart(e.target.value)}
              placeholder="01-01"
            />
            <p className="text-xs text-muted-foreground">Format: MM-TT (Standard: 01-01)</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Telefon</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+49 89 12345678"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">E-Mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="info@unternehmen.de"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://unternehmen.de"
            />
          </div>
        </div>
      </div>
    )
  }

  function renderStep3() {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Landmark className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">Bankverbindung</h2>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setBankSetup("fints")}
              className={`flex items-center gap-3 p-4 rounded-lg border-2 text-left transition-colors ${
                bankSetup === "fints"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <Landmark className={`w-5 h-5 flex-shrink-0 ${bankSetup === "fints" ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <div className="font-medium">FinTS/HBCI Verbindung</div>
                <div className="text-xs text-muted-foreground">Bankkonto jetzt verbinden</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setBankSetup("skip")}
              className={`flex items-center gap-3 p-4 rounded-lg border-2 text-left transition-colors ${
                bankSetup === "skip"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <SkipForward className={`w-5 h-5 flex-shrink-0 ${bankSetup === "skip" ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <div className="font-medium">Später einrichten</div>
                <div className="text-xs text-muted-foreground">Im Banking-Bereich nachholen</div>
              </div>
            </button>
          </div>

          {bankSetup === "fints" && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="blz">Bankleitzahl (BLZ)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="blz"
                      value={blz}
                      onChange={(e) => {
                        setBlz(e.target.value)
                        setBankLookup(null)
                        setBankLookupError(null)
                      }}
                      placeholder="12345678"
                      maxLength={8}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleBankLookup}
                      disabled={blz.length !== 8 || bankLookupLoading}
                    >
                      {bankLookupLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                      <span className="ml-1.5">Suchen</span>
                    </Button>
                  </div>
                </div>

                {bankLookupError && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    {bankLookupError}
                  </div>
                )}

                {bankLookup && (
                  <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <span className="font-medium">{bankLookup.bankName}</span>
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <div>FinTS URL: {bankLookup.fintsUrl}</div>
                      <div>BIC: {bankLookup.bic}</div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Die vollständige Bankverbindung (Zugangsdaten, IBAN, etc.) kannst du nach dem Onboarding
                      im Banking-Bereich einrichten.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {bankSetup === "skip" && (
            <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
              Du kannst deine Bankverbindung jederzeit im Banking-Bereich einrichten.
              Dort verbindest du dein Konto via FinTS und importierst automatisch Umsätze.
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderStep4() {
    const skrInfo = SKR_INFO[chartOfAccounts as keyof typeof SKR_INFO] || SKR_INFO.SKR04

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">Kontenrahmen</h2>
        </div>

        <p className="text-sm text-muted-foreground">
          Basierend auf deiner Rechtsform ({LEGAL_FORMS.find((f) => f.code === legalForm)?.name || "nicht angegeben"})
          empfehlen wir <strong>{recommendedSKR}</strong>.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(["SKR03", "SKR04"] as const).map((skr) => (
            <button
              key={skr}
              type="button"
              onClick={() => setChartOfAccounts(skr)}
              className={`flex flex-col gap-2 p-4 rounded-lg border-2 text-left transition-colors ${
                chartOfAccounts === skr
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="font-semibold">{skr}</div>
                {skr === recommendedSKR && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    Empfohlen
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {SKR_INFO[skr].description}
              </div>
            </button>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{skrInfo.name}</CardTitle>
            <CardDescription>{skrInfo.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {skrInfo.accounts.map((account, i) => (
                <div key={i} className="text-sm font-mono text-muted-foreground">
                  {account}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  function renderStep5() {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Puzzle className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">Integrationen</h2>
        </div>

        <p className="text-sm text-muted-foreground">
          Alle Integrationen sind optional und können jederzeit später konfiguriert werden.
        </p>

        {/* ERPNext */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ERPNext</CardTitle>
            <CardDescription>Verbinde TaxHacker mit deinem ERPNext-System</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="erpnextUrl">ERPNext URL</Label>
              <Input
                id="erpnextUrl"
                value={erpnextUrl}
                onChange={(e) => setErpnextUrl(e.target.value)}
                placeholder="https://mein-erp.erpnext.com"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="erpnextApiKey">API Key</Label>
                <Input
                  id="erpnextApiKey"
                  value={erpnextApiKey}
                  onChange={(e) => setErpnextApiKey(e.target.value)}
                  placeholder="API Key"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="erpnextApiSecret">API Secret</Label>
                <Input
                  id="erpnextApiSecret"
                  type="password"
                  value={erpnextApiSecret}
                  onChange={(e) => setErpnextApiSecret(e.target.value)}
                  placeholder="API Secret"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sage Export */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sage Export</CardTitle>
            <CardDescription>Exportiere Buchungsdaten im Sage-kompatiblen Format</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Checkbox
                id="sageExport"
                checked={sageExportEnabled}
                onCheckedChange={(checked) => setSageExportEnabled(checked === true)}
              />
              <Label htmlFor="sageExport" className="cursor-pointer">
                Sage-Export aktivieren
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Telegram */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Telegram Bot</CardTitle>
            <CardDescription>Erhalte Benachrichtigungen via Telegram</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="telegramBotToken">Bot Token</Label>
                <Input
                  id="telegramBotToken"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="telegramChatId">Chat ID</Label>
                <Input
                  id="telegramChatId"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="-100123456789"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* DATEV */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">DATEV-Berater</CardTitle>
            <CardDescription>Angaben für den DATEV-Export an deinen Steuerberater</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="datevConsultant">Beraternummer</Label>
                <Input
                  id="datevConsultant"
                  value={datevConsultant}
                  onChange={(e) => setDatevConsultant(e.target.value)}
                  placeholder="1234567"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="datevClient">Mandantennummer</Label>
                <Input
                  id="datevClient"
                  value={datevClient}
                  onChange={(e) => setDatevClient(e.target.value)}
                  placeholder="12345"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  function renderStep6() {
    const configured: string[] = []
    const skipped: string[] = []

    if (companyName) configured.push("Firmenname"); else skipped.push("Firmenname")
    if (legalForm) configured.push("Rechtsform"); else skipped.push("Rechtsform")
    if (street && zipCode && city) configured.push("Adresse"); else skipped.push("Adresse")
    if (taxNumber) configured.push("Steuernummer"); else skipped.push("Steuernummer")
    if (vatId) configured.push("USt-IdNr."); else skipped.push("USt-IdNr.")
    if (taxOffice) configured.push("Finanzamt"); else skipped.push("Finanzamt")
    if (chartOfAccounts) configured.push(`Kontenrahmen (${chartOfAccounts})`);
    if (bankSetup === "fints" && bankLookup) configured.push("Bankverbindung prüfbereit"); else skipped.push("Bankverbindung")
    if (erpnextUrl) configured.push("ERPNext"); else skipped.push("ERPNext")
    if (sageExportEnabled) configured.push("Sage Export");
    if (telegramBotToken) configured.push("Telegram Bot"); else skipped.push("Telegram Bot")
    if (datevConsultant) configured.push("DATEV-Berater"); else skipped.push("DATEV-Berater")

    return (
      <div className="space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-2">
            <PartyPopper className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-2xl font-bold">Alles bereit!</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Deine Einrichtung ist abgeschlossen. Hier ist eine Zusammenfassung.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Eingerichtet
              </CardTitle>
            </CardHeader>
            <CardContent>
              {configured.length > 0 ? (
                <ul className="space-y-1.5">
                  {configured.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Keine Einstellungen konfiguriert.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <SkipForward className="w-4 h-4 text-muted-foreground" />
                Noch offen
              </CardTitle>
            </CardHeader>
            <CardContent>
              {skipped.length > 0 ? (
                <ul className="space-y-1.5">
                  {skipped.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="w-3.5 h-3.5 rounded-full border flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-green-600">Alles konfiguriert!</p>
              )}
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          Alle Einstellungen können jederzeit in den jeweiligen Bereichen angepasst werden.
        </p>
      </div>
    )
  }

  const stepRenderers: Record<number, () => React.ReactNode> = {
    1: renderStep1,
    2: renderStep2,
    3: renderStep3,
    4: renderStep4,
    5: renderStep5,
    6: renderStep6,
  }

  const canProceed = currentStep === 1 ? !!legalForm : true

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <StepIndicator currentStep={currentStep} />

      <Card className="p-6 sm:p-8">
        {stepRenderers[currentStep]?.()}

        {error && (
          <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex justify-between mt-8 pt-4 border-t">
          {currentStep > 1 ? (
            <Button variant="outline" onClick={handleBack} disabled={saving || completing}>
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Zurück
            </Button>
          ) : (
            <div />
          )}

          {currentStep < 6 ? (
            <Button onClick={handleSaveAndNext} disabled={saving || !canProceed}>
              {saving ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-1.5" />
              )}
              {saving ? "Speichern..." : "Weiter"}
            </Button>
          ) : (
            <Button onClick={handleComplete} disabled={completing}>
              {completing ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4 mr-1.5" />
              )}
              {completing ? "Wird abgeschlossen..." : "Los geht's!"}
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}
