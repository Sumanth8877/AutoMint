CREATE TYPE "public"."infrastructure_test_status" AS ENUM('passed', 'failed', 'warning', 'skipped');
--> statement-breakpoint
CREATE TABLE "infrastructure_test_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service" text NOT NULL,
  "status" "infrastructure_test_status" NOT NULL,
  "score" integer NOT NULL,
  "latency" integer NOT NULL,
  "summary" text NOT NULL,
  "reasoning" text NOT NULL,
  "root_cause" text NOT NULL,
  "fix_recommendation" text NOT NULL,
  "response" json,
  "tested_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_infrastructure_test_runs_service" ON "infrastructure_test_runs" USING btree ("service");
--> statement-breakpoint
CREATE INDEX "idx_infrastructure_test_runs_tested_at" ON "infrastructure_test_runs" USING btree ("tested_at");
