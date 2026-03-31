import { prisma } from "@/lib/db"
import type { FinTSBankAccount } from "@/prisma/client"
import { cache } from "react"
import { encryptPin, decryptPin } from "@/lib/fints/encryption"

export type BankAccountData = {
  bankCode: string
  bankName?: string
  accountNumber: string
  iban?: string
  bic?: string
  fintsUrl: string
  fintsUser: string
  fintsPin: string
  tanMethodId?: number
  tanMediaName?: string
}

export const getBankAccounts = cache(async (userId: string): Promise<FinTSBankAccount[]> => {
  return await prisma.finTSBankAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  })
})

export const getBankAccountById = cache(async (id: string, userId: string): Promise<FinTSBankAccount | null> => {
  return await prisma.finTSBankAccount.findUnique({
    where: { id, userId },
  })
})

export const createBankAccount = async (userId: string, data: BankAccountData): Promise<FinTSBankAccount> => {
  return await prisma.finTSBankAccount.create({
    data: {
      userId,
      bankCode: data.bankCode,
      bankName: data.bankName,
      accountNumber: data.accountNumber,
      iban: data.iban,
      bic: data.bic,
      fintsUrl: data.fintsUrl,
      fintsUser: data.fintsUser,
      fintsPin: encryptPin(data.fintsPin),
      tanMethodId: data.tanMethodId,
      tanMediaName: data.tanMediaName,
    },
  })
}

export const updateBankAccount = async (
  id: string,
  userId: string,
  data: Partial<BankAccountData & { bankingInfo?: object; lastSyncAt?: Date; lastSyncStatus?: string; isActive?: boolean }>,
): Promise<FinTSBankAccount> => {
  return await prisma.finTSBankAccount.update({
    where: { id, userId },
    data,
  })
}

export const updateBankingInfo = async (id: string, bankingInfo: object): Promise<void> => {
  await prisma.finTSBankAccount.update({
    where: { id },
    data: { bankingInfo: bankingInfo as any },
  })
}

export function getDecryptedPin(account: FinTSBankAccount): string {
  return decryptPin(account.fintsPin)
}

export const deleteBankAccount = async (id: string, userId: string): Promise<void> => {
  await prisma.finTSBankAccount.delete({
    where: { id, userId },
  })
}
