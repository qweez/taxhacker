/**
 * German invoice analysis prompt and schema.
 *
 * Extracts all mandatory fields required by section 14 UStG (Umsatzsteuergesetz)
 * plus common optional fields found on German invoices.
 *
 * Designed to work with the existing `requestLLM` interface defined in
 * `ai/providers/llmProvider.ts`.  The prompt text is passed as the `prompt`
 * field of an `LLMRequest`, and the schema is passed as the `schema` field.
 */

// ---------------------------------------------------------------------------
// System / instruction prompt
// ---------------------------------------------------------------------------

export const GERMAN_INVOICE_SYSTEM_PROMPT = `Du bist ein Buchhalter und Rechnungsanalyst fuer deutsche Unternehmen.
Analysiere das beigefuegte Dokument und extrahiere alle Pflichtangaben gemaess Paragraph 14 UStG sowie weitere relevante Rechnungsinformationen.

Extrahiere die folgenden Felder:

PFLICHTANGABEN (Paragraph 14 UStG):
- rechnungsnummer: Eindeutige Rechnungsnummer
- rechnungsdatum: Ausstellungsdatum der Rechnung (YYYY-MM-DD)
- leistungsdatum: Liefer- oder Leistungsdatum bzw. Leistungszeitraum (YYYY-MM-DD oder Zeitraum als Text)
- verkaeufer_name: Vollstaendiger Name oder Firma des leistenden Unternehmers
- verkaeufer_anschrift: Vollstaendige Anschrift des leistenden Unternehmers
- verkaeufer_steuernummer: Steuernummer des Verkaeufers (Format: XX/XXX/XXXXX)
- verkaeufer_ust_id: Umsatzsteuer-Identifikationsnummer des Verkaeufers (Format: DEXXXXXXXXX)
- kaeufer_name: Vollstaendiger Name oder Firma des Leistungsempfaengers
- kaeufer_anschrift: Vollstaendige Anschrift des Leistungsempfaengers

POSITIONEN (Menge und Art der Lieferung/Leistung):
- positionen: Alle einzelnen Rechnungspositionen mit Bezeichnung, Menge, Einzelpreis und Gesamtpreis

BETRAEGE:
- nettobetrag: Gesamtbetrag ohne Umsatzsteuer (Entgelt)
- steuersatz: Angewandter Umsatzsteuersatz (19%, 7%, oder 0% bei steuerfreien Leistungen)
- steuerbetrag: Umsatzsteuerbetrag in Euro
- bruttobetrag: Gesamtbetrag inklusive Umsatzsteuer

ZUSAETZLICHE FELDER:
- zahlungsziel: Faelligkeitsdatum oder Zahlungsfrist (YYYY-MM-DD oder Text wie "30 Tage netto")
- bankverbindung_iban: IBAN des Verkaeufers
- bankverbindung_bic: BIC/SWIFT des Verkaeufers
- bankverbindung_bank: Name der Bank des Verkaeufers
- skonto: Skonto-Bedingungen, falls vorhanden (z.B. "2% bei Zahlung innerhalb 10 Tagen")
- waehrung: Waehrungscode (ISO 4217, z.B. EUR)
- hinweise: Besondere Hinweise auf der Rechnung (z.B. "Steuerschuldnerschaft des Leistungsempfaengers", "Kleinunternehmerregelung nach Paragraph 19 UStG")

BESTEHENDE TRANSAKTIONSFELDER:
{fields}

Kategorien:
{categories}

Projekte:
{projects}

WICHTIGE REGELN:
- Wenn ein Feld nicht auf der Rechnung zu finden ist, lasse es leer. Erfinde NIEMALS Informationen.
- Betraege immer als Zahl ohne Waehrungszeichen angeben (z.B. 119.00 statt 119,00 EUR).
- Datumsangaben im Format YYYY-MM-DD zurueckgeben.
- Steuersatz als Zahl angeben (z.B. 19 fuer 19%).
- Bei gemischten Steuersaetzen den hoechsten Satz im Feld steuersatz angeben und Details in den Positionen aufschluesseln.
- Bei Kleinunternehmerregelung (Paragraph 19 UStG): steuersatz = 0, steuerbetrag = 0, und Hinweis im Feld hinweise.
- Gib nur ein einzelnes JSON-Objekt zurueck, keinen weiteren Text.`

// ---------------------------------------------------------------------------
// JSON schema for structured LLM output
// ---------------------------------------------------------------------------

