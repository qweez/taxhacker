-- CreateTable
CREATE TABLE "company_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "company_name" TEXT,
    "legal_form" TEXT,
    "street" TEXT,
    "zip_code" TEXT,
    "city" TEXT,
    "tax_number" TEXT,
    "vat_id" TEXT,
    "tax_office" TEXT,
    "fiscal_year_start" TEXT DEFAULT '01-01',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "chart_of_accounts" TEXT DEFAULT 'SKR04',
    "datev_consultant" TEXT,
    "datev_client" TEXT,
    "erpnext_url" TEXT,
    "erpnext_api_key" TEXT,
    "erpnext_api_secret" TEXT,
    "sage_export_enabled" BOOLEAN NOT NULL DEFAULT false,
    "telegram_bot_token" TEXT,
    "telegram_chat_id" TEXT,
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_user_id_key" ON "company_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
