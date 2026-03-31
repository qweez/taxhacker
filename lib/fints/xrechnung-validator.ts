/**
 * XRechnung / UBL 2.1 Invoice Validator
 *
 * Performs basic structural and business-rule validation for XRechnung-compliant
 * UBL 2.1 invoices. This is not a full Schematron/KoSIT validation, but catches
 * the most common issues.
 */

export type ValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/** Extract text content of the first occurrence of a tag (with optional namespace prefix) */
function xmlText(xml: string, tagName: string): string | null {
  const localName = tagName.includes(":") ? tagName : `(?:[a-zA-Z0-9_-]+:)?${tagName}`
  const re = new RegExp(`<${localName}[^>]*>([^<]*)<\\/`, "s")
  const m = xml.match(re)
  return m ? m[1].trim() : null
}

/** Return all occurrences of a block enclosed by the given tag */
function xmlBlocks(xml: string, tagName: string): string[] {
  const localName = tagName.includes(":") ? tagName.split(":")[1] : tagName
  const re = new RegExp(`<([a-zA-Z0-9_-]+:)?${localName}[^>]*>[\\s\\S]*?<\\/\\1?${localName}>`, "g")
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    results.push(m[0])
  }
  return results
}

function parseAmount(value: string | null): number | null {
  if (!value) return null
  const num = parseFloat(value.trim().replace(",", "."))
  return isNaN(num) ? null : Math.round(num * 100) // convert to cents
}

function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const d = new Date(dateStr + "T00:00:00Z")
  if (isNaN(d.getTime())) return false
  // Verify the date components match (catches invalid like 2024-02-30)
  const [y, m, day] = dateStr.split("-").map(Number)
  return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day
}

const VALID_TAX_CATEGORIES = new Set(["S", "Z", "E", "AE", "K", "G", "O", "L", "M"])
const VALID_TAX_RATES = new Set([0, 5, 7, 16, 19])

