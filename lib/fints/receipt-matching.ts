import { prisma } from "@/lib/db"

export type MatchCandidate = {
  transactionId: string
  fileId: string
  confidence: number // 0-1
  matchReasons: string[]
}

type ParseResult = {
  total?: number | null
  issuedAt?: string | null
  merchant?: string | null
  [key: string]: unknown
}

/**
 * Compute a simple similarity score between two strings (0-1).
 * Uses lowercase comparison and checks if one contains the other.
 */
function merchantSimilarity(a: string, b: string): number {
  const la = a.toLowerCase().trim()
  const lb = b.toLowerCase().trim()
  if (la === lb) return 1
  if (la.includes(lb) || lb.includes(la)) return 0.8
  // Check for word overlap
  const wordsA = new Set(la.split(/\s+/))
  const wordsB = new Set(lb.split(/\s+/))
  const intersection = [...wordsA].filter(w => wordsB.has(w))
  if (intersection.length === 0) return 0
  return intersection.length / Math.max(wordsA.size, wordsB.size)
}

/**
 * Compute a date proximity score (0-0.3).
 */
function dateProximityScore(dateA: Date, dateB: Date): { score: number; reason: string } {
  const diffMs = Math.abs(dateA.getTime() - dateB.getTime())
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  if (diffDays < 1) return { score: 0.3, reason: "Gleiches Datum" }
  if (diffDays <= 1) return { score: 0.2, reason: `Datum ±1 Tag` }
  if (diffDays <= 3) return { score: 0.1, reason: `Datum ±3 Tage` }
  return { score: 0, reason: "" }
}

/**
 * Find bank transactions that match a given receipt/invoice file.
 * The file must have a cachedParseResult with total and optionally issuedAt/merchant.
 */
export async function findMatchingTransactions(
  userId: string,
  fileId: string,
): Promise<MatchCandidate[]> {
  const file = await prisma.file.findFirst({
    where: { id: fileId, userId },
  })

  if (!file || !file.cachedParseResult) return []

  const parseResult = file.cachedParseResult as ParseResult
  if (parseResult.total == null) return []

  const receiptTotal = typeof parseResult.total === "number"
    ? parseResult.total
    : parseInt(String(parseResult.total), 10)

  if (isNaN(receiptTotal)) return []

  // Build date range for query: ±5 days from receipt date, or unbounded if no date
  const where: any = {
    userId,
    sourceType: "fints",
    total: receiptTotal,
  }

  let receiptDate: Date | null = null
  if (parseResult.issuedAt) {
    receiptDate = new Date(parseResult.issuedAt)
    if (!isNaN(receiptDate.getTime())) {
      const dateFrom = new Date(receiptDate)
      dateFrom.setDate(dateFrom.getDate() - 5)
      const dateTo = new Date(receiptDate)
      dateTo.setDate(dateTo.getDate() + 5)
      where.issuedAt = { gte: dateFrom, lte: dateTo }
    } else {
      receiptDate = null
    }
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { issuedAt: "desc" },
    take: 50,
  })

  const candidates: MatchCandidate[] = []

  for (const tx of transactions) {
    let confidence = 0
    const matchReasons: string[] = []

    // Exact amount match
    confidence += 0.5
    matchReasons.push(`Betrag: ${(receiptTotal / 100).toFixed(2)} EUR`)

    // Date proximity
    if (receiptDate && tx.issuedAt) {
      const { score, reason } = dateProximityScore(receiptDate, tx.issuedAt)
      if (score > 0) {
        confidence += score
        matchReasons.push(reason)
      }
    }

    // Merchant similarity
    if (parseResult.merchant && tx.merchant) {
      const sim = merchantSimilarity(parseResult.merchant, tx.merchant)
      if (sim > 0.3) {
        const merchantScore = 0.2 * sim
        confidence += merchantScore
        matchReasons.push(`Händler: "${parseResult.merchant}" ~ "${tx.merchant}"`)
      }
    }

    candidates.push({
      transactionId: tx.id,
      fileId,
      confidence: Math.min(confidence, 1),
      matchReasons,
    })
  }

  candidates.sort((a, b) => b.confidence - a.confidence)
  return candidates
}

/**
 * Find receipts/invoices (files with cached parse results) that match a given bank transaction.
 */
export async function findMatchingReceipts(
  userId: string,
  transactionId: string,
): Promise<MatchCandidate[]> {
  const bankTx = await prisma.transaction.findUnique({
    where: { id: transactionId, userId },
  })

  if (!bankTx || bankTx.total == null) return []

  // Find all files with cached parse results for this user
  const files = await prisma.file.findMany({
    where: {
      userId,
      cachedParseResult: { not: null as any },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  })

  const candidates: MatchCandidate[] = []

  for (const file of files) {
    const parseResult = file.cachedParseResult as ParseResult | null
    if (!parseResult || parseResult.total == null) continue

    const fileTotal = typeof parseResult.total === "number"
      ? parseResult.total
      : parseInt(String(parseResult.total), 10)

    if (isNaN(fileTotal)) continue

    // Must have exact amount match
    if (fileTotal !== bankTx.total) continue

    let confidence = 0
    const matchReasons: string[] = []

    // Exact amount match
    confidence += 0.5
    matchReasons.push(`Betrag: ${(bankTx.total / 100).toFixed(2)} EUR`)

    // Date proximity
    if (parseResult.issuedAt && bankTx.issuedAt) {
      const receiptDate = new Date(parseResult.issuedAt)
      if (!isNaN(receiptDate.getTime())) {
        const diffMs = Math.abs(receiptDate.getTime() - bankTx.issuedAt.getTime())
        const diffDays = diffMs / (1000 * 60 * 60 * 24)

        // Only include if within ±5 days
        if (diffDays <= 5) {
          const { score, reason } = dateProximityScore(receiptDate, bankTx.issuedAt)
          if (score > 0) {
            confidence += score
            matchReasons.push(reason)
          }
        } else {
          continue // Outside date window
        }
      }
    }

    // Merchant similarity
    if (parseResult.merchant && bankTx.merchant) {
      const sim = merchantSimilarity(parseResult.merchant, bankTx.merchant)
      if (sim > 0.3) {
        const merchantScore = 0.2 * sim
        confidence += merchantScore
        matchReasons.push(`Händler: "${parseResult.merchant}" ~ "${bankTx.merchant}"`)
      }
    }

    candidates.push({
      transactionId,
      fileId: file.id,
      confidence: Math.min(confidence, 1),
      matchReasons,
    })
  }

  candidates.sort((a, b) => b.confidence - a.confidence)
  return candidates
}

/**
 * Link a receipt file to a bank transaction by adding the file ID to the transaction's files array.
 */
export async function linkReceiptToTransaction(
  userId: string,
  transactionId: string,
  fileId: string,
): Promise<void> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId, userId },
  })

  if (!transaction) {
    throw new Error("Transaktion nicht gefunden")
  }

  // Verify the file belongs to this user
  const file = await prisma.file.findFirst({
    where: { id: fileId, userId },
  })

  if (!file) {
    throw new Error("Datei nicht gefunden")
  }

  const existingFiles = Array.isArray(transaction.files) ? (transaction.files as string[]) : []

  // Don't add duplicates
  if (existingFiles.includes(fileId)) return

  await prisma.transaction.update({
    where: { id: transactionId, userId },
    data: {
      files: [...existingFiles, fileId],
    },
  })
}
