ALTER TABLE "withdrawals" ADD COLUMN "bank_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "fee" numeric(36, 18) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "provider_fee" numeric(36, 18);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "account_number" varchar(32);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "account_name" varchar(250);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "bank_code" varchar(32);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "failure_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_fee_nonnegative" CHECK ("withdrawals"."fee" >= 0);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_provider_fee_nonnegative" CHECK ("withdrawals"."provider_fee" IS NULL OR "withdrawals"."provider_fee" >= 0);