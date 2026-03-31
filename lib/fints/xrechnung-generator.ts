/**
 * XRechnung (UBL 2.1) XML Generator
 *
 * Generates XRechnung-compliant UBL 2.1 Invoice XML following:
 * - EN 16931 (European e-invoicing standard)
 * - CIUS XRechnung 3.0 (German national standard)
 * - UBL 2.1 syntax
 */

export type XRechnungData = {
  invoiceNumber: string
  invoiceDate: string // YYYY-MM-DD
  dueDate?: string
  seller: {
    name: string
    street?: string
    city?: string
    postalCode?: string
    country?: string // ISO 3166-1 alpha-2, default "DE"
    taxId?: string // Steuernummer
    vatId?: string // USt-IdNr (DE...)
    email?: string
    phone?: string
  }
  buyer: {
    name: string
    street?: string
    city?: string
    postalCode?: string
    country?: string
    vatId?: string
    leitweg_id?: string // Leitweg-ID for public sector (required for B2G)
  }
  lineItems: {
    description: string
    quantity: number
    unit: string // UN/ECE Rec 20 codes: "H87"=Stueck, "HUR"=Stunden, "C62"=Pauschal
    unitPrice: number // in cents
    taxRate: number // 19, 7, 0
    taxCategory: string // "S"=Standard, "Z"=Zero, "E"=Exempt
  }[]
  currency?: string // default EUR
  paymentMeans?: {
    iban?: string
    bic?: string
    bankName?: string
  }
  note?: string
  buyerReference?: string // Leitweg-ID or buyer reference (BT-10, required)
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2)
}

function computeTaxCategory(taxRate: number, taxCategory: string): string {
  // Fallback logic if category not explicitly provided
  if (taxCategory) return taxCategory
  if (taxRate > 0) return "S"
  return "Z"
}

