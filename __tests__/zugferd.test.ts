import { describe, it, expect } from "vitest"
import {
  parseCIIXml,
  parseUBLXml,
  parseEInvoice,
  extractZUGFeRDFromPDF,
} from "@/lib/fints/zugferd"

// ---------------------------------------------------------------------------
// Minimal CII (Cross Industry Invoice) XML fixture
// ---------------------------------------------------------------------------
const SAMPLE_CII_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>INV-2024-001</ram:ID>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">20240115</udt:DateTimeString>
    </ram:IssueDateTime>
    <ram:IncludedNote>
      <ram:Content>Test invoice note</ram:Content>
    </ram:IncludedNote>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>1</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>Widget A</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="C62">2</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>200.00</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>100.00</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>2</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>Widget B</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="C62">1</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:RateApplicablePercent>7</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>50.00</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>50.00</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Acme GmbH</ram:Name>
        <ram:PostalTradeAddress>
          <ram:LineOne>Musterstr. 1</ram:LineOne>
          <ram:PostcodeCode>10115</ram:PostcodeCode>
          <ram:CityName>Berlin</ram:CityName>
          <ram:CountryID>DE</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">DE123456789</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>Buyer Corp</ram:Name>
        <ram:PostalTradeAddress>
          <ram:LineOne>Kaiserstr. 5</ram:LineOne>
          <ram:PostcodeCode>80331</ram:PostcodeCode>
          <ram:CityName>Munich</ram:CityName>
          <ram:CountryID>DE</ram:CountryID>
        </ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:PayerPartyDebtorFinancialAccount>
          <ram:IBANID>DE89370400440532013000</ram:IBANID>
        </ram:PayerPartyDebtorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>38.00</ram:CalculatedAmount>
        <ram:BasisAmount>200.00</ram:BasisAmount>
        <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>3.50</ram:CalculatedAmount>
        <ram:BasisAmount>50.00</ram:BasisAmount>
        <ram:RateApplicablePercent>7</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>Net 30 days</ram:Description>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">20240214</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>250.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">41.50</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>291.50</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`

// ---------------------------------------------------------------------------
// Minimal UBL XML fixture
// ---------------------------------------------------------------------------
const SAMPLE_UBL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>UBL-2024-099</cbc:ID>
  <cbc:IssueDate>2024-03-20</cbc:IssueDate>
  <cbc:DueDate>2024-04-19</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:Note>UBL test note</cbc:Note>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Supplier Inc</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Hauptstr. 10</cbc:StreetName>
        <cbc:PostalZone>50667</cbc:PostalZone>
        <cbc:CityName>Cologne</cbc:CityName>
        <cac:Country>
          <cbc:IdentificationCode>DE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>DE987654321</cbc:CompanyID>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Customer Ltd</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cac:PayeeFinancialAccount>
      <cbc:ID>DE44500105175407324931</cbc:ID>
    </cac:PayeeFinancialAccount>
    <cac:FinancialInstitutionBranch>
      <cbc:ID>COBADEFFXXX</cbc:ID>
    </cac:FinancialInstitutionBranch>
  </cac:PaymentMeans>
  <cac:PaymentTerms>
    <cbc:Note>Pay within 14 days</cbc:Note>
  </cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19</cbc:Percent>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">119.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">5</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Service X</cbc:Name>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="EUR">20.00</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>`

// ---------------------------------------------------------------------------
// CII Parser
// ---------------------------------------------------------------------------
describe("parseCIIXml", () => {
  it("extracts invoice number", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.invoiceNumber).toBe("INV-2024-001")
  })

  it("extracts and normalises invoice date", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.invoiceDate).toBe("2024-01-15")
  })

  it("extracts due date", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.dueDate).toBe("2024-02-14")
  })

  it("extracts seller name and address", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.seller.name).toBe("Acme GmbH")
    expect(inv.seller.address).toContain("Musterstr. 1")
    expect(inv.seller.address).toContain("Berlin")
    expect(inv.seller.vatId).toBe("DE123456789")
  })

  it("extracts buyer name", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.buyer.name).toBe("Buyer Corp")
  })

  it("parses line items", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.lineItems).toHaveLength(2)

    const first = inv.lineItems[0]
    expect(first.description).toBe("Widget A")
    expect(first.quantity).toBe(2)
    expect(first.unitPrice).toBe(100)
    expect(first.total).toBe(200)
    expect(first.taxRate).toBe(19)

    const second = inv.lineItems[1]
    expect(second.description).toBe("Widget B")
    expect(second.quantity).toBe(1)
    expect(second.unitPrice).toBe(50)
    expect(second.total).toBe(50)
    expect(second.taxRate).toBe(7)
  })

  it("converts totals to cents", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.netTotal).toBe(25000)   // 250.00 EUR
    expect(inv.taxTotal).toBe(4150)    // 41.50 EUR
    expect(inv.grossTotal).toBe(29150) // 291.50 EUR
  })

  it("extracts currency", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.currency).toBe("EUR")
  })

  it("calculates tax breakdown", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.taxBreakdown).toHaveLength(2)

    const vat19 = inv.taxBreakdown.find((t) => t.rate === 19)
    expect(vat19).toBeDefined()
    expect(vat19!.base).toBe(20000)   // 200.00
    expect(vat19!.amount).toBe(3800)  // 38.00

    const vat7 = inv.taxBreakdown.find((t) => t.rate === 7)
    expect(vat7).toBeDefined()
    expect(vat7!.base).toBe(5000)     // 50.00
    expect(vat7!.amount).toBe(350)    // 3.50
  })

  it("extracts IBAN", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.iban).toBe("DE89370400440532013000")
  })

  it("extracts payment terms", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.paymentTerms).toBe("Net 30 days")
  })

  it("extracts note", async () => {
    const inv = await parseCIIXml(SAMPLE_CII_XML)
    expect(inv.note).toBe("Test invoice note")
  })
})

