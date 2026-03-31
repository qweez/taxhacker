/**
 * ZUGFeRD / Factur-X / XRechnung e-invoice parser
 *
 * Extracts structured invoice data from:
 *  - ZUGFeRD/Factur-X PDFs (CII XML embedded in PDF)
 *  - XRechnung XML files (UBL format)
 *  - Raw CII or UBL XML strings
 */

export type ZUGFeRDParty = {
  name: string
  address: string | null
  taxId: string | null
  vatId: string | null
}

export type ZUGFeRDLineItem = {
  description: string
  quantity: number
  unitPrice: number
  total: number
  taxRate: number
}

export type ZUGFeRDTaxBreakdown = {
  rate: number
  base: number
  amount: number
}

export type ZUGFeRDInvoice = {
  invoiceNumber: string
  invoiceDate: string
  dueDate: string | null
  seller: ZUGFeRDParty
  buyer: ZUGFeRDParty
  lineItems: ZUGFeRDLineItem[]
  netTotal: number   // in cents
  taxTotal: number   // in cents
  grossTotal: number // in cents
  currency: string
  taxBreakdown: ZUGFeRDTaxBreakdown[]
  paymentTerms: string | null
  iban: string | null
  bic: string | null
  note: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a decimal string (e.g. "123.45") to integer cents */
function toCents(value: string | null | undefined): number {
  if (!value) return 0
  const cleaned = value.trim().replace(",", ".")
  const num = parseFloat(cleaned)
  if (isNaN(num)) return 0
  return Math.round(num * 100)
}

function toNumber(value: string | null | undefined): number {
  if (!value) return 0
  const cleaned = value.trim().replace(",", ".")
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

/**
 * Very small tag-content extractor.  Works for simple (non-nested-same-tag) XML.
 * Handles namespaced tags like <ram:ID>...</ram:ID>.
 * Returns the first match or null.
 */
function xmlText(xml: string, tagName: string): string | null {
  // Tag can appear as <ns:Tag ...> or <Tag ...>
  // We need to handle the namespace prefix being different, so we match on local name
  const localName = tagName.includes(":") ? tagName : `(?:[a-zA-Z0-9_-]+:)?${tagName}`
  const re = new RegExp(`<${localName}[^>]*>([^<]*)<\\/`, "s")
  const m = xml.match(re)
  return m ? m[1].trim() : null
}

/** Return all occurrences of a block enclosed by the given tag (with any namespace prefix) */
function xmlBlocks(xml: string, tagName: string): string[] {
  const localName = tagName.includes(":") ? tagName.split(":")[1] : tagName
  const re = new RegExp(`<([a-zA-Z0-9_-]+:)?${localName}[^>]*>([\\s\\S]*?)<\\/\\1?${localName}>`, "g")
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    results.push(m[0])
  }
  return results
}

/** Format a CII date (YYYYMMDD) or UBL date (YYYY-MM-DD) to YYYY-MM-DD */
function normalizeDate(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  // CII: 20240115
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
  }
  // UBL: 2024-01-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// PDF XML extraction
// ---------------------------------------------------------------------------

/**
 * Extract embedded ZUGFeRD / Factur-X / XRechnung XML from a PDF buffer.
 *
 * ZUGFeRD PDFs store the XML as an embedded file attachment.  We scan the raw
 * PDF bytes for known XML root elements rather than fully parsing the PDF
 * structure, which keeps the implementation dependency-free.
 */
export async function extractZUGFeRDFromPDF(pdfBuffer: Buffer): Promise<string | null> {
  const raw = pdfBuffer.toString("latin1")

  // Strategy 1: Look for well-known XML markers in the raw PDF stream.
  // ZUGFeRD/Factur-X uses CII, XRechnung may use UBL.
  const markers = [
    "<rsm:CrossIndustryInvoice",
    "<CrossIndustryInvoice",
    "<Invoice xmlns",
    "<ubl:Invoice",
  ]

  for (const marker of markers) {
    const startIdx = raw.indexOf(marker)
    if (startIdx === -1) continue

    // Walk backwards to find the XML declaration or the very start of the XML
    let xmlStart = startIdx
    const prefixSearch = raw.lastIndexOf("<?xml", startIdx)
    if (prefixSearch !== -1 && startIdx - prefixSearch < 500) {
      xmlStart = prefixSearch
    }

    // Find the closing root tag
    // Determine the root tag name from the marker
    let rootClose: string
    if (marker.includes("CrossIndustryInvoice")) {
      const prefix = marker.startsWith("<rsm:") ? "rsm:" : ""
      rootClose = `</${prefix}CrossIndustryInvoice>`
    } else if (marker.includes("ubl:Invoice")) {
      rootClose = "</ubl:Invoice>"
    } else {
      rootClose = "</Invoice>"
    }

    let endIdx = raw.indexOf(rootClose, startIdx)
    if (endIdx === -1) continue
    endIdx += rootClose.length

    const xmlCandidate = raw.slice(xmlStart, endIdx)

    // Sanity check – should look like valid XML
    if (xmlCandidate.includes("<") && xmlCandidate.includes(">")) {
      // Re-encode to UTF-8 from the original buffer (latin1 may have mangled multi-byte chars)
      // Extract using byte offsets from the original buffer
      const bufferSlice = pdfBuffer.subarray(xmlStart, endIdx)
      const utf8 = bufferSlice.toString("utf-8")
      // If UTF-8 decoding looks reasonable, use it; otherwise fall back to latin1
      if (utf8.includes("<") && utf8.includes(">")) {
        return utf8
      }
      return xmlCandidate
    }
  }

  // Strategy 2: Look for XML in deflated/compressed streams is much harder
  // and would require a full PDF parser.  For now, return null.
  return null
}

// ---------------------------------------------------------------------------
// CII (Cross Industry Invoice) Parser – ZUGFeRD / Factur-X
// ---------------------------------------------------------------------------

function parseCIIParty(block: string): ZUGFeRDParty {
  const name = xmlText(block, "ram:Name") || xmlText(block, "Name") || ""
  const street = xmlText(block, "ram:LineOne") || xmlText(block, "LineOne")
  const city = xmlText(block, "ram:CityName") || xmlText(block, "CityName")
  const postcode = xmlText(block, "ram:PostcodeCode") || xmlText(block, "PostcodeCode")
  const country = xmlText(block, "ram:CountryID") || xmlText(block, "CountryID")

  const parts = [street, [postcode, city].filter(Boolean).join(" "), country].filter(Boolean)
  const address = parts.length > 0 ? parts.join(", ") : null

  // Tax ID (Steuernummer) – ram:SpecifiedTaxRegistration with schemeID="FC"
  // VAT ID – schemeID="VA"
  const taxRegs = xmlBlocks(block, "SpecifiedTaxRegistration")
  let taxId: string | null = null
  let vatId: string | null = null
  for (const reg of taxRegs) {
    const id = xmlText(reg, "ram:ID") || xmlText(reg, "ID")
    if (reg.includes('"FC"') || reg.includes("'FC'")) {
      taxId = id
    } else if (reg.includes('"VA"') || reg.includes("'VA'")) {
      vatId = id
    } else if (!vatId && id) {
      // Fallback: if no schemeID, treat as VAT ID if it starts with country code
      if (/^[A-Z]{2}/.test(id)) {
        vatId = id
      } else {
        taxId = id
      }
    }
  }

  return { name, address, taxId, vatId }
}

export async function parseCIIXml(xml: string): Promise<ZUGFeRDInvoice> {
  // Invoice number
  const exchangedDoc = xmlBlocks(xml, "ExchangedDocument")[0] || xml
  const invoiceNumber = xmlText(exchangedDoc, "ram:ID") || xmlText(exchangedDoc, "ID") || ""

  // Invoice date
  const issueDateRaw = xmlText(xml, "udt:DateTimeString") || xmlText(xml, "DateTimeString")
  const invoiceDate = normalizeDate(issueDateRaw) || ""

  // Due date – inside SpecifiedTradePaymentTerms
  const paymentTermsBlock = xmlBlocks(xml, "SpecifiedTradePaymentTerms")[0] || ""
  const dueDateRaw = xmlText(paymentTermsBlock, "udt:DateTimeString") || xmlText(paymentTermsBlock, "DateTimeString")
  const dueDate = normalizeDate(dueDateRaw)
  const paymentTerms = xmlText(paymentTermsBlock, "ram:Description") || xmlText(paymentTermsBlock, "Description") || null

  // Seller
  const sellerBlock = xmlBlocks(xml, "SellerTradeParty")[0] || ""
  const seller = parseCIIParty(sellerBlock)

  // Buyer
  const buyerBlock = xmlBlocks(xml, "BuyerTradeParty")[0] || ""
  const buyer = parseCIIParty(buyerBlock)

  // Line items
  const lineItemBlocks = xmlBlocks(xml, "IncludedSupplyChainTradeLineItem")
  const lineItems: ZUGFeRDLineItem[] = lineItemBlocks.map((li) => {
    const description =
      xmlText(li, "ram:Name") || xmlText(li, "Name") ||
      xmlText(li, "ram:Description") || xmlText(li, "Description") || ""
    const quantity = toNumber(
      xmlText(li, "ram:BilledQuantity") || xmlText(li, "BilledQuantity"),
    )
    // Unit price – look inside NetPriceProductTradePrice
    const priceBlock = xmlBlocks(li, "NetPriceProductTradePrice")[0] || li
    const unitPrice = toNumber(
      xmlText(priceBlock, "ram:ChargeAmount") || xmlText(priceBlock, "ChargeAmount"),
    )
    // Line total
    const lineTotal = toNumber(
      xmlText(li, "ram:LineTotalAmount") || xmlText(li, "LineTotalAmount"),
    )
    // Tax rate
    const taxBlock = xmlBlocks(li, "ApplicableTradeTax")[0] ||
                     xmlBlocks(li, "CategoryTradeTax")[0] || ""
    const taxRate = toNumber(
      xmlText(taxBlock, "ram:RateApplicablePercent") || xmlText(taxBlock, "RateApplicablePercent"),
    )
    return { description, quantity, unitPrice, total: lineTotal, taxRate }
  })

  // Totals – SpecifiedTradeSettlementHeaderMonetarySummation
  const totalsBlock = xmlBlocks(xml, "SpecifiedTradeSettlementHeaderMonetarySummation")[0] || xml
  const netTotal = toCents(
    xmlText(totalsBlock, "ram:TaxBasisTotalAmount") || xmlText(totalsBlock, "TaxBasisTotalAmount"),
  )
  const taxTotal = toCents(
    xmlText(totalsBlock, "ram:TaxTotalAmount") || xmlText(totalsBlock, "TaxTotalAmount"),
  )
  const grossTotal = toCents(
    xmlText(totalsBlock, "ram:GrandTotalAmount") || xmlText(totalsBlock, "GrandTotalAmount"),
  )

  // Currency
  const currency =
    xmlText(xml, "ram:InvoiceCurrencyCode") || xmlText(xml, "InvoiceCurrencyCode") || "EUR"

  // Tax breakdown
  const tradeTaxBlocks = xmlBlocks(xml, "ApplicableTradeTax")
  // Filter to header-level tax blocks (those inside the settlement, not line items)
  const headerSettlement = xmlBlocks(xml, "ApplicableHeaderTradeSettlement")[0] || xml
  const headerTaxBlocks = xmlBlocks(headerSettlement, "ApplicableTradeTax")
  const taxBreakdown: ZUGFeRDTaxBreakdown[] = (headerTaxBlocks.length > 0 ? headerTaxBlocks : tradeTaxBlocks).map((tb) => {
    const rate = toNumber(
      xmlText(tb, "ram:RateApplicablePercent") || xmlText(tb, "RateApplicablePercent"),
    )
    const base = toCents(
      xmlText(tb, "ram:BasisAmount") || xmlText(tb, "BasisAmount"),
    )
    const amount = toCents(
      xmlText(tb, "ram:CalculatedAmount") || xmlText(tb, "CalculatedAmount"),
    )
    return { rate, base, amount }
  })

  // Payment – IBAN / BIC
  const paymentMeansBlocks = xmlBlocks(xml, "SpecifiedTradeSettlementPaymentMeans")
  let iban: string | null = null
  let bic: string | null = null
  for (const pm of paymentMeansBlocks) {
    iban = iban || xmlText(pm, "ram:IBANID") || xmlText(pm, "IBANID")
    bic = bic || xmlText(pm, "ram:BICID") || xmlText(pm, "BICID")
  }

  // Note
  const noteBlocks = xmlBlocks(exchangedDoc, "IncludedNote")
  const note = noteBlocks.length > 0
    ? (xmlText(noteBlocks[0], "ram:Content") || xmlText(noteBlocks[0], "Content") || null)
    : null

  return {
    invoiceNumber,
    invoiceDate,
    dueDate,
    seller,
    buyer,
    lineItems,
    netTotal,
    taxTotal,
    grossTotal,
    currency,
    taxBreakdown,
    paymentTerms,
    iban,
    bic,
    note,
  }
}

// ---------------------------------------------------------------------------
// UBL (Universal Business Language) Parser – XRechnung
// ---------------------------------------------------------------------------

function parseUBLParty(block: string): ZUGFeRDParty {
  const name =
    xmlText(block, "cbc:Name") || xmlText(block, "Name") ||
    xmlText(block, "cbc:RegistrationName") || xmlText(block, "RegistrationName") || ""
  const street = xmlText(block, "cbc:StreetName") || xmlText(block, "StreetName")
  const city = xmlText(block, "cbc:CityName") || xmlText(block, "CityName")
  const postcode = xmlText(block, "cbc:PostalZone") || xmlText(block, "PostalZone")
  const country = xmlText(block, "cbc:IdentificationCode") || xmlText(block, "IdentificationCode")

  const parts = [street, [postcode, city].filter(Boolean).join(" "), country].filter(Boolean)
  const address = parts.length > 0 ? parts.join(", ") : null

  const taxId = xmlText(block, "cbc:CompanyID") || xmlText(block, "CompanyID") || null
  // Try to separate VAT ID vs Tax ID
  let vatId: string | null = null
  let localTaxId: string | null = null
  if (taxId && /^[A-Z]{2}/.test(taxId)) {
    vatId = taxId
  } else {
    localTaxId = taxId
  }

  // If there are multiple CompanyID values, try to find both
  const taxSchemes = xmlBlocks(block, "PartyTaxScheme")
  for (const ts of taxSchemes) {
    const id = xmlText(ts, "cbc:CompanyID") || xmlText(ts, "CompanyID")
    if (!id) continue
    if (/^[A-Z]{2}/.test(id)) {
      vatId = vatId || id
    } else {
      localTaxId = localTaxId || id
    }
  }

  return { name, address, taxId: localTaxId, vatId }
}

export async function parseUBLXml(xml: string): Promise<ZUGFeRDInvoice> {
  // Invoice number
  const invoiceNumber = xmlText(xml, "cbc:ID") || xmlText(xml, "ID") || ""

  // Invoice date
  const invoiceDate = normalizeDate(xmlText(xml, "cbc:IssueDate") || xmlText(xml, "IssueDate")) || ""

  // Due date
  const dueDate = normalizeDate(xmlText(xml, "cbc:DueDate") || xmlText(xml, "DueDate"))

  // Currency
  const currency = xmlText(xml, "cbc:DocumentCurrencyCode") || xmlText(xml, "DocumentCurrencyCode") || "EUR"

  // Seller
  const supplierBlock = xmlBlocks(xml, "AccountingSupplierParty")[0] || ""
  const seller = parseUBLParty(supplierBlock)

  // Buyer
  const customerBlock = xmlBlocks(xml, "AccountingCustomerParty")[0] || ""
  const buyer = parseUBLParty(customerBlock)

  // Line items
  const invoiceLineBlocks = xmlBlocks(xml, "InvoiceLine")
  const lineItems: ZUGFeRDLineItem[] = invoiceLineBlocks.map((li) => {
    const description =
      xmlText(li, "cbc:Name") || xmlText(li, "Name") ||
      xmlText(li, "cbc:Description") || xmlText(li, "Description") || ""
    const quantity = toNumber(
      xmlText(li, "cbc:InvoicedQuantity") || xmlText(li, "InvoicedQuantity"),
    )
    const lineTotal = toNumber(
      xmlText(li, "cbc:LineExtensionAmount") || xmlText(li, "LineExtensionAmount"),
    )
    // Price
    const priceBlock = xmlBlocks(li, "Price")[0] || ""
    const unitPrice = toNumber(
      xmlText(priceBlock, "cbc:PriceAmount") || xmlText(priceBlock, "PriceAmount"),
    )
    // Tax
    const taxBlock = xmlBlocks(li, "TaxCategory")[0] || ""
    const taxRate = toNumber(
      xmlText(taxBlock, "cbc:Percent") || xmlText(taxBlock, "Percent"),
    )
    return { description, quantity, unitPrice, total: lineTotal, taxRate }
  })

  // Totals
  const legalTotal = xmlBlocks(xml, "LegalMonetaryTotal")[0] || xml
  const netTotal = toCents(
    xmlText(legalTotal, "cbc:TaxExclusiveAmount") || xmlText(legalTotal, "TaxExclusiveAmount"),
  )
  const grossTotal = toCents(
    xmlText(legalTotal, "cbc:TaxInclusiveAmount") || xmlText(legalTotal, "TaxInclusiveAmount") ||
    xmlText(legalTotal, "cbc:PayableAmount") || xmlText(legalTotal, "PayableAmount"),
  )
  const taxTotalBlock = xmlBlocks(xml, "TaxTotal")[0] || ""
  const taxTotal = toCents(
    xmlText(taxTotalBlock, "cbc:TaxAmount") || xmlText(taxTotalBlock, "TaxAmount"),
  )

  // Tax breakdown
  const taxSubtotals = xmlBlocks(xml, "TaxSubtotal")
  const taxBreakdown: ZUGFeRDTaxBreakdown[] = taxSubtotals.map((ts) => {
    const catBlock = xmlBlocks(ts, "TaxCategory")[0] || ""
    const rate = toNumber(
      xmlText(catBlock, "cbc:Percent") || xmlText(catBlock, "Percent"),
    )
    const base = toCents(
      xmlText(ts, "cbc:TaxableAmount") || xmlText(ts, "TaxableAmount"),
    )
    const amount = toCents(
      xmlText(ts, "cbc:TaxAmount") || xmlText(ts, "TaxAmount"),
    )
    return { rate, base, amount }
  })

  // Payment means – IBAN / BIC
  const paymentMeansBlocks = xmlBlocks(xml, "PaymentMeans")
  let iban: string | null = null
  let bic: string | null = null
  for (const pm of paymentMeansBlocks) {
    iban = iban || xmlText(pm, "cbc:ID")
    // More specific: PayeeFinancialAccount > ID
    const finAccount = xmlBlocks(pm, "PayeeFinancialAccount")[0] || ""
    iban = iban || xmlText(finAccount, "cbc:ID") || xmlText(finAccount, "ID")
    const branch = xmlBlocks(pm, "FinancialInstitutionBranch")[0] || ""
    bic = bic || xmlText(branch, "cbc:ID") || xmlText(branch, "ID")
  }
  // Validate IBAN-like pattern
  if (iban && !/^[A-Z]{2}\d{2}/.test(iban)) {
    iban = null
  }

  // Payment terms
  const paymentTermsBlock = xmlBlocks(xml, "PaymentTerms")[0] || ""
  const paymentTerms = xmlText(paymentTermsBlock, "cbc:Note") || xmlText(paymentTermsBlock, "Note") || null

  // Note
  const note = xmlText(xml, "cbc:Note") || xmlText(xml, "Note") || null

  return {
    invoiceNumber,
    invoiceDate,
    dueDate,
    seller,
    buyer,
    lineItems,
    netTotal,
    taxTotal,
    grossTotal,
    currency,
    taxBreakdown,
    paymentTerms,
    iban,
    bic,
    note,
  }
}

// ---------------------------------------------------------------------------
// Auto-detect and parse
// ---------------------------------------------------------------------------

/**
 * Detect the format (CII vs UBL) and parse accordingly.
 * Accepts either a raw XML string or a PDF buffer.
 */
export async function parseEInvoice(xmlOrPdf: Buffer | string): Promise<ZUGFeRDInvoice | null> {
  let xml: string | null = null

  if (Buffer.isBuffer(xmlOrPdf)) {
    // Could be a PDF with embedded XML or raw XML as Buffer
    const asString = xmlOrPdf.toString("utf-8")

    // Check if it's actually XML (not PDF)
    const trimmed = asString.trimStart()
    if (trimmed.startsWith("<?xml") || trimmed.startsWith("<Invoice") || trimmed.startsWith("<rsm:") || trimmed.startsWith("<CrossIndustry")) {
      xml = asString
    } else {
      // Assume PDF – try to extract embedded XML
      xml = await extractZUGFeRDFromPDF(xmlOrPdf)
    }
  } else {
    xml = xmlOrPdf
  }

  if (!xml) return null

  // Detect format
  if (xml.includes("CrossIndustryInvoice") || xml.includes("ram:ExchangedDocument") || xml.includes("urn:un:unece:uncefact")) {
    return parseCIIXml(xml)
  }

  if (xml.includes("<Invoice") || xml.includes("ubl:Invoice") || xml.includes("urn:oasis:names:specification:ubl")) {
    return parseUBLXml(xml)
  }

  // Unknown format
  return null
}
