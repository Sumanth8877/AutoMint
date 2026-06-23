-- H-1 fix: create wallet_permissions table
-- This table was defined in schema/index.ts but had no corresponding migration,
-- causing importWallet() to throw a DB error in production on every wallet import.

CREATE TABLE IF NOT EXISTS "wallet_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"can_mint" boolean DEFAULT false NOT NULL,
	"can_monitor" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_permissions" ADD CONSTRAINT "wallet_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wallet_permissions" ADD CONSTRAINT "wallet_permissions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_permissions_user_id" ON "wallet_permissions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_permissions_wallet_id" ON "wallet_permissions" USING btree ("wallet_id");
