CREATE TABLE "execution_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "default_mint_quantity" integer DEFAULT 1 NOT NULL,
  "default_wallet_id" uuid,
  "gas_strategy" text DEFAULT 'STANDARD' NOT NULL,
  "max_retries" integer DEFAULT 25 NOT NULL,
  "risk_threshold" integer DEFAULT 75 NOT NULL,
  "auto_run_analyzer" boolean DEFAULT true NOT NULL,
  "auto_detect_socials" boolean DEFAULT true NOT NULL,
  "auto_detect_contract_info" boolean DEFAULT true NOT NULL,
  "auto_detect_mint_details" boolean DEFAULT true NOT NULL,
  "risk_analysis_enabled" boolean DEFAULT true NOT NULL,
  "ai_summary_enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "execution_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade,
  CONSTRAINT "execution_settings_default_wallet_id_wallets_id_fk" FOREIGN KEY ("default_wallet_id") REFERENCES "wallets"("id") ON DELETE set null,
  CONSTRAINT "idx_execution_settings_user_id" UNIQUE("user_id")
);

ALTER TABLE "mint_tasks" ADD COLUMN "gas_strategy" text DEFAULT 'STANDARD' NOT NULL;
ALTER TABLE "mint_tasks" ADD COLUMN "max_retries" integer DEFAULT 25 NOT NULL;
ALTER TABLE "mint_tasks" ADD COLUMN "risk_threshold" integer DEFAULT 75 NOT NULL;
