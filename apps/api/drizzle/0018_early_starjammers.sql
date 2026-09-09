DROP INDEX "banks_code_account_unique";--> statement-breakpoint
DROP INDEX "banks_one_default_per_user";--> statement-breakpoint
ALTER TABLE "banks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "banks_code_account_unique" ON "banks" USING btree ("bank_code","account_number") WHERE "banks"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "banks_one_default_per_user" ON "banks" USING btree ("user_id") WHERE "banks"."is_default" = true AND "banks"."deleted_at" IS NULL;