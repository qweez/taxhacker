CREATE TABLE "recurring_invoices" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "merchant" TEXT,
  "description" TEXT,
  "amount" INTEGER NOT NULL,
  "currency_code" TEXT NOT NULL DEFAULT 'EUR',
  "type" TEXT NOT NULL DEFAULT 'expense',
  "category_code" TEXT,
  "project_code" TEXT,
  "frequency" TEXT NOT NULL DEFAULT 'monthly',
  "start_date" DATE NOT NULL,
  "end_date" DATE,
  "next_due_date" DATE NOT NULL,
  "last_generated_at" TIMESTAMP,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "auto_generate" BOOLEAN NOT NULL DEFAULT false,
  "notify_before_days" INTEGER DEFAULT 3,
  "inflation_adjusted" BOOLEAN NOT NULL DEFAULT false,
  "base_amount" INTEGER,
  "base_year" INTEGER,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX "idx_recurring_invoices_user_id" ON "recurring_invoices"("user_id");
CREATE INDEX "idx_recurring_invoices_next_due_date" ON "recurring_invoices"("next_due_date");
CREATE INDEX "idx_recurring_invoices_is_active" ON "recurring_invoices"("is_active");
