import { NextRequest, NextResponse } from "next/server"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { generateInflationReport } from "@/lib/inflation"
import { sendTelegramMessage } from "@/lib/fints/telegram"

// 0 0 1 1 * curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:7331/api/cron/inflation-check

const DEFAULT_THRESHOLD = 5.0

function formatInflationReport(
  userName: string,
  items: { name: string; inflationRate: number; difference: number; baseAmount: number; currentAmount: number }[],
  totalDifference: number,
  averageInflation: number,
): string {
  const lines = [
    `<b>Inflationsbericht</b>`,
    `Benutzer: ${userName}`,
    `Durchschnittliche Inflation: ${averageInflation.toFixed(1)}%`,
    `Gesamte Mehrkosten: ${(totalDifference / 100).toFixed(2)} EUR`,
    ``,
    `<b>Anpassung empfohlen:</b>`,
  ]

  for (const item of items.slice(0, 10)) {
    const diff = (item.difference / 100).toFixed(2)
    lines.push(`- ${item.name}: +${diff} EUR (${item.inflationRate.toFixed(1)}%)`)
  }

  if (items.length > 10) {
    lines.push(`... und ${items.length - 10} weitere`)
  }

  return lines.join("\n")
}

export async function GET(request: NextRequest) {
  // Validate CRON_SECRET
  const cronSecret = config.cron.secret
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured. Cron endpoint is disabled." },
      { status: 403 },
    )
  }

  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null

  if (token !== cronSecret) {
    return NextResponse.json(
      { error: "Unauthorized. Invalid or missing Bearer token." },
      { status: 401 },
    )
  }

  // Find all users
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
  })

  if (users.length === 0) {
    return NextResponse.json({
      message: "No users found.",
      results: [],
    })
  }

  const results: {
    userId: string
    userName: string | null
    itemsExceedingThreshold: number
    totalDifference: number
    notified: boolean
    error?: string
  }[] = []

  for (const user of users) {
    try {
      const report = await generateInflationReport(user.id, DEFAULT_THRESHOLD)

      const exceedingItems = report.items.filter(item => item.shouldAdjust)

      let notified = false

      if (exceedingItems.length > 0) {
        // Send Telegram notification
        const message = formatInflationReport(
          user.name || user.email,
          exceedingItems,
          report.totalDifference,
          report.averageInflation,
        )
        notified = await sendTelegramMessage(message)
      }

      results.push({
        userId: user.id,
        userName: user.name,
        itemsExceedingThreshold: exceedingItems.length,
        totalDifference: report.totalDifference,
        notified,
      })
    } catch (error: any) {
      results.push({
        userId: user.id,
        userName: user.name,
        itemsExceedingThreshold: 0,
        totalDifference: 0,
        notified: false,
        error: error.message || "Unexpected error",
      })
      console.error(`[cron/inflation-check] Error for user ${user.id}:`, error)
    }
  }

  const totalExceeding = results.reduce((sum, r) => sum + r.itemsExceedingThreshold, 0)

  return NextResponse.json({
    message: `Inflation check complete. ${totalExceeding} items exceed threshold across ${users.length} users.`,
    checkedAt: new Date().toISOString(),
    threshold: DEFAULT_THRESHOLD,
    totalUsers: users.length,
    results,
  })
}
