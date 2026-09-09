ALTER TABLE "currency" ADD COLUMN "is_crypto" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "currency"
SET "is_crypto" = CASE WHEN "code" = 'ngn' THEN false ELSE true END,
    "updated_at" = now();
