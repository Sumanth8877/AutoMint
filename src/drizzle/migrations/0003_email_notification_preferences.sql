CREATE TABLE "email_notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "email_enabled" boolean DEFAULT false NOT NULL,
  "mint_scheduled_enabled" boolean DEFAULT true NOT NULL,
  "mint_success_enabled" boolean DEFAULT true NOT NULL,
  "mint_failed_enabled" boolean DEFAULT true NOT NULL,
  "system_errors_enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "email_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade,
  CONSTRAINT "idx_email_notification_preferences_user_id" UNIQUE("user_id")
);