// ---------------------------------------------------------------------------
// UBL Parser
// ---------------------------------------------------------------------------
describe("parseUBLXml", () => {
  it("extracts invoice number", async () => {
    const inv = await parseUBLXml(SAMPLE_UBL_XML)
    expect(inv.invoiceNumber).toBe("UBL-2024-099")
  })

  it("extracts dates in YYYY-MM-DD format", async () => {
    const inv = await parseUBLXml(SAMPLE_UBL_XML)
    expect(inv.invoiceDate).toBe("2024-03-20")
    expect(inv.dueDate).toBe("2024-04-19")
  })

  it("extracts seller / buyer names", async () => {
    const inv = await parseUBLXml(SAMPLE_UBL_XML)
    expect(inv.seller.name).toBe("Supplier Inc")
    expect(inv.buyer.name).toBe("Customer Ltd")
  })

  it("extracts seller VAT ID", async () => {
    const inv = await parseUBLXml(SAMPLE_UBL_XML)
    expect(inv.seller.vatId).toBe("DE987654321")
  })

  it("parses line items", async () => {
    const inv = await parseUBLXml(SAMPLE_UBL_XML)
    expect(inv.lineItems).toHaveLength(1)
    const li = inv.lineItems[0]
    expect(li.description).toBe("Service X")
    expect(li.quantity).toBe(5)
    expect(li.unitPrice).toBe(20)
    expect(li.total).toBe(100)
  })

  it("converts totals to cents", async () => {
    const inv = await parseUBLXml(SAMPLE_UBL_XML)
    expect(inv.netTotal).toBe(10000)
    expect(inv.taxTotal).toBe(1900)
    expect(inv.grossTotal).toBe(11900)
  })

  it("extracts tax breakdown", async () => {
    const inv = await parseUBLXml(SAMPLE_UBL_XML)
    expect(inv.taxBreakdown).toHaveLength(1)
    expect(inv.taxBreakdown[0].rate).toBe(19)
    expect(inv.taxBreakdown[0].base).toBe(10000)
    expect(inv.taxBreakdown[0].amount).toBe(1900)
  })

  it("extracts IBAN and BIC", async () => {
    const inv = await parseUBLXml(SAMPLE_UBL_XML)
    expect(inv.iban).toBe("DE44500105175407324931")
    expect(inv.bic).toBe("COBADEFFXXX")
  })

  it("extracts payment terms and note", async () => {
    const inv = await parseUBLXml(SAMPLE_UBL_XML)
    expect(inv.paymentTerms).toBe("Pay within 14 days")
  })

  it("extracts currency", async () => {
    const inv = await parseUBLXml(SAMPLE_UBL_XML)
    expect(inv.currency).toBe("EUR")
  })
})

// ---------------------------------------------------------------------------
// parseEInvoice auto-detection
// ---------------------------------------------------------------------------
describe("parseEInvoice", () => {
  it("auto-detects CII format from XML string", async () => {
    const inv = await parseEInvoice(SAMPLE_CII_XML)
    expect(inv).not.toBeNull()
    expect(inv!.invoiceNumber).toBe("INV-2024-001")
  })

  it("auto-detects UBL format from XML string", async () => {
    const inv = await parseEInvoice(SAMPLE_UBL_XML)
    expect(inv).not.toBeNull()
    expect(inv!.invoiceNumber).toBe("UBL-2024-099")
  })

  it("auto-detects CII format from Buffer", async () => {
    const buf = Buffer.from(SAMPLE_CII_XML, "utf-8")
    const inv = await parseEInvoice(buf)
    expect(inv).not.toBeNull()
    expect(inv!.invoiceNumber).toBe("INV-2024-001")
  })

  it("returns null for invalid / unrecognised XML", async () => {
    const inv = await parseEInvoice("<html><body>not an invoice</body></html>")
    expect(inv).toBeNull()
  })

  it("returns null for empty string", async () => {
    const inv = await parseEInvoice("")
    expect(inv).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// extractZUGFeRDFromPDF
// ---------------------------------------------------------------------------
describe("extractZUGFeRDFromPDF", () => {
  it("returns null for a buffer with no embedded XML", async () => {
    const emptyPdf = Buffer.from("%PDF-1.4 some random content", "utf-8")
    const result = await extractZUGFeRDFromPDF(emptyPdf)
    expect(result).toBeNull()
  })

  it("returns null for completely empty buffer", async () => {
    const result = await extractZUGFeRDFromPDF(Buffer.alloc(0))
    expect(result).toBeNull()
  })

  it("extracts embedded CII XML from a fake PDF buffer", async () => {
    // Simulate a PDF that has CII XML embedded in its stream
    const fakeContent =
      "%PDF-1.4\nsome pdf objects\n" +
      SAMPLE_CII_XML +
      "\nendstream\nendobj\n%%EOF"
    const buf = Buffer.from(fakeContent, "utf-8")
    const xml = await extractZUGFeRDFromPDF(buf)
    expect(xml).not.toBeNull()
    expect(xml).toContain("CrossIndustryInvoice")
    expect(xml).toContain("INV-2024-001")
  })
})