export function generateXRechnungXML(data: XRechnungData): string {
  const currency = data.currency ?? "EUR"
  const sellerCountry = data.seller.country ?? "DE"
  const buyerCountry = data.buyer.country ?? "DE"
  const buyerReference = data.buyerReference ?? data.buyer.leitweg_id ?? ""

  // Calculate line extension amounts and tax totals
  const taxMap = new Map<string, { rate: number; category: string; taxableAmount: number; taxAmount: number }>()
  let lineExtensionTotal = 0

  const lineItemsXml: string[] = []

  for (let i = 0; i < data.lineItems.length; i++) {
    const item = data.lineItems[i]
    const lineId = i + 1
    const lineExtension = item.quantity * item.unitPrice // in cents
    lineExtensionTotal += lineExtension
    const cat = computeTaxCategory(item.taxRate, item.taxCategory)

    const taxKey = `${item.taxRate}_${cat}`
    const existing = taxMap.get(taxKey)
    if (existing) {
      existing.taxableAmount += lineExtension
      existing.taxAmount += Math.round((lineExtension * item.taxRate) / 100)
    } else {
      taxMap.set(taxKey, {
        rate: item.taxRate,
        category: cat,
        taxableAmount: lineExtension,
        taxAmount: Math.round((lineExtension * item.taxRate) / 100),
      })
    }

    lineItemsXml.push(`    <cac:InvoiceLine>
        <cbc:ID>${lineId}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="${escapeXml(item.unit)}">${item.quantity}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="${currency}">${formatAmount(lineExtension)}</cbc:LineExtensionAmount>
        <cac:Item>
            <cbc:Name>${escapeXml(item.description)}</cbc:Name>
            <cac:ClassifiedTaxCategory>
                <cbc:ID>${cat}</cbc:ID>
                <cbc:Percent>${item.taxRate}</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="${currency}">${formatAmount(item.unitPrice)}</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>`)
  }

  // Calculate totals
  let totalTax = 0
  for (const entry of taxMap.values()) {
    totalTax += entry.taxAmount
  }

  const taxExclusiveAmount = lineExtensionTotal
  const taxInclusiveAmount = lineExtensionTotal + totalTax

  // Build TaxTotal/TaxSubtotal blocks
  const taxSubtotals: string[] = []
  for (const entry of taxMap.values()) {
    taxSubtotals.push(`            <cac:TaxSubtotal>
                <cbc:TaxableAmount currencyID="${currency}">${formatAmount(entry.taxableAmount)}</cbc:TaxableAmount>
                <cbc:TaxAmount currencyID="${currency}">${formatAmount(entry.taxAmount)}</cbc:TaxAmount>
                <cac:TaxCategory>
                    <cbc:ID>${entry.category}</cbc:ID>
                    <cbc:Percent>${entry.rate}</cbc:Percent>
                    <cac:TaxScheme>
                        <cbc:ID>VAT</cbc:ID>
                    </cac:TaxScheme>
                </cac:TaxCategory>
            </cac:TaxSubtotal>`)
  }

  // Payment means
  let paymentMeansXml = ""
  if (data.paymentMeans) {
    const pm = data.paymentMeans
    let financialAccount = ""
    if (pm.iban) {
      let branchXml = ""
      if (pm.bic) {
        branchXml = `
                <cac:FinancialInstitutionBranch>
                    <cbc:ID>${escapeXml(pm.bic)}</cbc:ID>
                </cac:FinancialInstitutionBranch>`
      }
      financialAccount = `
            <cac:PayeeFinancialAccount>
                <cbc:ID>${escapeXml(pm.iban)}</cbc:ID>${pm.bankName ? `
                <cbc:Name>${escapeXml(pm.bankName)}</cbc:Name>` : ""}${branchXml}
            </cac:PayeeFinancialAccount>`
    }
    paymentMeansXml = `
    <cac:PaymentMeans>
        <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>${financialAccount}
    </cac:PaymentMeans>`
  }

  // Due date
  const dueDateXml = data.dueDate
    ? `\n    <cbc:DueDate>${data.dueDate}</cbc:DueDate>`
    : ""

  // Note
  const noteXml = data.note
    ? `\n    <cbc:Note>${escapeXml(data.note)}</cbc:Note>`
    : ""

  // Seller tax schemes
  let sellerTaxSchemes = ""
  if (data.seller.vatId) {
    sellerTaxSchemes += `
                <cac:PartyTaxScheme>
                    <cbc:CompanyID>${escapeXml(data.seller.vatId)}</cbc:CompanyID>
                    <cac:TaxScheme>
                        <cbc:ID>VAT</cbc:ID>
                    </cac:TaxScheme>
                </cac:PartyTaxScheme>`
  }
  if (data.seller.taxId) {
    sellerTaxSchemes += `
                <cac:PartyTaxScheme>
                    <cbc:CompanyID>${escapeXml(data.seller.taxId)}</cbc:CompanyID>
                    <cac:TaxScheme>
                        <cbc:ID>FC</cbc:ID>
                    </cac:TaxScheme>
                </cac:PartyTaxScheme>`
  }

  // Seller contact
  let sellerContactXml = ""
  if (data.seller.email || data.seller.phone) {
    sellerContactXml = `
                <cac:Contact>${data.seller.phone ? `
                    <cbc:Telephone>${escapeXml(data.seller.phone)}</cbc:Telephone>` : ""}${data.seller.email ? `
                    <cbc:ElectronicMail>${escapeXml(data.seller.email)}</cbc:ElectronicMail>` : ""}
                </cac:Contact>`
  }

  // Buyer tax scheme
  let buyerTaxSchemeXml = ""
  if (data.buyer.vatId) {
    buyerTaxSchemeXml = `
                <cac:PartyTaxScheme>
                    <cbc:CompanyID>${escapeXml(data.buyer.vatId)}</cbc:CompanyID>
                    <cac:TaxScheme>
                        <cbc:ID>VAT</cbc:ID>
                    </cac:TaxScheme>
                </cac:PartyTaxScheme>`
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
    xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
    xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>
    <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
    <cbc:ID>${escapeXml(data.invoiceNumber)}</cbc:ID>
    <cbc:IssueDate>${data.invoiceDate}</cbc:IssueDate>${dueDateXml}
    <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${noteXml}
    <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
    <cbc:BuyerReference>${escapeXml(buyerReference)}</cbc:BuyerReference>
    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PostalAddress>
                ${data.seller.street ? `<cbc:StreetName>${escapeXml(data.seller.street)}</cbc:StreetName>` : ""}
                ${data.seller.city ? `<cbc:CityName>${escapeXml(data.seller.city)}</cbc:CityName>` : ""}
                ${data.seller.postalCode ? `<cbc:PostalZone>${escapeXml(data.seller.postalCode)}</cbc:PostalZone>` : ""}
                <cac:Country>
                    <cbc:IdentificationCode>${sellerCountry}</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>${sellerTaxSchemes}
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${escapeXml(data.seller.name)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>${sellerContactXml}
        </cac:Party>
    </cac:AccountingSupplierParty>
    <cac:AccountingCustomerParty>
        <cac:Party>
            <cac:PostalAddress>
                ${data.buyer.street ? `<cbc:StreetName>${escapeXml(data.buyer.street)}</cbc:StreetName>` : ""}
                ${data.buyer.city ? `<cbc:CityName>${escapeXml(data.buyer.city)}</cbc:CityName>` : ""}
                ${data.buyer.postalCode ? `<cbc:PostalZone>${escapeXml(data.buyer.postalCode)}</cbc:PostalZone>` : ""}
                <cac:Country>
                    <cbc:IdentificationCode>${buyerCountry}</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>${buyerTaxSchemeXml}
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${escapeXml(data.buyer.name)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>${paymentMeansXml}
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${currency}">${formatAmount(totalTax)}</cbc:TaxAmount>
${taxSubtotals.join("\n")}
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="${currency}">${formatAmount(lineExtensionTotal)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="${currency}">${formatAmount(taxExclusiveAmount)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="${currency}">${formatAmount(taxInclusiveAmount)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="${currency}">${formatAmount(taxInclusiveAmount)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
${lineItemsXml.join("\n")}
</Invoice>`

  return xml
}
