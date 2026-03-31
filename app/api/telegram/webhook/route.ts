import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { mkdir, writeFile } from "fs/promises"
import path from "path"

import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { FILE_UPLOAD_PATH, safePathJoin, unsortedFilePath } from "@/lib/files"
import {
  downloadTelegramFile,
  sendTelegramReply,
  formatTransactionMessage,
} from "@/lib/telegram-bot"
import { analyzeTransaction } from "@/ai/analyze"
import { buildLLMPrompt } from "@/ai/prompt"
import { fieldsToJsonSchema } from "@/ai/schema"
import { loadFileAsBase64 } from "@/ai/attachments"
import { generateFilePreviews } from "@/lib/previews/generate"
import { DEFAULT_PROMPT_ANALYSE_NEW_FILE } from "@/models/defaults"
import { createFile } from "@/models/files"
import { createTransaction, TransactionData } from "@/models/transactions"
import { getFields } from "@/models/fields"
import { getCategories } from "@/models/categories"
import { getProjects } from "@/models/projects"
import { getSettings } from "@/models/settings"
import { getSelfHostedUser } from "@/models/users"

const ALLOWED_DOCUMENT_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]

export async function POST(request: NextRequest) {
  // Verify webhook secret via Telegram's X-Telegram-Bot-Api-Secret-Token header
  if (config.telegram.webhookSecret) {
    const secretHeader = request.headers.get("x-telegram-bot-api-secret-token")
    if (secretHeader !== config.telegram.webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  let update: any
  try {
    update = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const message = update?.message
  if (!message) {
    return NextResponse.json({ ok: true })
  }

  const chatId = String(message.chat.id)
  const messageId = message.message_id

  // Only allow the configured chat ID
  if (config.telegram.chatId && chatId !== config.telegram.chatId) {
    await sendTelegramReply(chatId, "Nicht autorisiert. Dieser Bot ist nur fuer einen bestimmten Benutzer konfiguriert.", messageId)
    return NextResponse.json({ ok: true })
  }

  try {
    // Handle text messages / commands
    if (message.text && !message.photo && !message.document) {
      await handleTextMessage(chatId, messageId, message.text)
      return NextResponse.json({ ok: true })
    }

    // Handle photo uploads
    if (message.photo && message.photo.length > 0) {
      const largestPhoto = message.photo[message.photo.length - 1]
      await handleFileUpload(chatId, messageId, largestPhoto.file_id, "photo.jpg", "image/jpeg")
      return NextResponse.json({ ok: true })
    }

    // Handle document uploads
    if (message.document) {
      const doc = message.document
      const mimeType = doc.mime_type || "application/octet-stream"

      if (!ALLOWED_DOCUMENT_MIMES.includes(mimeType)) {
        await sendTelegramReply(
          chatId,
          "Dieses Dateiformat wird nicht unterstuetzt. Bitte sende ein Foto, ein Bild oder ein PDF.",
          messageId
        )
        return NextResponse.json({ ok: true })
      }

      await handleFileUpload(chatId, messageId, doc.file_id, doc.file_name || "document", mimeType)
      return NextResponse.json({ ok: true })
    }

    // Unknown message type
    await sendTelegramReply(
      chatId,
      "Bitte sende ein Foto oder PDF einer Rechnung, um sie zu verarbeiten.",
      messageId
    )
  } catch (error: any) {
    console.error("[Telegram Webhook] Fehler:", error)
    await sendTelegramReply(
      chatId,
      `Fehler bei der Verarbeitung: ${error.message || "Unbekannter Fehler"}`,
      messageId
    )
  }

  return NextResponse.json({ ok: true })
}

async function handleTextMessage(chatId: string, messageId: number, text: string) {
  const command = text.trim().toLowerCase()

  if (command === "/start") {
    await sendTelegramReply(
      chatId,
      "<b>Willkommen bei TaxHacker Bot!</b>\n\n" +
        "Sende mir ein Foto oder PDF einer Rechnung und ich werde sie automatisch analysieren und als Transaktion speichern.\n\n" +
        "<b>Befehle:</b>\n" +
        "/start - Diese Willkommensnachricht\n" +
        "/status - Letzter Sync-Status und Transaktionsanzahl\n" +
        "/balance - Einnahmen/Ausgaben des aktuellen Monats",
      messageId
    )
    return
  }

  if (command === "/status") {
    await handleStatusCommand(chatId, messageId)
    return
  }

  if (command === "/balance") {
    await handleBalanceCommand(chatId, messageId)
    return
  }

  // Default help message
  await sendTelegramReply(
    chatId,
    "Sende mir ein <b>Foto</b> oder <b>PDF</b> einer Rechnung, um sie zu verarbeiten.\n\n" +
      "<b>Befehle:</b>\n" +
      "/start - Willkommensnachricht\n" +
      "/status - Sync-Status\n" +
      "/balance - Monatsueberblick",
    messageId
  )
}

async function handleStatusCommand(chatId: string, messageId: number) {
  const user = await getAuthorizedUser()
  if (!user) {
    await sendTelegramReply(chatId, "Kein Benutzer konfiguriert.", messageId)
    return
  }

  const [txCount, lastSync, unsortedCount] = await Promise.all([
    prisma.transaction.count({ where: { userId: user.id } }),
    prisma.finTSBankAccount.findFirst({
      where: { userId: user.id, isActive: true },
      orderBy: { lastSyncAt: "desc" },
      select: { lastSyncAt: true, lastSyncStatus: true, bankName: true },
    }),
    prisma.file.count({ where: { userId: user.id, isReviewed: false } }),
  ])

  const lines = ["<b>Status</b>"]
  lines.push(`Transaktionen gesamt: ${txCount}`)
  lines.push(`Unsortierte Dateien: ${unsortedCount}`)

  if (lastSync) {
    lines.push(`\nLetzte Bank-Sync: ${lastSync.lastSyncAt ? new Date(lastSync.lastSyncAt).toLocaleString("de-DE") : "Nie"}`)
    if (lastSync.bankName) lines.push(`Bank: ${lastSync.bankName}`)
    if (lastSync.lastSyncStatus) lines.push(`Status: ${lastSync.lastSyncStatus}`)
  } else {
    lines.push("\nKeine Bank-Synchronisierung konfiguriert.")
  }

  await sendTelegramReply(chatId, lines.join("\n"), messageId)
}

async function handleBalanceCommand(chatId: string, messageId: number) {
  const user = await getAuthorizedUser()
  if (!user) {
    await sendTelegramReply(chatId, "Kein Benutzer konfiguriert.", messageId)
    return
  }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      issuedAt: { gte: monthStart, lt: now },
    },
    select: { total: true, type: true },
  })

  let income = 0
  let expenses = 0
  for (const t of transactions) {
    if (t.type === "income") {
      income += t.total ?? 0
    } else if (t.type === "expense") {
      expenses += t.total ?? 0
    }
  }

  const monthName = now.toLocaleString("de-DE", { month: "long", year: "numeric" })

  await sendTelegramReply(
    chatId,
    `<b>Monatsueberblick ${monthName}</b>\n\n` +
      `Einnahmen: ${income.toFixed(2)} EUR\n` +
      `Ausgaben: ${expenses.toFixed(2)} EUR\n` +
      `Saldo: ${(income - expenses).toFixed(2)} EUR\n` +
      `Transaktionen: ${transactions.length}`,
    messageId
  )
}