export const GERMAN_INVOICE_SCHEMA = {
  type: "object" as const,
  properties: {
    // -- Pflichtangaben nach Paragraph 14 UStG --
    rechnungsnummer: {
      type: "string",
      description: "Eindeutige Rechnungsnummer",
    },
    rechnungsdatum: {
      type: "string",
      description: "Ausstellungsdatum der Rechnung (YYYY-MM-DD)",
    },
    leistungsdatum: {
      type: "string",
      description:
        "Liefer- oder Leistungsdatum bzw. Leistungszeitraum (YYYY-MM-DD oder Zeitraum)",
    },
    verkaeufer_name: {
      type: "string",
      description: "Vollstaendiger Name oder Firma des leistenden Unternehmers",
    },
    verkaeufer_anschrift: {
      type: "string",
      description: "Vollstaendige Anschrift des Verkaeufers",
    },
    verkaeufer_steuernummer: {
      type: "string",
      description: "Steuernummer des Verkaeufers (z.B. 12/345/67890)",
    },
    verkaeufer_ust_id: {
      type: "string",
      description: "USt-IdNr. des Verkaeufers (z.B. DE123456789)",
    },
    kaeufer_name: {
      type: "string",
      description: "Vollstaendiger Name oder Firma des Leistungsempfaengers",
    },
    kaeufer_anschrift: {
      type: "string",
      description: "Vollstaendige Anschrift des Leistungsempfaengers",
    },

    // -- Positionen --
    positionen: {
      type: "array",
      description:
        "Einzelne Rechnungspositionen mit Bezeichnung, Menge, Einzelpreis und Gesamtpreis",
      items: {
        type: "object",
        properties: {
          bezeichnung: {
            type: "string",
            description: "Bezeichnung der Ware oder Dienstleistung",
          },
          menge: {
            type: "number",
            description: "Menge oder Anzahl",
          },
          einheit: {
            type: "string",
            description: "Mengeneinheit (z.B. Stueck, Stunden, kg)",
          },
          einzelpreis: {
            type: "number",
            description: "Preis pro Einheit netto",
          },
          gesamtpreis: {
            type: "number",
            description: "Gesamtpreis der Position netto",
          },
          steuersatz: {
            type: "number",
            description: "USt-Satz fuer diese Position (z.B. 19, 7, 0)",
          },
        },
        required: ["bezeichnung", "gesamtpreis"],
        additionalProperties: false,
      },
    },

    // -- Betraege --
    nettobetrag: {
      type: "number",
      description: "Gesamtbetrag ohne Umsatzsteuer (Netto)",
    },
    steuersatz: {
      type: "number",
      description:
        "Angewandter Umsatzsteuersatz in Prozent (19, 7 oder 0)",
    },
    steuerbetrag: {
      type: "number",
      description: "Umsatzsteuerbetrag in Euro",
    },
    bruttobetrag: {
      type: "number",
      description: "Gesamtbetrag inklusive Umsatzsteuer (Brutto)",
    },

    // -- Zahlungsinformationen --
    zahlungsziel: {
      type: "string",
      description:
        "Faelligkeitsdatum oder Zahlungsfrist (YYYY-MM-DD oder Text)",
    },
    bankverbindung_iban: {
      type: "string",
      description: "IBAN des Verkaeufers",
    },
    bankverbindung_bic: {
      type: "string",
      description: "BIC/SWIFT des Verkaeufers",
    },
    bankverbindung_bank: {
      type: "string",
      description: "Name der Bank des Verkaeufers",
    },
    skonto: {
      type: "string",
      description:
        "Skonto-Bedingungen (z.B. 2% bei Zahlung innerhalb 10 Tagen)",
    },

    // -- Sonstige Felder --
    waehrung: {
      type: "string",
      description: "Waehrungscode ISO 4217 (z.B. EUR)",
    },
    hinweise: {
      type: "string",
      description:
        "Besondere Hinweise (z.B. Kleinunternehmerregelung, Reverse Charge)",
    },

    // -- Bestehende Transaktionsfelder (Kompatibilitaet) --
    name: {
      type: "string",
      description:
        "Kurzbezeichnung der Transaktion (was wurde gekauft/bezahlt)",
    },
    description: {
      type: "string",
      description: "Beschreibung der Transaktion",
    },
    merchant: {
      type: "string",
      description:
        "Haendler-/Firmenname, Originalschreibweise beibehalten",
    },
    issuedAt: {
      type: "string",
      description: "Rechnungsdatum (YYYY-MM-DD)",
    },
    total: {
      type: "number",
      description: "Gesamtbetrag (Brutto) der Transaktion",
    },
    currencyCode: {
      type: "string",
      description: "Waehrungscode ISO 4217 (z.B. EUR)",
    },
    categoryCode: {
      type: "string",
      description: "Kategorie-Code passend zu den konfigurierten Kategorien",
    },
    projectCode: {
      type: "string",
      description: "Projekt-Code passend zu den konfigurierten Projekten",
    },
    vat_rate: {
      type: "number",
      description: "Umsatzsteuersatz in Prozent (0-100)",
    },
    vat: {
      type: "number",
      description: "Umsatzsteuerbetrag in Rechnungswaehrung",
    },
    text: {
      type: "string",
      description: "Gesamter erkannter Text der Rechnung",
    },

    // -- Items for multi-position splitting (Kompatibilitaet) --
    items: {
      type: "array",
      description:
        "Einzelne Produkte oder Transaktionen mit eigenem Namen und Preis",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Bezeichnung" },
          description: { type: "string", description: "Beschreibung" },
          merchant: { type: "string", description: "Haendlername" },
          issuedAt: { type: "string", description: "Datum (YYYY-MM-DD)" },
          total: { type: "number", description: "Gesamtbetrag" },
          currencyCode: { type: "string", description: "Waehrungscode" },
          categoryCode: { type: "string", description: "Kategorie-Code" },
          projectCode: { type: "string", description: "Projekt-Code" },
          vat_rate: { type: "number", description: "USt-Satz in Prozent" },
          vat: { type: "number", description: "USt-Betrag" },
        },
        required: ["name", "total"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "rechnungsnummer",
    "rechnungsdatum",
    "verkaeufer_name",
    "nettobetrag",
    "steuersatz",
    "steuerbetrag",
    "bruttobetrag",
    "name",
    "issuedAt",
    "total",
    "currencyCode",
    "items",
  ],
  additionalProperties: false,
} as const
