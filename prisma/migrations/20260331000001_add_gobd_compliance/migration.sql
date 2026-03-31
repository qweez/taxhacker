-- GoBD compliance fields
ALTER TABLE "transactions" ADD COLUMN "is_locked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "transactions" ADD COLUMN "locked_at" TIMESTAMP;
ALTER TABLE "transactions" ADD COLUMN "booking_number" SERIAL;
ALTER TABLE "transactions" ADD COLUMN "reversal_of_id" UUID;
ALTER TABLE "transactions" ADD COLUMN "reversed_by_id" UUID;
ALTER TABLE "transactions" ADD CONSTRAINT "fk_reversal_of" FOREIGN KEY ("reversal_of_id") REFERENCES "transactions"("id");
ALTER TABLE "transactions" ADD CONSTRAINT "fk_reversed_by" FOREIGN KEY ("reversed_by_id") REFERENCES "transactions"("id");
CREATE INDEX "idx_transactions_booking_number" ON "transactions"("booking_number");
CREATE INDEX "idx_transactions_is_locked" ON "transactions"("is_locked");
