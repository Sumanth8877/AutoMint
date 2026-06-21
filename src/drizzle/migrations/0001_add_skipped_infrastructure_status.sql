DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'skipped'
      AND enumtypid = 'public.infrastructure_test_status'::regtype
  ) THEN
    ALTER TYPE "public"."infrastructure_test_status" ADD VALUE 'skipped';
  END IF;
END $$;
