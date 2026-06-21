CREATE TABLE "analyzer_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "input" text NOT NULL,
  "source_url" text NOT NULL,
  "collection_name" text,
  "contract_address" text,
  "chain" text NOT NULL,
  "risk_score" integer NOT NULL,
  "opportunity_score" integer NOT NULL,
  "readiness_score" integer NOT NULL,
  "mint_state" text NOT NULL,
  "provider_used" text NOT NULL,
  "rpc_provider_used" text,
  "provider_chain" json,
  "timing_breakdown" json,
  "analysis_duration_ms" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "analyzer_history_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);

CREATE INDEX "idx_analyzer_history_user_id" ON "analyzer_history" ("user_id");
CREATE INDEX "idx_analyzer_history_user_created_at" ON "analyzer_history" ("user_id", "created_at");
CREATE INDEX "idx_analyzer_history_chain" ON "analyzer_history" ("chain");
CREATE INDEX "idx_analyzer_history_contract" ON "analyzer_history" ("contract_address");
