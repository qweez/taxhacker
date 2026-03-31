CREATE TABLE "fixed_assets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id"),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "inventory_number" TEXT,
  "category" TEXT NOT NULL,
  "acquisition_date" DATE NOT NULL,
  "acquisition_cost" INTEGER NOT NULL,
  "residual_value" INTEGER NOT NULL DEFAULT 0,
  "useful_life_years" INTEGER NOT NULL,
  "depreciation_method" TEXT NOT NULL DEFAULT 'linear',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "disposal_date" DATE,
  "disposal_proceeds" INTEGER,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);
