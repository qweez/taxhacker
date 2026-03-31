import { getCurrentUser } from "@/lib/auth"
import { getBankAccounts } from "@/models/bank-accounts"
import BankingDashboard from "./components/banking-dashboard"

export default async function BankingApp() {
  const user = await getCurrentUser()
  const accounts = await getBankAccounts(user.id)

  // Strip PIN before sending to client
  const safeAccounts = accounts.map(a => ({
    id: a.id,
    bankCode: a.bankCode,
    bankName: a.bankName,
    accountNumber: a.accountNumber,
    iban: a.iban,
    bic: a.bic,
    fintsUrl: a.fintsUrl,
    lastSyncAt: a.lastSyncAt?.toISOString() || null,
    lastSyncStatus: a.lastSyncStatus,
    isActive: a.isActive,
  }))

  const userProfile = {
    businessName: user.businessName,
    businessAddress: user.businessAddress,
    businessBankDetails: user.businessBankDetails,
    businessLogo: user.businessLogo,
  }

  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-2 mb-8">
        <h2 className="flex flex-row gap-3 md:gap-5">
          <span className="text-3xl font-bold tracking-tight">
            Banking (FinTS)
          </span>
        </h2>
      </header>
      <BankingDashboard accounts={safeAccounts} userProfile={userProfile} />
    </div>
  )
}

export const dynamic = "force-dynamic"
