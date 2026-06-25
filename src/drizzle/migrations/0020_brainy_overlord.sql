ALTER TABLE "execution_settings" ADD COLUMN "receipt_recheck_attempts" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "mint_tasks" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "mint_tasks" ADD COLUMN "receipt_recheck_attempts" integer DEFAULT 10 NOT NULL;