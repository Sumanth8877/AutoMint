ALTER TABLE "wallets" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;

CREATE UNIQUE INDEX "idx_wallets_default_per_user"
ON "wallets" ("user_id")
WHERE "is_default" = true;
