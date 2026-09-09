ALTER TABLE "account_versions" DROP CONSTRAINT "account_versions_action_type_check";--> statement-breakpoint
ALTER TYPE "public"."account_version_action" RENAME TO "account_version_action_old";--> statement-breakpoint
CREATE TYPE "public"."account_version_action" AS ENUM(
	'deposit_credit',
	'swap_lock',
	'swap_complete',
	'swap_credit',
	'swap_restore',
	'withdrawal_lock',
	'withdrawal_complete',
	'withdrawal_restore'
);--> statement-breakpoint
ALTER TABLE "account_versions" ALTER COLUMN "action" TYPE "public"."account_version_action"
	USING "action"::text::"public"."account_version_action";--> statement-breakpoint
DROP TYPE "public"."account_version_action_old";--> statement-breakpoint
DROP INDEX "swaps_withdraw_id_idx";--> statement-breakpoint
ALTER TABLE "swaps" DROP COLUMN "withdraw_id";--> statement-breakpoint
ALTER TABLE "swaps" DROP COLUMN "withdraw_amount";--> statement-breakpoint
ALTER TABLE "swaps" DROP COLUMN "sweep_status";--> statement-breakpoint
ALTER TABLE "swaps" DROP COLUMN "withdraw_reference";--> statement-breakpoint
ALTER TABLE "account_versions" ADD CONSTRAINT "account_versions_action_type_check" CHECK (
    ("account_versions"."transaction_type" = 'deposit' AND "account_versions"."action" = 'deposit_credit') OR
    ("account_versions"."transaction_type" = 'swap' AND "account_versions"."action" IN ('swap_lock', 'swap_complete', 'swap_credit', 'swap_restore')) OR
    ("account_versions"."transaction_type" = 'withdrawal' AND "account_versions"."action" IN ('withdrawal_lock', 'withdrawal_complete', 'withdrawal_restore'))
  );--> statement-breakpoint
INSERT INTO "currency" ("name", "code", "enabled")
VALUES ('Nigerian Naira', 'ngn', true)
ON CONFLICT ("code") DO UPDATE SET
	"name" = EXCLUDED."name",
	"enabled" = true,
	"updated_at" = now();--> statement-breakpoint
INSERT INTO "wallets" ("user_id", "currency_id", "is_crypto", "in_progress")
SELECT u."id", c."id", false, false
FROM "users" u
CROSS JOIN "currency" c
WHERE c."code" = 'ngn'
ON CONFLICT ("user_id", "currency_id") DO UPDATE SET
	"is_crypto" = false,
	"in_progress" = false,
	"updated_at" = now();
