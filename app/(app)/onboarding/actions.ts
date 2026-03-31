"use server"

import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { lookupFinTSInstitute } from "@/lib/fints/institute-lookup"

export type CompanyProfileData = {
  companyName?: string
  legalForm?: string
  street?: string
  zipCode?: string
  city?: string
  taxNumber?: string
  vatId?: string
  taxOffice?: string
  fiscalYearStart?: string
  phone?: string
  email?: string
  website?: string
  chartOfAccounts?: string
  datevConsultant?: string
  datevClient?: string
  erpnextUrl?: string
  erpnextApiKey?: string
  erpnextApiSecret?: string
  sageExportEnabled?: boolean
  telegramBotToken?: string
  telegramChatId?: string
}

type ActionResult<T = null> = {
  success: boolean
  error?: string
  data?: T
}

export async function getCompanyProfileAction(): Promise<ActionResult<CompanyProfileData & { onboardingCompleted: boolean } | null>> {
  try {
    const user = await getCurrentUser()
    const profile = await prisma.companyProfile.findUnique({
      where: { userId: user.id },
    })
    if (!profile) {
      return { success: true, data: null }
    }
    return {
      success: true,
      data: {
        companyName: profile.companyName ?? undefined,
        legalForm: profile.legalForm ?? undefined,
        street: profile.street ?? undefined,
        zipCode: profile.zipCode ?? undefined,
        city: profile.city ?? undefined,
        taxNumber: profile.taxNumber ?? undefined,
        vatId: profile.vatId ?? undefined,
        taxOffice: profile.taxOffice ?? undefined,
        fiscalYearStart: profile.fiscalYearStart ?? undefined,
        phone: profile.phone ?? undefined,
        email: profile.email ?? undefined,
        website: profile.website ?? undefined,
        chartOfAccounts: profile.chartOfAccounts ?? undefined,
        datevConsultant: profile.datevConsultant ?? undefined,
        datevClient: profile.datevClient ?? undefined,
        erpnextUrl: profile.erpnextUrl ?? undefined,
        erpnextApiKey: profile.erpnextApiKey ?? undefined,
        erpnextApiSecret: profile.erpnextApiSecret ?? undefined,
        sageExportEnabled: profile.sageExportEnabled,
        telegramBotToken: profile.telegramBotToken ?? undefined,
        telegramChatId: profile.telegramChatId ?? undefined,
        onboardingCompleted: profile.onboardingCompleted,
      },
    }
  } catch (error) {
    return { success: false, error: "Profil konnte nicht geladen werden." }
  }
}

export async function saveCompanyProfileAction(data: CompanyProfileData): Promise<ActionResult> {
  try {
    const user = await getCurrentUser()
    await prisma.companyProfile.upsert({
      where: { userId: user.id },
      update: {
        companyName: data.companyName ?? null,
        legalForm: data.legalForm ?? null,
        street: data.street ?? null,
        zipCode: data.zipCode ?? null,
        city: data.city ?? null,
        taxNumber: data.taxNumber ?? null,
        vatId: data.vatId ?? null,
        taxOffice: data.taxOffice ?? null,
        fiscalYearStart: data.fiscalYearStart ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        website: data.website ?? null,
        chartOfAccounts: data.chartOfAccounts ?? null,
        datevConsultant: data.datevConsultant ?? null,
        datevClient: data.datevClient ?? null,
        erpnextUrl: data.erpnextUrl ?? null,
        erpnextApiKey: data.erpnextApiKey ?? null,
        erpnextApiSecret: data.erpnextApiSecret ?? null,
        sageExportEnabled: data.sageExportEnabled ?? false,
        telegramBotToken: data.telegramBotToken ?? null,
        telegramChatId: data.telegramChatId ?? null,
      },
      create: {
        userId: user.id,
        companyName: data.companyName ?? null,
        legalForm: data.legalForm ?? null,
        street: data.street ?? null,
        zipCode: data.zipCode ?? null,
        city: data.city ?? null,
        taxNumber: data.taxNumber ?? null,
        vatId: data.vatId ?? null,
        taxOffice: data.taxOffice ?? null,
        fiscalYearStart: data.fiscalYearStart ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        website: data.website ?? null,
        chartOfAccounts: data.chartOfAccounts ?? null,
        datevConsultant: data.datevConsultant ?? null,
        datevClient: data.datevClient ?? null,
        erpnextUrl: data.erpnextUrl ?? null,
        erpnextApiKey: data.erpnextApiKey ?? null,
        erpnextApiSecret: data.erpnextApiSecret ?? null,
        sageExportEnabled: data.sageExportEnabled ?? false,
        telegramBotToken: data.telegramBotToken ?? null,
        telegramChatId: data.telegramChatId ?? null,
      },
    })
    return { success: true }
  } catch (error) {
    return { success: false, error: "Profil konnte nicht gespeichert werden." }
  }
}

export async function completeOnboardingAction(): Promise<ActionResult> {
  try {
    const user = await getCurrentUser()
    await prisma.companyProfile.upsert({
      where: { userId: user.id },
      update: { onboardingCompleted: true },
      create: { userId: user.id, onboardingCompleted: true },
    })
    return { success: true }
  } catch (error) {
    return { success: false, error: "Onboarding konnte nicht abgeschlossen werden." }
  }
}

export async function validateTaxNumberAction(taxNumber: string): Promise<ActionResult<{ valid: boolean }>> {
  // German tax number formats:
  // Standardschema (unified): FF/BBB/UUUUP (11 digits after removing slashes)
  // Bundesschema: FFB/BB/UUUUP (11 digits after removing slashes)
  const cleaned = taxNumber.replace(/[\s/]/g, "")

  if (!/^\d{10,11}$/.test(cleaned)) {
    return {
      success: true,
      data: { valid: false },
    }
  }

  // Check common patterns with slashes
  const standardPattern = /^\d{2,3}\/\d{2,3}\/\d{4,5}\d?$/
  if (!standardPattern.test(taxNumber) && !/^\d{10,11}$/.test(taxNumber)) {
    return {
      success: true,
      data: { valid: false },
    }
  }

  return { success: true, data: { valid: true } }
}

export async function validateVatIdAction(vatId: string): Promise<ActionResult<{ valid: boolean }>> {
  // USt-IdNr format: DE followed by exactly 9 digits
  const cleaned = vatId.replace(/\s/g, "")
  const valid = /^DE\d{9}$/.test(cleaned)
  return { success: true, data: { valid } }
}

export async function lookupBankForOnboardingAction(
  blz: string,
): Promise<ActionResult<{ bankName: string; fintsUrl: string; bic: string }>> {
  if (!blz || blz.length !== 8 || !/^\d{8}$/.test(blz)) {
    return { success: false, error: "BLZ muss genau 8 Ziffern haben." }
  }

  const result = lookupFinTSInstitute(blz)
  if (!result) {
    return { success: false, error: "Bank nicht gefunden." }
  }

  return { success: true, data: result }
}
