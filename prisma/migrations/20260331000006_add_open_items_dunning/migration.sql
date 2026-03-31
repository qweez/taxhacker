-- CreateTable
CREATE TABLE "open_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "merchant" TEXT NOT NULL,
    "merchant_address" TEXT,
    "amount" INTEGER NOT NULL,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dunning_level" INTEGER NOT NULL DEFAULT 0,
    "last_dunning_date" TIMESTAMP(3),
    "dunning_fees" INTEGER NOT NULL DEFAULT 0,
    "interest_accrued" INTEGER NOT NULL DEFAULT 0,
    "transaction_id" UUID,
    "notes" TEXT,
    "is_b2b" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "open_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dunning_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "open_item_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "fee" INTEGER NOT NULL,
    "interest" INTEGER NOT NULL,
    "letter_text" TEXT,
    "sent_via" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dunning_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "open_items_user_id_idx" ON "open_items"("user_id");

-- CreateIndex
CREATE INDEX "open_items_status_idx" ON "open_items"("status");

-- CreateIndex
CREATE INDEX "open_items_due_date_idx" ON "open_items"("due_date");

-- CreateIndex
CREATE INDEX "dunning_entries_open_item_id_idx" ON "dunning_entries"("open_item_id");

-- AddForeignKey
ALTER TABLE "open_items" ADD CONSTRAINT "open_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dunning_entries" ADD CONSTRAINT "dunning_entries_open_item_id_fkey" FOREIGN KEY ("open_item_id") REFERENCES "open_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
