import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import OnboardingWizard from "./components/onboarding-wizard"

export default async function OnboardingPage() {
  const user = await getCurrentUser()

  const profile = await prisma.companyProfile.findUnique({
    where: { userId: user.id },
  })

  // If onboarding is already completed, redirect to dashboard
  if (profile?.onboardingCompleted) {
    redirect("/")
  }

  // Map existing profile data for the wizard (resume incomplete onboarding)
  const initialData = profile
    ? {
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
      }
    : null

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight">TaxHacker Einrichtung</h1>
        <p className="text-muted-foreground mt-1">Schritt für Schritt zu deiner Buchhaltung</p>
      </div>
      <OnboardingWizard initialData={initialData} />
    </div>
  )
}

export const dynamic = "force-dynamic"
