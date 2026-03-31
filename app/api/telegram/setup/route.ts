import { NextRequest, NextResponse } from "next/server"
import config from "@/lib/config"
import { setTelegramWebhook } from "@/lib/telegram-bot"

export async function GET(request: NextRequest) {
  // Verify the setup request with the webhook secret
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get("secret")

  if (!config.telegram.webhookSecret) {
    return NextResponse.json(
      { error: "TELEGRAM_WEBHOOK_SECRET ist nicht konfiguriert." },
      { status: 403 }
    )
  }

  if (secret !== config.telegram.webhookSecret) {
    return NextResponse.json(
      { error: "Ungueltiges Secret." },
      { status: 401 }
    )
  }

  if (!config.telegram.botToken) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN ist nicht konfiguriert." },
      { status: 400 }
    )
  }

  const webhookUrl = `${config.app.baseURL}/api/telegram/webhook`
  const success = await setTelegramWebhook(webhookUrl)

  if (success) {
    return NextResponse.json({
      ok: true,
      message: "Webhook erfolgreich eingerichtet.",
      webhookUrl,
    })
  } else {
    return NextResponse.json(
      { error: "Webhook-Einrichtung bei Telegram fehlgeschlagen." },
      { status: 500 }
    )
  }
}
