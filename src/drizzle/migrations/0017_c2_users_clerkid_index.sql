CREATE TYPE "public"."task_status" AS ENUM('pending', 'running', 'retrying', 'completed', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('wallet_monitoring', 'nft_tracking', 'collection_sync', 'metadata_refresh', 'mint_execution', 'website_monitoring', 'browser_automation');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('PAGE_CHANGED', 'SITE_OFFLINE', 'SITE_ONLINE', 'CONTENT_CHANGED');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."website_status" AS ENUM('unknown', 'no_change', 'changed', 'mint_active', 'mint_ended', 'error');--> statement-breakpoint
CREATE TYPE "public"."website_type" AS ENUM('mint_page', 'project_site', 'launchpad', 'whitelist_page', 'marketplace', 'other');--> statement-breakpoint
ALTER TYPE "public"."infrastructure_test_status" ADD VALUE 'skipped';--> statement-breakpoint
ALTER TYPE "public"."mint_status" ADD VALUE 'unconfirmed';--> statement-breakpoint
CREATE TABLE "analyzer_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"input" text NOT NULL,
	"source_url" text NOT NULL,
	"collection_name" text,
	"contract_address" text,
	"chain" text NOT NULL,
	"risk_score" integer NOT NULL,
	"risk_level" text DEFAULT 'Medium' NOT NULL,
	"risk_factors" json,
	"floor_price" text,
	"floor_currency" text,
	"floor_symbol" text,
	"owner_count" integer,
	"volume" text,
	"market_status" text,
	"health_score" integer,
	"opportunity_score" integer NOT NULL,
	"readiness_score" integer NOT NULL,
	"mint_state" text NOT NULL,
	"provider_used" text NOT NULL,
	"cache_used" boolean DEFAULT false NOT NULL,
	"rpc_provider_used" text,
	"provider_chain" json,
	"timing_breakdown" json,
	"socials" json,
	"social_count" integer DEFAULT 0 NOT NULL,
	"analysis_duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"mint_scheduled_enabled" boolean DEFAULT true NOT NULL,
	"mint_success_enabled" boolean DEFAULT true NOT NULL,
	"mint_failed_enabled" boolean DEFAULT true NOT NULL,
	"system_errors_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value_encrypted" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "integration_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "rpc_provider_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"routing_mode" text DEFAULT 'SMART' NOT NULL,
	"preferred_provider" text,
	"auto_failover" boolean DEFAULT true NOT NULL,
	"rpc_timeout_seconds" integer DEFAULT 45 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"task_type" "task_type" NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"error" jsonb,
	"scheduled_for" timestamp,
	"idempotency_key" text,
	"tx_hash" text,
	"execution_fingerprint" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "browser_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"status" "session_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"result" jsonb,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "monitored_websites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"chain" text,
	"website_type" "website_type" DEFAULT 'mint_page' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"check_interval_minutes" integer DEFAULT 5 NOT NULL,
	"last_status" "website_status" DEFAULT 'unknown' NOT NULL,
	"last_checked_at" timestamp,
	"last_change_at" timestamp,
	"last_snapshot" jsonb,
	"last_snapshot_hash" text,
	"metadata" jsonb,
	"browser_session_id" text,
	"browser_result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"old_snapshot" jsonb,
	"new_snapshot" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration" integer,
	"result" jsonb,
	"error" jsonb
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_clerk_id_unique";--> statement-breakpoint
ALTER TABLE "copy_mint_rules" ADD COLUMN "risk_threshold" integer DEFAULT 75 NOT NULL;--> statement-breakpoint
ALTER TABLE "copy_mint_rules" ADD COLUMN "destination_wallet_id" uuid;--> statement-breakpoint
ALTER TABLE "copy_mint_rules" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mint_history" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "mint_tasks" ADD COLUMN "gas_strategy" text DEFAULT 'STANDARD' NOT NULL;--> statement-breakpoint
ALTER TABLE "mint_tasks" ADD COLUMN "max_retries" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "mint_tasks" ADD COLUMN "risk_threshold" integer DEFAULT 75 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "wallet_type" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "balance" text;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "balance_symbol" text;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "balance_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "watched_wallets" ADD COLUMN "wallet_name" text;--> statement-breakpoint
ALTER TABLE "watched_wallets" ADD COLUMN "network_type" text DEFAULT 'EVM' NOT NULL;--> statement-breakpoint
ALTER TABLE "watched_wallets" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "analyzer_history" ADD CONSTRAINT "analyzer_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_notification_preferences" ADD CONSTRAINT "email_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_settings" ADD CONSTRAINT "execution_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rpc_provider_settings" ADD CONSTRAINT "rpc_provider_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_website_id_monitored_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."monitored_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitored_websites" ADD CONSTRAINT "monitored_websites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_events" ADD CONSTRAINT "monitoring_events_website_id_monitored_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."monitored_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analyzer_history_user_id" ON "analyzer_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_analyzer_history_user_created_at" ON "analyzer_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_analyzer_history_chain" ON "analyzer_history" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "idx_analyzer_history_contract" ON "analyzer_history" USING btree ("contract_address");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_email_notification_preferences_user_id" ON "email_notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_execution_settings_user_id" ON "execution_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rpc_provider_settings_user_id" ON "rpc_provider_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_status_type_scheduled" ON "tasks" USING btree ("status","task_type","scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_id" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tasks_idempotency_key" ON "tasks" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_tasks_dead_letter" ON "tasks" USING btree ("status") WHERE status = 'dead_letter';--> statement-breakpoint
CREATE INDEX "idx_tasks_priority" ON "tasks" USING btree ("priority","created_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_website_id" ON "browser_sessions" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_status" ON "browser_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_websites_enabled" ON "monitored_websites" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_websites_type" ON "monitored_websites" USING btree ("website_type");--> statement-breakpoint
CREATE INDEX "idx_websites_last_checked" ON "monitored_websites" USING btree ("last_checked_at");--> statement-breakpoint
CREATE INDEX "idx_websites_user_id" ON "monitored_websites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_events_website_id" ON "monitoring_events" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "idx_events_created_at" ON "monitoring_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_events_event_type" ON "monitoring_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_executions_task_id" ON "task_executions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_executions_status" ON "task_executions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "copy_mint_rules" ADD CONSTRAINT "copy_mint_rules_destination_wallet_id_wallets_id_fk" FOREIGN KEY ("destination_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_clerk_id" ON "users" USING btree ("clerk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallets_default_per_user" ON "wallets" USING btree ("user_id") WHERE "wallets"."is_default" = true;--> statement-breakpoint
ALTER TABLE "mint_history" ADD CONSTRAINT "mint_history_idempotency_key_unique" UNIQUE("idempotency_key");