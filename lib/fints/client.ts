import { FinTSClient, FinTSConfig } from "lib-fints"
import type { Statement, Transaction as FinTSTransaction } from "lib-fints"

export const FINTS_PRODUCT_ID = "B44C4ADB90726F8A069EB0E84"
export const FINTS_PRODUCT_VERSION = "1.0"

export type FinTSConnectionConfig = {
  bankCode: string
  fintsUrl: string
  userId: string
  pin: string
  bankingInfo?: object | null
  tanMethodId?: number | null
  tanMediaName?: string | null
}

export type FinTSSyncResult = {
  success: boolean
  bankingInfo?: object
  accounts?: FinTSAccountInfo[]
  tanMethods?: { id: number; name: string }[]
  requiresTan?: boolean
  tanChallenge?: string
  tanReference?: string
  error?: string
}

export type FinTSAccountInfo = {
  accountNumber: string
  iban?: string
  bic?: string
  accountType?: string
  bankName?: string
}

export type FinTSStatementResult = {
  success: boolean
  statements?: Statement[]
  transactions?: FinTSTransaction[]
  requiresTan?: boolean
  tanChallenge?: string
  tanReference?: string
  error?: string
}

function createClient(cfg: FinTSConnectionConfig): FinTSClient {
  if (cfg.bankingInfo) {
    const config = FinTSConfig.fromBankingInformation(
      FINTS_PRODUCT_ID,
      FINTS_PRODUCT_VERSION,
      cfg.bankingInfo as any,
      cfg.userId,
      cfg.pin,
      cfg.tanMethodId ?? undefined,
      cfg.tanMediaName ?? undefined,
    )
    return new FinTSClient(config)
  }

  const config = FinTSConfig.forFirstTimeUse(
    FINTS_PRODUCT_ID,
    FINTS_PRODUCT_VERSION,
    cfg.fintsUrl,
    cfg.bankCode,
    cfg.userId,
    cfg.pin,
  )
  return new FinTSClient(config)
}

export async function synchronizeBank(cfg: FinTSConnectionConfig): Promise<FinTSSyncResult> {
  try {
    const client = createClient(cfg)
    let response = await client.synchronize()

    if (!response.success) {
      const messages = response.bankAnswers?.map(a => a.text).join("; ") || "Synchronization failed"
      return { success: false, error: messages }
    }

    if (response.requiresTan) {
      return {
        success: true,
        requiresTan: true,
        tanChallenge: response.tanChallenge,
        tanReference: response.tanReference,
        bankingInfo: client.config.bankingInformation as any,
      }
    }

    // If first sync only returned BPD (no accounts), select first TAN method and re-sync
    const bpd = client.config.bankingInformation?.bpd
    const upd = client.config.bankingInformation?.upd
    if (bpd && (!upd || !upd.bankAccounts?.length)) {
      const tanMethods = client.config.availableTanMethods
      if (tanMethods.length > 0) {
        client.selectTanMethod(tanMethods[0].id)
        response = await client.synchronize()

        if (response.requiresTan) {
          return {
            success: true,
            requiresTan: true,
            tanChallenge: response.tanChallenge,
            tanReference: response.tanReference,
            tanMethods: tanMethods.map(t => ({ id: t.id, name: t.name })),
            bankingInfo: client.config.bankingInformation as any,
          }
        }
      }
    }

    const accounts: FinTSAccountInfo[] = (client.config.bankingInformation?.upd?.bankAccounts || []).map((acc: any) => ({
      accountNumber: acc.accountNumber,
      iban: acc.iban,
      bic: acc.bic,
      accountType: acc.accountType,
    }))

    return {
      success: true,
      bankingInfo: client.config.bankingInformation as any,
      accounts,
      tanMethods: client.config.availableTanMethods.map(t => ({ id: t.id, name: t.name })),
    }
  } catch (error: any) {
    return { success: false, error: error.message || "Connection failed" }
  }
}

export async function continueSyncWithTan(
  cfg: FinTSConnectionConfig,
  tanReference: string,
  tan?: string,
): Promise<FinTSSyncResult> {
  try {
    const client = createClient(cfg)
    const response = await client.synchronizeWithTan(tanReference, tan)

    if (!response.success) {
      return { success: false, error: response.bankAnswers?.map(a => a.text).join("; ") }
    }

    if (response.requiresTan) {
      return {
        success: true,
        requiresTan: true,
        tanChallenge: response.tanChallenge,
        tanReference: response.tanReference,
        bankingInfo: client.config.bankingInformation as any,
      }
    }

    const accounts: FinTSAccountInfo[] = (client.config.bankingInformation?.upd?.bankAccounts || []).map((acc: any) => ({
      accountNumber: acc.accountNumber,
      iban: acc.iban,
      bic: acc.bic,
      accountType: acc.accountType,
    }))

    return {
      success: true,
      bankingInfo: client.config.bankingInformation as any,
      accounts,
      tanMethods: client.config.availableTanMethods.map(t => ({ id: t.id, name: t.name })),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function fetchStatements(
  cfg: FinTSConnectionConfig,
  accountNumber: string,
  from?: Date,
  to?: Date,
): Promise<FinTSStatementResult> {
  try {
    const client = createClient(cfg)

    if (!cfg.bankingInfo) {
      const syncResult = await synchronizeBank(cfg)
      if (!syncResult.success) return { success: false, error: syncResult.error }
      if (syncResult.requiresTan) {
        return {
          success: true,
          requiresTan: true,
          tanChallenge: syncResult.tanChallenge,
          tanReference: syncResult.tanReference,
        }
      }
    }

    const response = await client.getAccountStatements(accountNumber, from, to, true)

    if (!response.success) {
      return { success: false, error: response.bankAnswers?.map(a => a.text).join("; ") }
    }

    if (response.requiresTan) {
      return {
        success: true,
        requiresTan: true,
        tanChallenge: response.tanChallenge,
        tanReference: response.tanReference,
      }
    }

    const allTransactions = response.statements?.flatMap(s => s.transactions) || []

    return {
      success: true,
      statements: response.statements,
      transactions: allTransactions,
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function continueStatementsWithTan(
  cfg: FinTSConnectionConfig,
  accountNumber: string,
  tanReference: string,
  tan?: string,
): Promise<FinTSStatementResult> {
  try {
    const client = createClient(cfg)
    const response = await client.getAccountStatementsWithTan(tanReference, tan)

    if (!response.success) {
      return { success: false, error: response.bankAnswers?.map(a => a.text).join("; ") }
    }

    if (response.requiresTan) {
      return {
        success: true,
        requiresTan: true,
        tanChallenge: response.tanChallenge,
        tanReference: response.tanReference,
      }
    }

    const allTransactions = response.statements?.flatMap(s => s.transactions) || []

    return {
      success: true,
      statements: response.statements,
      transactions: allTransactions,
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
