CREATE TABLE "rpc_provider_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "routing_mode" text DEFAULT 'SMART' NOT NULL,
  "preferred_provider" text,
  "auto_failover" boolean DEFAULT true NOT NULL,
  "rpc_timeout_seconds" integer DEFAULT 45 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "rpc_provider_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade,
  CONSTRAINT "idx_rpc_provider_settings_user_id" UNIQUE("user_id")
);
