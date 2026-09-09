CREATE TYPE "public"."platform_fee_context" AS ENUM('swap', 'withdrawal');--> statement-breakpoint
CREATE TYPE "public"."platform_fee_type" AS ENUM('flat', 'percentage');--> statement-breakpoint
CREATE TABLE "platform_fee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"currency_id" uuid NOT NULL,
	"context" "platform_fee_context" NOT NULL,
	"type" "platform_fee_type" NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"minimum_fee" numeric(36, 18),
	"maximum_fee" numeric(36, 18),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_admin_id" uuid NOT NULL,
	"updated_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_fee_amount_nonnegative" CHECK ("platform_fee"."amount" >= 0),
	CONSTRAINT "platform_fee_percentage_at_most_100" CHECK ("platform_fee"."type" <> 'percentage' OR "platform_fee"."amount" <= 100),
	CONSTRAINT "platform_fee_caps_nonnegative" CHECK (
    ("platform_fee"."minimum_fee" IS NULL OR "platform_fee"."minimum_fee" >= 0) AND
    ("platform_fee"."maximum_fee" IS NULL OR "platform_fee"."maximum_fee" >= 0)
  ),
	CONSTRAINT "platform_fee_minimum_at_most_maximum" CHECK (
    "platform_fee"."minimum_fee" IS NULL OR "platform_fee"."maximum_fee" IS NULL OR "platform_fee"."minimum_fee" <= "platform_fee"."maximum_fee"
  ),
	CONSTRAINT "platform_fee_caps_match_type" CHECK (
    ("platform_fee"."type" = 'flat' AND "platform_fee"."minimum_fee" IS NULL AND "platform_fee"."maximum_fee" IS NULL) OR
    "platform_fee"."type" = 'percentage'
  )
);
--> statement-breakpoint
CREATE TABLE "platform_fee_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_fee_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "swaps" DROP CONSTRAINT "swaps_to_amount_positive";--> statement-breakpoint
ALTER TABLE "swaps" ADD COLUMN "gross_to_amount" numeric(36, 18) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "swaps" ADD COLUMN "platform_fee_amount" numeric(36, 18) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "swaps" ADD COLUMN "platform_fee_id" uuid;--> statement-breakpoint
ALTER TABLE "swaps" ADD COLUMN "platform_fee_type" "platform_fee_type";--> statement-breakpoint
ALTER TABLE "swaps" ADD COLUMN "platform_fee_configured_amount" numeric(36, 18);--> statement-breakpoint
ALTER TABLE "swaps" ADD COLUMN "platform_fee_minimum_fee" numeric(36, 18);--> statement-breakpoint
ALTER TABLE "swaps" ADD COLUMN "platform_fee_maximum_fee" numeric(36, 18);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "platform_fee_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "platform_fee_type" "platform_fee_type";--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "platform_fee_configured_amount" numeric(36, 18);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "platform_fee_minimum_fee" numeric(36, 18);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "platform_fee_maximum_fee" numeric(36, 18);--> statement-breakpoint
UPDATE "swaps"
SET "gross_to_amount" = "to_amount",
    "platform_fee_amount" = '0'
