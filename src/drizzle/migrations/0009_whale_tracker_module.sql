ALTER TABLE "watched_wallets" ADD COLUMN "wallet_name" text;
ALTER TABLE "watched_wallets" ADD COLUMN "network_type" text DEFAULT 'EVM' NOT NULL;
ALTER TABLE "watched_wallets" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;

ALTER TABLE "copy_mint_rules" ADD COLUMN "risk_threshold" integer DEFAULT 75 NOT NULL;
ALTER TABLE "copy_mint_rules" ADD COLUMN "destination_wallet_id" uuid REFERENCES "wallets"("id") ON DELETE set null;
ALTER TABLE "copy_mint_rules" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