export function validateXRechnung(xml: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Basic XML check
  if (!xml || typeof xml !== "string") {
    return { valid: false, errors: ["Kein XML-Inhalt vorhanden."], warnings: [] }
  }

  const trimmed = xml.trim()
  if (!trimmed.startsWith("<?xml") && !trimmed.startsWith("<Invoice")) {
    errors.push("Dokument beginnt nicht mit einer XML-Deklaration oder einem Invoice-Element.")
  }

  if (!trimmed.includes("<Invoice") && !trimmed.includes("<ubl:Invoice")) {
    errors.push("Kein UBL Invoice-Root-Element gefunden.")
    return { valid: false, errors, warnings }
  }

  // --- Required elements ---

  // CustomizationID
  const customizationId = xmlText(xml, "CustomizationID")
  if (!customizationId) {
    errors.push("CustomizationID (BT-24) fehlt.")
  } else if (!customizationId.includes("urn:cen.eu:en16931")) {
    warnings.push("CustomizationID entspricht moeglicherweise nicht dem EN 16931 Profil.")
  }

  // Invoice ID (BT-1)
  const invoiceId = xmlText(xml, "ID")
  if (!invoiceId) {
    errors.push("Rechnungsnummer (BT-1, cbc:ID) fehlt.")
  }

  // IssueDate (BT-2)
  const issueDate = xmlText(xml, "IssueDate")
  if (!issueDate) {
    errors.push("Rechnungsdatum (BT-2, cbc:IssueDate) fehlt.")
  } else if (!isValidDate(issueDate)) {
    errors.push(`Rechnungsdatum '${issueDate}' ist kein gueltiges Datum (YYYY-MM-DD erwartet).`)
  }

  // DueDate (BT-9) - optional but validate format if present
  const dueDate = xmlText(xml, "DueDate")
  if (dueDate && !isValidDate(dueDate)) {
    errors.push(`Faelligkeitsdatum '${dueDate}' ist kein gueltiges Datum (YYYY-MM-DD erwartet).`)
  }

  // InvoiceTypeCode (BT-3)
  const typeCode = xmlText(xml, "InvoiceTypeCode")
  if (!typeCode) {
    errors.push("InvoiceTypeCode (BT-3) fehlt.")
  } else if (typeCode !== "380" && typeCode !== "381" && typeCode !== "384" && typeCode !== "389") {
    warnings.push(`InvoiceTypeCode '${typeCode}' ist unueblich. Ueblich sind 380 (Rechnung), 381 (Gutschrift), 384 (Korrektur), 389 (Selbstfakturierung).`)
  }

  // DocumentCurrencyCode (BT-5)
  const currencyCode = xmlText(xml, "DocumentCurrencyCode")
  if (!currencyCode) {
    errors.push("DocumentCurrencyCode (BT-5) fehlt.")
  } else if (!/^[A-Z]{3}$/.test(currencyCode)) {
    errors.push(`DocumentCurrencyCode '${currencyCode}' ist kein gueltiger ISO 4217 Waehrungscode.`)
  }

  // BuyerReference (BT-10) - required for XRechnung
  const buyerReference = xmlText(xml, "BuyerReference")
  if (!buyerReference) {
    errors.push("BuyerReference (BT-10) fehlt. Pflichtfeld fuer XRechnung (z.B. Leitweg-ID).")
  }

  // --- Parties ---

  // AccountingSupplierParty (BG-4)
  const supplierBlock = xmlBlocks(xml, "AccountingSupplierParty")[0]
  if (!supplierBlock) {
    errors.push("AccountingSupplierParty (BG-4, Verkaeufer) fehlt.")
  } else {
    const regName = xmlText(supplierBlock, "RegistrationName")
    if (!regName) {
      errors.push("Verkaeufername (BT-27, RegistrationName) fehlt.")
    }
    const supplierCountry = xmlText(supplierBlock, "IdentificationCode")
    if (!supplierCountry) {
      warnings.push("Verkaeufer-Land (BT-40) fehlt in PostalAddress.")
    }
    // PartyLegalEntity
    const legalEntity = xmlBlocks(supplierBlock, "PartyLegalEntity")
    if (legalEntity.length === 0) {
      errors.push("PartyLegalEntity des Verkaeufers fehlt.")
    }
  }

  // AccountingCustomerParty (BG-7)
  const customerBlock = xmlBlocks(xml, "AccountingCustomerParty")[0]
  if (!customerBlock) {
    errors.push("AccountingCustomerParty (BG-7, Kaeufer) fehlt.")
  } else {
    const regName = xmlText(customerBlock, "RegistrationName")
    if (!regName) {
      errors.push("Kaeufername (BT-44, RegistrationName) fehlt.")
    }
  }

  // --- Tax validation ---

  const taxTotal = xmlBlocks(xml, "TaxTotal")[0]
  if (!taxTotal) {
    errors.push("TaxTotal (BG-22) fehlt.")
  } else {
    const totalTaxAmount = parseAmount(xmlText(taxTotal, "TaxAmount"))
    if (totalTaxAmount === null) {
      errors.push("TaxAmount im TaxTotal fehlt oder ist ungueltig.")
    }

    const taxSubtotals = xmlBlocks(taxTotal, "TaxSubtotal")
    if (taxSubtotals.length === 0) {
      errors.push("Mindestens ein TaxSubtotal (BG-23) ist erforderlich.")
    }

    // Sum check: sum of TaxSubtotal TaxAmounts should equal TaxTotal TaxAmount
    let subtotalTaxSum = 0
    for (const ts of taxSubtotals) {
      const subTaxAmount = parseAmount(xmlText(ts, "TaxAmount"))
      if (subTaxAmount !== null) {
        subtotalTaxSum += subTaxAmount
      }

      // Validate tax category
      const catBlock = xmlBlocks(ts, "TaxCategory")[0]
      if (catBlock) {
        const catId = xmlText(catBlock, "ID")
        if (catId && !VALID_TAX_CATEGORIES.has(catId)) {
          warnings.push(`Steuerkategorie '${catId}' ist nicht in der ueblichen Liste (S, Z, E, AE, K, G, O, L, M).`)
        }
        const percentStr = xmlText(catBlock, "Percent")
        if (percentStr) {
          const percent = parseFloat(percentStr)
          if (!isNaN(percent) && !VALID_TAX_RATES.has(percent)) {
            warnings.push(`Steuersatz ${percent}% ist in Deutschland unueblich.`)
          }
        }
      }
    }

    if (totalTaxAmount !== null && Math.abs(subtotalTaxSum - totalTaxAmount) > 1) {
      errors.push(
        `Summe der TaxSubtotal-TaxAmounts (${(subtotalTaxSum / 100).toFixed(2)}) ` +
        `weicht vom TaxTotal-TaxAmount (${(totalTaxAmount / 100).toFixed(2)}) ab.`
      )
    }
  }

  // --- Monetary totals ---

  const legalMonetary = xmlBlocks(xml, "LegalMonetaryTotal")[0]
  if (!legalMonetary) {
    errors.push("LegalMonetaryTotal (BG-22) fehlt.")
  } else {
    const lineExtension = parseAmount(xmlText(legalMonetary, "LineExtensionAmount"))
    const taxExclusive = parseAmount(xmlText(legalMonetary, "TaxExclusiveAmount"))
    const taxInclusive = parseAmount(xmlText(legalMonetary, "TaxInclusiveAmount"))
    const payable = parseAmount(xmlText(legalMonetary, "PayableAmount"))

    if (lineExtension === null) errors.push("LineExtensionAmount (BT-106) fehlt.")
    if (taxExclusive === null) errors.push("TaxExclusiveAmount (BT-109) fehlt.")
    if (taxInclusive === null) errors.push("TaxInclusiveAmount (BT-112) fehlt.")
    if (payable === null) errors.push("PayableAmount (BT-115) fehlt.")

    // Cross-check: TaxInclusiveAmount = TaxExclusiveAmount + TaxTotal.TaxAmount
    if (taxExclusive !== null && taxInclusive !== null && taxTotal) {
      const totalTaxAmount = parseAmount(xmlText(taxTotal, "TaxAmount"))
      if (totalTaxAmount !== null) {
        const expected = taxExclusive + totalTaxAmount
        if (Math.abs(taxInclusive - expected) > 1) {
          errors.push(
            `TaxInclusiveAmount (${(taxInclusive / 100).toFixed(2)}) sollte gleich ` +
            `TaxExclusiveAmount (${(taxExclusive / 100).toFixed(2)}) + TaxAmount (${(totalTaxAmount / 100).toFixed(2)}) = ${(expected / 100).toFixed(2)} sein.`
          )
        }
      }
    }

    // Cross-check: LineExtensionAmount should equal sum of InvoiceLine LineExtensionAmounts
    if (lineExtension !== null) {
      const invoiceLines = xmlBlocks(xml, "InvoiceLine")
      let lineSum = 0
      for (const line of invoiceLines) {
        const lineAmount = parseAmount(xmlText(line, "LineExtensionAmount"))
        if (lineAmount !== null) {
          lineSum += lineAmount
        }
      }
      if (invoiceLines.length > 0 && Math.abs(lineSum - lineExtension) > 1) {
        errors.push(
          `Summe der InvoiceLine-LineExtensionAmounts (${(lineSum / 100).toFixed(2)}) ` +
          `weicht von LineExtensionAmount (${(lineExtension / 100).toFixed(2)}) ab.`
        )
      }
    }
  }

  // --- Invoice lines ---

  const invoiceLines = xmlBlocks(xml, "InvoiceLine")
  if (invoiceLines.length === 0) {
    errors.push("Mindestens eine InvoiceLine (BG-25) ist erforderlich.")
  } else {
    for (let i = 0; i < invoiceLines.length; i++) {
      const line = invoiceLines[i]
      const lineId = xmlText(line, "ID")
      const lineLabel = lineId ? `Zeile ${lineId}` : `Zeile ${i + 1}`

      const qty = xmlText(line, "InvoicedQuantity")
      if (!qty) {
        errors.push(`${lineLabel}: InvoicedQuantity (BT-129) fehlt.`)
      }

      const lineExt = xmlText(line, "LineExtensionAmount")
      if (!lineExt) {
        errors.push(`${lineLabel}: LineExtensionAmount (BT-131) fehlt.`)
      }

      const itemName = xmlText(line, "Name")
      if (!itemName) {
        errors.push(`${lineLabel}: Artikelname (BT-153, cbc:Name) fehlt.`)
      }

      // Price
      const priceBlock = xmlBlocks(line, "Price")[0]
      if (!priceBlock) {
        warnings.push(`${lineLabel}: Price-Block fehlt.`)
      } else {
        const priceAmount = xmlText(priceBlock, "PriceAmount")
        if (!priceAmount) {
          errors.push(`${lineLabel}: PriceAmount (BT-146) fehlt.`)
        }
      }
    }
  }

  // --- Payment means ---
  const paymentMeans = xmlBlocks(xml, "PaymentMeans")
  if (paymentMeans.length === 0) {
    warnings.push("PaymentMeans (BG-16) fehlt. Empfohlen fuer XRechnung.")
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
