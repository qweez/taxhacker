import config from "@/lib/config"

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegram.botToken}`

/**
 * Download a file from Telegram by its file_id.
 * First calls getFile to get the file_path, then downloads the binary content.
 */
export async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const fileInfoRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`)
  if (!fileInfoRes.ok) {
    throw new Error(`Telegram getFile fehlgeschlagen: ${fileInfoRes.statusText}`)
  }

  const fileInfo = await fileInfoRes.json()
  const filePath = fileInfo.result?.file_path
  if (!filePath) {
    throw new Error("Telegram hat keinen Dateipfad zurueckgegeben")
  }

  const downloadUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`
  const downloadRes = await fetch(downloadUrl)
  if (!downloadRes.ok) {
    throw new Error(`Datei-Download fehlgeschlagen: ${downloadRes.statusText}`)
  }

  const arrayBuffer = await downloadRes.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Send a text reply to a Telegram chat, optionally quoting a specific message.
 */
export async function sendTelegramReply(
  chatId: string,
  text: string,
  replyToMessageId?: number
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  }

  if (replyToMessageId) {
    body.reply_to_message_id = replyToMessageId
  }

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    console.error("Telegram sendMessage fehlgeschlagen:", await res.text())
  }
}

/**
 * Register a webhook URL with Telegram.
 * Uses the secret_token parameter so Telegram sends it in X-Telegram-Bot-Api-Secret-Token header.
 */
export async function setTelegramWebhook(webhookUrl: string): Promise<boolean> {
  const body: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ["message"],
  }

  if (config.telegram.webhookSecret) {
    body.secret_token = config.telegram.webhookSecret
  }

  const res = await fetch(`${TELEGRAM_API}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    console.error("Telegram setWebhook fehlgeschlagen:", await res.text())
    return false
  }

  const data = await res.json()
  return data.ok === true
}

/**
 * Format a transaction result into a human-readable German message.
 */
export function formatTransactionMessage(tx: {
  name?: string
  merchant?: string
  total?: number
  currencyCode?: string
  type?: string
  issuedAt?: string
  categoryCode?: string
}): string {
  const lines: string[] = ["<b>Rechnung erkannt</b>"]

  if (tx.name) lines.push(`Bezeichnung: ${tx.name}`)
  if (tx.merchant) lines.push(`Haendler: ${tx.merchant}`)
  if (tx.total != null) {
    const currency = tx.currencyCode || "EUR"
    lines.push(`Betrag: ${tx.total.toFixed(2)} ${currency}`)
  }
  if (tx.type) lines.push(`Typ: ${tx.type === "income" ? "Einnahme" : "Ausgabe"}`)
  if (tx.issuedAt) lines.push(`Datum: ${tx.issuedAt}`)
  if (tx.categoryCode) lines.push(`Kategorie: ${tx.categoryCode}`)

  return lines.join("\n")
}