WHERE "gross_to_amount" = '0';--> statement-breakpoint
ALTER TABLE "platform_fee" ADD CONSTRAINT "platform_fee_currency_id_currency_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currency"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_fee" ADD CONSTRAINT "platform_fee_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_fee" ADD CONSTRAINT "platform_fee_updated_by_admin_id_admins_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_fee_audit" ADD CONSTRAINT "platform_fee_audit_platform_fee_id_platform_fee_id_fk" FOREIGN KEY ("platform_fee_id") REFERENCES "public"."platform_fee"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_fee_audit" ADD CONSTRAINT "platform_fee_audit_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_fee_currency_context_unique" ON "platform_fee" USING btree ("currency_id","context");--> statement-breakpoint
CREATE INDEX "platform_fee_context_enabled_idx" ON "platform_fee" USING btree ("context","enabled");--> statement-breakpoint
CREATE INDEX "platform_fee_audit_rule_created_idx" ON "platform_fee_audit" USING btree ("platform_fee_id","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "platform_fee_audit_admin_created_idx" ON "platform_fee_audit" USING btree ("admin_id","created_at" desc,"id" desc);--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_platform_fee_id_platform_fee_id_fk" FOREIGN KEY ("platform_fee_id") REFERENCES "public"."platform_fee"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_platform_fee_id_platform_fee_id_fk" FOREIGN KEY ("platform_fee_id") REFERENCES "public"."platform_fee"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_gross_to_amount_nonnegative" CHECK ("swaps"."gross_to_amount" >= 0);--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_platform_fee_amount_nonnegative" CHECK ("swaps"."platform_fee_amount" >= 0);--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_to_amount_nonnegative" CHECK ("swaps"."to_amount" >= 0);--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_platform_fee_snapshot_complete" CHECK (
    ("swaps"."platform_fee_id" IS NULL AND "swaps"."platform_fee_type" IS NULL
      AND "swaps"."platform_fee_configured_amount" IS NULL AND "swaps"."platform_fee_minimum_fee" IS NULL
      AND "swaps"."platform_fee_maximum_fee" IS NULL) OR
    ("swaps"."platform_fee_id" IS NOT NULL AND "swaps"."platform_fee_type" IS NOT NULL
      AND "swaps"."platform_fee_configured_amount" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_platform_fee_snapshot_nonnegative" CHECK (
    ("swaps"."platform_fee_configured_amount" IS NULL OR "swaps"."platform_fee_configured_amount" >= 0) AND
    ("swaps"."platform_fee_minimum_fee" IS NULL OR "swaps"."platform_fee_minimum_fee" >= 0) AND
    ("swaps"."platform_fee_maximum_fee" IS NULL OR "swaps"."platform_fee_maximum_fee" >= 0) AND
    ("swaps"."platform_fee_minimum_fee" IS NULL OR "swaps"."platform_fee_maximum_fee" IS NULL
      OR "swaps"."platform_fee_minimum_fee" <= "swaps"."platform_fee_maximum_fee")
  );--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_platform_fee_snapshot_caps_match_type" CHECK (
    "swaps"."platform_fee_type" IS NULL OR "swaps"."platform_fee_type" = 'percentage'
      OR ("swaps"."platform_fee_minimum_fee" IS NULL AND "swaps"."platform_fee_maximum_fee" IS NULL)
  );--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_platform_fee_snapshot_complete" CHECK (
    ("withdrawals"."platform_fee_id" IS NULL AND "withdrawals"."platform_fee_type" IS NULL
      AND "withdrawals"."platform_fee_configured_amount" IS NULL AND "withdrawals"."platform_fee_minimum_fee" IS NULL
      AND "withdrawals"."platform_fee_maximum_fee" IS NULL) OR
    ("withdrawals"."platform_fee_id" IS NOT NULL AND "withdrawals"."platform_fee_type" IS NOT NULL
      AND "withdrawals"."platform_fee_configured_amount" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_platform_fee_snapshot_nonnegative" CHECK (
    ("withdrawals"."platform_fee_configured_amount" IS NULL OR "withdrawals"."platform_fee_configured_amount" >= 0) AND
    ("withdrawals"."platform_fee_minimum_fee" IS NULL OR "withdrawals"."platform_fee_minimum_fee" >= 0) AND
    ("withdrawals"."platform_fee_maximum_fee" IS NULL OR "withdrawals"."platform_fee_maximum_fee" >= 0) AND
    ("withdrawals"."platform_fee_minimum_fee" IS NULL OR "withdrawals"."platform_fee_maximum_fee" IS NULL
      OR "withdrawals"."platform_fee_minimum_fee" <= "withdrawals"."platform_fee_maximum_fee")
  );--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_platform_fee_snapshot_caps_match_type" CHECK (
    "withdrawals"."platform_fee_type" IS NULL OR "withdrawals"."platform_fee_type" = 'percentage'
      OR ("withdrawals"."platform_fee_minimum_fee" IS NULL AND "withdrawals"."platform_fee_maximum_fee" IS NULL)
  );
