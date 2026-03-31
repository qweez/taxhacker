import React from "react"
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import { InvoiceData, calculateInvoiceTotals } from "./invoice-generator"

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 50,
    color: "#1a1a1a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
  },
  sellerInfo: {
    maxWidth: "60%",
  },
  sellerName: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  sellerDetail: {
    fontSize: 9,
    color: "#555",
    lineHeight: 1.5,
  },
  invoiceMeta: {
    textAlign: "right",
  },
  invoiceTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  metaLabel: {
    fontSize: 9,
    color: "#555",
  },
  metaValue: {
    fontSize: 10,
    marginBottom: 4,
  },
  buyerBlock: {
    marginBottom: 30,
    padding: 12,
    backgroundColor: "#f8f8f8",
    borderRadius: 2,
  },
  buyerLabel: {
    fontSize: 8,
    color: "#888",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  buyerName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  buyerAddress: {
    fontSize: 10,
    lineHeight: 1.5,
  },
  table: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1.5,
    borderBottomColor: "#333",
    paddingBottom: 6,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  colPos: { width: "6%", textAlign: "center" },
  colDesc: { width: "38%", paddingRight: 8 },
  colQty: { width: "10%", textAlign: "right", paddingRight: 8 },
  colUnit: { width: "12%", textAlign: "center" },
  colPrice: { width: "17%", textAlign: "right", paddingRight: 8 },
  colTotal: { width: "17%", textAlign: "right" },
  headerText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    color: "#555",
    letterSpacing: 0.5,
  },
  cellText: {
    fontSize: 10,
  },
  totalsSection: {
    marginTop: 10,
    alignItems: "flex-end",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: 3,
    width: 250,
  },
  totalsLabel: {
    fontSize: 10,
    width: 150,
    textAlign: "right",
    paddingRight: 12,
  },
  totalsValue: {
    fontSize: 10,
    width: 100,
    textAlign: "right",
  },
  totalsBorder: {
    borderTopWidth: 1.5,
    borderTopColor: "#333",
    paddingTop: 4,
    marginTop: 2,
  },
  grossLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },
  grossValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },
  noteSection: {
    marginTop: 20,
    padding: 10,
    backgroundColor: "#f8f8f8",
    borderRadius: 2,
  },
  noteLabel: {
    fontSize: 8,
    color: "#888",
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  noteText: {
    fontSize: 9,
    lineHeight: 1.5,
  },
  legalNote: {
    marginTop: 15,
    fontSize: 9,
    color: "#555",
    fontFamily: "Helvetica-Oblique",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 50,
    right: 50,
    borderTopWidth: 0.5,
    borderTopColor: "#ccc",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerCol: {
    maxWidth: "33%",
  },
  footerLabel: {
    fontSize: 7,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  footerText: {
    fontSize: 8,
    color: "#555",
    lineHeight: 1.4,
  },
  paymentTerms: {
    marginTop: 20,
    fontSize: 9,
    color: "#333",
  },
})

function formatCents(cents: number): string {
  const euros = cents / 100
  return euros.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-")
  return `${day}.${month}.${year}`
}

export function InvoiceDocument({ data }: { data: InvoiceData }) {
  const totals = calculateInvoiceTotals(data.items)
  const isKleinunternehmer = data.kleinunternehmer === true

  // For Kleinunternehmer, gross equals net (no tax)
  const displayGross = isKleinunternehmer ? totals.netTotal : totals.grossTotal

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.sellerInfo}>
            <Text style={styles.sellerName}>{data.sellerName}</Text>
            {data.sellerAddress.split("\n").map((line, i) => (
              <Text key={i} style={styles.sellerDetail}>
                {line}
              </Text>
            ))}
            {data.sellerEmail && (
              <Text style={styles.sellerDetail}>{data.sellerEmail}</Text>
            )}
            {data.sellerPhone && (
              <Text style={styles.sellerDetail}>{data.sellerPhone}</Text>
            )}
          </View>
          <View style={styles.invoiceMeta}>
            <Text style={styles.invoiceTitle}>Rechnung</Text>
            <Text style={styles.metaLabel}>Rechnungsnummer</Text>
            <Text style={styles.metaValue}>{data.invoiceNumber}</Text>
            <Text style={styles.metaLabel}>Rechnungsdatum</Text>
            <Text style={styles.metaValue}>{formatDate(data.invoiceDate)}</Text>
            {data.serviceDate && (
              <>
                <Text style={styles.metaLabel}>Leistungsdatum</Text>
                <Text style={styles.metaValue}>
                  {formatDate(data.serviceDate)}
                </Text>
              </>
            )}
            {data.dueDate && (
              <>
                <Text style={styles.metaLabel}>Zahlungsziel</Text>
                <Text style={styles.metaValue}>{formatDate(data.dueDate)}</Text>
              </>
            )}
          </View>
        </View>

        {/* Buyer */}
        <View style={styles.buyerBlock}>
          <Text style={styles.buyerLabel}>Rechnungsempfänger</Text>
          <Text style={styles.buyerName}>{data.buyerName}</Text>
          {data.buyerAddress.split("\n").map((line, i) => (
            <Text key={i} style={styles.buyerAddress}>
              {line}
            </Text>
          ))}
          {data.buyerVatId && (
            <Text style={styles.buyerAddress}>
              USt-IdNr.: {data.buyerVatId}
            </Text>
          )}
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, styles.colPos]}>Pos.</Text>
            <Text style={[styles.headerText, styles.colDesc]}>
              Beschreibung
            </Text>
            <Text style={[styles.headerText, styles.colQty]}>Menge</Text>
            <Text style={[styles.headerText, styles.colUnit]}>Einheit</Text>
            <Text style={[styles.headerText, styles.colPrice]}>
              Einzelpreis
            </Text>
            <Text style={[styles.headerText, styles.colTotal]}>Gesamt</Text>
          </View>

          {/* Table Rows */}
          {data.items.map((item) => {
            const lineTotal = item.quantity * item.unitPrice
            return (
              <View key={item.position} style={styles.tableRow}>
                <Text style={[styles.cellText, styles.colPos]}>
                  {item.position}
                </Text>
                <Text style={[styles.cellText, styles.colDesc]}>
                  {item.description}
                </Text>
                <Text style={[styles.cellText, styles.colQty]}>
                  {item.quantity.toLocaleString("de-DE")}
                </Text>
                <Text style={[styles.cellText, styles.colUnit]}>
                  {item.unit}
                </Text>
                <Text style={[styles.cellText, styles.colPrice]}>
                  {formatCents(item.unitPrice)} EUR
                </Text>
                <Text style={[styles.cellText, styles.colTotal]}>
                  {formatCents(lineTotal)} EUR
                </Text>
              </View>
            )
          })}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Nettobetrag</Text>
            <Text style={styles.totalsValue}>
              {formatCents(totals.netTotal)} EUR
            </Text>
          </View>

          {!isKleinunternehmer &&
            totals.taxBreakdown.map((tax) => (
              <View key={tax.rate} style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>USt {tax.rate}%</Text>
                <Text style={styles.totalsValue}>
                  {formatCents(tax.tax)} EUR
                </Text>
              </View>
            ))}

          <View style={[styles.totalsRow, styles.totalsBorder]}>
            <Text style={[styles.totalsLabel, styles.grossLabel]}>
              Bruttobetrag
            </Text>
            <Text style={[styles.totalsValue, styles.grossValue]}>
              {formatCents(displayGross)} EUR
            </Text>
          </View>
        </View>

        {/* Legal notes */}
        {isKleinunternehmer && (
          <Text style={styles.legalNote}>
            Gemäß §19 UStG wird keine Umsatzsteuer berechnet.
          </Text>
        )}

        {data.reverseCharge && (
          <Text style={styles.legalNote}>
            Steuerschuldnerschaft des Leistungsempfängers (§13b UStG)
          </Text>
        )}

        {/* Note */}
        {data.note && (
          <View style={styles.noteSection}>
            <Text style={styles.noteLabel}>Hinweis</Text>
            <Text style={styles.noteText}>{data.note}</Text>
          </View>
        )}

        {/* Payment terms */}
        <Text style={styles.paymentTerms}>
          {data.dueDate
            ? `Zahlbar bis zum ${formatDate(data.dueDate)}.`
            : "Zahlbar innerhalb von 14 Tagen nach Rechnungsdatum."}
        </Text>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <View style={styles.footerCol}>
            <Text style={styles.footerLabel}>Kontakt</Text>
            <Text style={styles.footerText}>{data.sellerName}</Text>
            {data.sellerEmail && (
              <Text style={styles.footerText}>{data.sellerEmail}</Text>
            )}
            {data.sellerPhone && (
              <Text style={styles.footerText}>{data.sellerPhone}</Text>
            )}
          </View>
          <View style={styles.footerCol}>
            <Text style={styles.footerLabel}>Bankverbindung</Text>
            {data.sellerBankDetails ? (
              data.sellerBankDetails.split("\n").map((line, i) => (
                <Text key={i} style={styles.footerText}>
                  {line}
                </Text>
              ))
            ) : (
              <Text style={styles.footerText}>-</Text>
            )}
          </View>
          <View style={styles.footerCol}>
            <Text style={styles.footerLabel}>Steuerdaten</Text>
            {data.sellerTaxId && (
              <Text style={styles.footerText}>St.-Nr.: {data.sellerTaxId}</Text>
            )}
            {data.sellerVatId && (
              <Text style={styles.footerText}>
                USt-IdNr.: {data.sellerVatId}
              </Text>
            )}
          </View>
        </View>
      </Page>
    </Document>
  )
}