async function handleFileUpload(
  chatId: string,
  messageId: number,
  fileId: string,
  fileName: string,
  mimeType: string
) {
  const user = await getAuthorizedUser()
  if (!user) {
    await sendTelegramReply(chatId, "Kein Benutzer konfiguriert.", messageId)
    return
  }

  // Notify user that processing has started
  await sendTelegramReply(chatId, "Datei empfangen. Analyse laeuft...", messageId)

  // 1. Download file from Telegram
  const fileBuffer = await downloadTelegramFile(fileId)

  // 2. Save to uploads directory
  const fileUuid = randomUUID()
  const relativeFilePath = unsortedFilePath(fileUuid, fileName)
  const userUploadsDir = safePathJoin(FILE_UPLOAD_PATH, user.email)
  const fullFilePath = safePathJoin(userUploadsDir, relativeFilePath)

  await mkdir(path.dirname(fullFilePath), { recursive: true })
  await writeFile(fullFilePath, fileBuffer)

  // 3. Create file record in database
  const fileRecord = await createFile(user.id, {
    id: fileUuid,
    filename: fileName,
    path: relativeFilePath,
    mimetype: mimeType,
    metadata: { source: "telegram", telegramFileId: fileId },
  })

  // 4. Generate previews and load attachments for AI
  const { contentType, previews } = await generateFilePreviews(user, fullFilePath, mimeType)
  const attachments = await Promise.all(
    previews.slice(0, 4).map(async (preview) => ({
      filename: fileName,
      contentType,
      base64: await loadFileAsBase64(preview),
    }))
  )

  // 5. Build LLM prompt and schema
  const [fields, categories, projects, settings] = await Promise.all([
    getFields(user.id),
    getCategories(user.id),
    getProjects(user.id),
    getSettings(user.id),
  ])

  const prompt = buildLLMPrompt(
    settings.prompt_analyse_new_file || DEFAULT_PROMPT_ANALYSE_NEW_FILE,
    fields,
    categories,
    projects,
    settings.locale || undefined
  )
  const schema = fieldsToJsonSchema(fields)

  // 6. Analyze with LLM
  const analysisResult = await analyzeTransaction(prompt, schema, attachments, fileRecord.id, user.id)

  if (!analysisResult.success || !analysisResult.data) {
    await sendTelegramReply(
      chatId,
      `Analyse fehlgeschlagen: ${analysisResult.error || "Unbekannter Fehler"}\n\nDie Datei wurde trotzdem gespeichert und kann manuell verarbeitet werden.`,
      messageId
    )
    return
  }

  const output = analysisResult.data.output

  // 7. Create transaction from extracted data
  const transactionData: TransactionData = {
    name: output.name || output.merchant || fileName,
    description: output.description || undefined,
    merchant: output.merchant || undefined,
    total: output.total ? parseFloat(String(output.total)) : undefined,
    currencyCode: output.currencyCode || output.currency_code || "EUR",
    type: output.type || "expense",
    categoryCode: output.categoryCode || output.category_code || undefined,
    projectCode: output.projectCode || output.project_code || undefined,
    issuedAt: output.issuedAt || output.issued_at || new Date().toISOString(),
    note: `Automatisch via Telegram Bot importiert`,
    text: output.text || undefined,
    files: [fileRecord.id],
    sourceType: "telegram",
  }

  const transaction = await createTransaction(user.id, transactionData)

  // Mark file as reviewed since we auto-created a transaction
  await prisma.file.update({
    where: { id: fileRecord.id, userId: user.id },
    data: { isReviewed: true },
  })

  // 8. Send result to user
  const resultMessage = formatTransactionMessage({
    name: transactionData.name || undefined,
    merchant: transactionData.merchant || undefined,
    total: transactionData.total ? Number(transactionData.total) : undefined,
    currencyCode: transactionData.currencyCode || undefined,
    type: transactionData.type || undefined,
    issuedAt: transactionData.issuedAt ? String(transactionData.issuedAt) : undefined,
    categoryCode: transactionData.categoryCode || undefined,
  })

  await sendTelegramReply(chatId, resultMessage + "\n\nTransaktion wurde gespeichert.", messageId)
}

/**
 * Get the authorized user for this bot.
 * In self-hosted mode, uses the self-hosted user.
 * Otherwise, looks up the user associated with the Telegram chat ID.
 */
async function getAuthorizedUser() {
  if (config.selfHosted.isEnabled) {
    return await getSelfHostedUser()
  }

  // For non-self-hosted mode, find user by Telegram chat ID from settings
  if (config.telegram.chatId) {
    // Find the user who has this telegram chat ID configured
    // In self-hosted mode there is only one user anyway
    return await getSelfHostedUser()
  }

  return null
}
