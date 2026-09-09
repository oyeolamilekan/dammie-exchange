DROP FUNCTION IF EXISTS ledger_validate_entry_trigger() CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS ledger_validate_journal_trigger() CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS ledger_assert_journal_valid(uuid) CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS ledger_reject_mutation() CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS ledger_entries CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS ledger_journals CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS ledger_accounts CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS ledger_event_type CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS ledger_side CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS ledger_account_class CASCADE;--> statement-breakpoint
CREATE TYPE "public"."account_version_transaction_type" AS ENUM('deposit', 'swap', 'withdrawal');--> statement-breakpoint
CREATE TYPE "public"."account_version_action" AS ENUM('deposit_credit', 'swap_lock', 'swap_complete', 'swap_restore', 'withdrawal_lock', 'withdrawal_complete', 'withdrawal_restore');--> statement-breakpoint
CREATE TABLE "account_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"transaction_type" "account_version_transaction_type" NOT NULL,
	"transaction_id" uuid NOT NULL,
	"action" "account_version_action" NOT NULL,
	"previous_balance" numeric(36, 18) NOT NULL,
	"balance" numeric(36, 18) NOT NULL,
	"locked_balance" numeric(36, 18) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_versions_previous_balance_nonnegative" CHECK ("account_versions"."previous_balance" >= 0),
	CONSTRAINT "account_versions_balance_nonnegative" CHECK ("account_versions"."balance" >= 0),
	CONSTRAINT "account_versions_locked_balance_nonnegative" CHECK ("account_versions"."locked_balance" >= 0),
	CONSTRAINT "account_versions_action_type_check" CHECK (
		("account_versions"."transaction_type" = 'deposit' AND "account_versions"."action" = 'deposit_credit') OR
		("account_versions"."transaction_type" = 'swap' AND "account_versions"."action" IN ('swap_lock', 'swap_complete', 'swap_restore')) OR
		("account_versions"."transaction_type" = 'withdrawal' AND "account_versions"."action" IN ('withdrawal_lock', 'withdrawal_complete', 'withdrawal_restore'))
	)
);--> statement-breakpoint
ALTER TABLE "account_versions" ADD CONSTRAINT "account_versions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_versions_transaction_action_unique" ON "account_versions" USING btree ("transaction_type", "transaction_id", "action");--> statement-breakpoint
CREATE INDEX "account_versions_wallet_history_idx" ON "account_versions" USING btree ("wallet_id", "created_at" desc, "id" desc);--> statement-breakpoint
CREATE INDEX "account_versions_transaction_lookup_idx" ON "account_versions" USING btree ("transaction_type", "transaction_id");--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'processing', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"provider_withdrawal_id" varchar(250),
	"reference" varchar(250) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_amount_positive" CHECK ("withdrawals"."amount" > 0)
);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_reference_unique" ON "withdrawals" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_provider_id_unique" ON "withdrawals" USING btree ("provider_withdrawal_id");--> statement-breakpoint
CREATE INDEX "withdrawals_user_history_idx" ON "withdrawals" USING btree ("user_id", "created_at" desc, "id" desc);--> statement-breakpoint
CREATE INDEX "withdrawals_wallet_history_idx" ON "withdrawals" USING btree ("wallet_id", "created_at" desc, "id" desc);--> statement-breakpoint
CREATE OR REPLACE FUNCTION account_versions_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Account versions are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER account_versions_immutable_trigger
BEFORE UPDATE OR DELETE ON account_versions
FOR EACH ROW EXECUTE FUNCTION account_versions_reject_mutation();
