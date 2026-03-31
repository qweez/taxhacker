import { NextRequest, NextResponse } from "next/server"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { decryptPin } from "@/lib/fints/encryption"
import { fetchStatements } from "@/lib/fints/client"
import { syncBankTransactions } from "@/lib/fints/sync"
import { sendTelegramMessage, formatSyncReport } from "@/lib/fints/telegram"
import { logAuditEvent } from "@/models/audit-log"
import { generateDueTransactions } from "@/lib/recurring-invoices"
import type { FinTSConnectionConfig } from "@/lib/fints/client"

const SYNC_DAYS_BACK = 7

type AccountSyncResult = {
  accountId: string
  iban: string | null
  bankName: string | null
  success: boolean
  imported?: number
  skipped?: number
  errors?: string[]
  error?: string
  skippedReason?: string
}

function buildFinTSConfigFromAccount(account: {
  bankCode: string
  fintsUrl: string
  fintsUser: string
  fintsPin: string
  bankingInfo: any
  tanMethodId: number | null
  tanMediaName: string | null
}): FinTSConnectionConfig {
  return {
    bankCode: account.bankCode,
    fintsUrl: account.fintsUrl,
    userId: account.fintsUser,
    pin: decryptPin(account.fintsPin),
    bankingInfo: account.bankingInfo as object | null,
    tanMethodId: account.tanMethodId,
    tanMediaName: account.tanMediaName,
  }
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

  // Find all active bank accounts across all users
  const accounts = await prisma.finTSBankAccount.findMany({
    where: { isActive: true },
  })

  if (accounts.length === 0) {
    return NextResponse.json({
      message: "No active bank accounts found.",
      results: [],
    })
  }

  const results: AccountSyncResult[] = []
  const from = new Date()
  from.setDate(from.getDate() - SYNC_DAYS_BACK)

  for (const account of accounts) {
    try {
      const cfg = buildFinTSConfigFromAccount(account)
      const result = await fetchStatements(cfg, account.accountNumber, from)

      if (!result.success) {
        results.push({
          accountId: account.id,
          iban: account.iban,
          bankName: account.bankName,
          success: false,
          error: result.error || "Unknown fetch error",
        })
        console.error(`[cron/fints-sync] Failed to fetch statements for account ${account.id}: ${result.error}`)
        continue
      }

      // If TAN is required, skip this account (can't do TAN in cron)
      if (result.requiresTan) {
        results.push({
          accountId: account.id,
          iban: account.iban,
          bankName: account.bankName,
          success: false,
          skippedReason: "TAN required - cannot complete in automated sync",
        })
        console.warn(`[cron/fints-sync] Account ${account.id} requires TAN, skipping.`)
        continue
      }

      if (!result.transactions?.length) {
        results.push({
          accountId: account.id,
          iban: account.iban,
          bankName: account.bankName,
          success: true,
          imported: 0,
          skipped: 0,
          errors: [],
        })
        continue
      }

      const stats = await syncBankTransactions(account.userId, account.id, result.transactions)

      // Send Telegram notification
      await sendTelegramMessage(formatSyncReport({
        bankName: account.bankName || undefined,
        accountNumber: account.accountNumber,
        ...stats,
      }))

      // Log audit event
      await logAuditEvent(account.userId, "bank_account.cron_sync", account.id, {
        ...stats,
        daysBack: SYNC_DAYS_BACK,
      })

      results.push({
        accountId: account.id,
        iban: account.iban,
        bankName: account.bankName,
        success: true,
        imported: stats.imported,
        skipped: stats.skipped,
        errors: stats.errors,
      })
    } catch (error: any) {
      results.push({
        accountId: account.id,
        iban: account.iban,
        bankName: account.bankName,
        success: false,
        error: error.message || "Unexpected error",
      })
      console.error(`[cron/fints-sync] Unexpected error for account ${account.id}:`, error)
    }
  }

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  // Generate due recurring invoices for each unique user
  const userIds = [...new Set(accounts.map(a => a.userId))]
  const recurringResults: Record<string, { generated: number; skipped: number }> = {}

  for (const userId of userIds) {
    try {
      const result = await generateDueTransactions(userId)
      recurringResults[userId] = result
      if (result.generated > 0) {
        await logAuditEvent(userId, "recurring_invoice.cron_generate", undefined, result)
      }
    } catch (error: any) {
      console.error(`[cron/fints-sync] Failed to generate recurring invoices for user ${userId}:`, error)
      recurringResults[userId] = { generated: 0, skipped: 0 }
    }
  }

  return NextResponse.json({
    message: `Cron sync complete. ${successCount} succeeded, ${failCount} failed.`,
    syncedAt: new Date().toISOString(),
    totalAccounts: accounts.length,
    results,
    recurringInvoices: recurringResults,
  })
}
