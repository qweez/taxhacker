-- CreateTable
CREATE TABLE "fints_bank_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bank_code" TEXT NOT NULL,
    "bank_name" TEXT,
    "account_number" TEXT NOT NULL,
    "iban" TEXT,
    "bic" TEXT,
    "fints_url" TEXT NOT NULL,
    "fints_user" TEXT NOT NULL,
    "fints_pin" TEXT NOT NULL,
    "banking_info" JSONB,
    "tan_method_id" INTEGER,
    "tan_media_name" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fints_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "source_type" TEXT DEFAULT 'manual';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "external_id" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "bank_account_id" UUID;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "is_reconciled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "reconciled_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "fints_bank_accounts_user_id_iban_key" ON "fints_bank_accounts"("user_id", "iban");

-- CreateIndex
CREATE INDEX "fints_bank_accounts_user_id_idx" ON "fints_bank_accounts"("user_id");

-- CreateIndex
CREATE INDEX "transactions_external_id_idx" ON "transactions"("external_id");

-- CreateIndex
CREATE INDEX "transactions_bank_account_id_idx" ON "transactions"("bank_account_id");

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "details" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "fints_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fints_bank_accounts" ADD CONSTRAINT "fints_bank_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
