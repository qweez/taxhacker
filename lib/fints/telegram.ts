const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ""

export async function sendTelegramMessage(text: string, chatId?: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) return false

  const targetChat = chatId || TELEGRAM_CHAT_ID
  if (!targetChat) return false

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: targetChat,
          text,
          parse_mode: "HTML",
        }),
      },
    )
    return response.ok
  } catch {
    return false
  }
}

export function formatSyncReport(stats: {
  bankName?: string
  accountNumber: string
  imported: number
  skipped: number
  errors: string[]
}): string {
  const lines = [
    `<b>FinTS Sync Report</b>`,
    `Bank: ${stats.bankName || "Unknown"}`,
    `Konto: ${stats.accountNumber}`,
    `Importiert: ${stats.imported}`,
    `Übersprungen: ${stats.skipped}`,
  ]

  if (stats.errors.length > 0) {
    lines.push(`Fehler: ${stats.errors.length}`)
    lines.push(stats.errors.slice(0, 3).join("\n"))
  }

  return lines.join("\n")
}
