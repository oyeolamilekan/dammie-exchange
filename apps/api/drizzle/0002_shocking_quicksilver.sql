CREATE TYPE "public"."ledger_account_class" AS ENUM('customer_wallet_available', 'customer_wallet_locked', 'customer_ngn_payable', 'user_quidax_custody_asset', 'platform_quidax_custody_asset', 'fee_revenue', 'provider_fee_expense', 'opening_balance_offset');--> statement-breakpoint
CREATE TYPE "public"."ledger_event_type" AS ENUM('opening_balance', 'deposit_credit', 'swap_lock', 'swap_unlock', 'swap_execution', 'swap_execution_reversal', 'fiat_sweep', 'fiat_withdrawal');--> statement-breakpoint
CREATE TYPE "public"."ledger_side" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"currency" varchar(16) NOT NULL,
	"account_class" "ledger_account_class" NOT NULL,
	"normal_side" "ledger_side" NOT NULL,
	"user_id" uuid,
	"wallet_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"side" "ledger_side" NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" varchar(300) NOT NULL,
	"event_type" "ledger_event_type" NOT NULL,
	"user_id" uuid,
	"wallet_id" uuid,
	"deposit_id" uuid,
	"swap_id" uuid,
	"provider_event_id" uuid,
	"reversal_of_journal_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" varchar(500) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "swaps" ADD COLUMN "executed_received_amount" numeric(36, 18);--> statement-breakpoint
ALTER TABLE "swaps" ADD COLUMN "execution_price" numeric(36, 18);--> statement-breakpoint
ALTER TABLE "swaps" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_ledger_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_swap_id_swaps_id_fk" FOREIGN KEY ("swap_id") REFERENCES "public"."swaps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_provider_event_id_provider_events_id_fk" FOREIGN KEY ("provider_event_id") REFERENCES "public"."provider_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_reversal_of_journal_id_ledger_journals_id_fk" FOREIGN KEY ("reversal_of_journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_accounts_currency_class_idx" ON "ledger_accounts" USING btree ("currency","account_class");--> statement-breakpoint
CREATE INDEX "ledger_accounts_user_currency_idx" ON "ledger_accounts" USING btree ("user_id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_owned_identity_unique" ON "ledger_accounts" USING btree ("currency","account_class","user_id","wallet_id") WHERE "ledger_accounts"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_platform_identity_unique" ON "ledger_accounts" USING btree ("currency","account_class") WHERE "ledger_accounts"."user_id" IS NULL AND "ledger_accounts"."wallet_id" IS NULL;--> statement-breakpoint
CREATE INDEX "ledger_entries_journal_idx" ON "ledger_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_journals_idempotency_key_unique" ON "ledger_journals" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_journals_user_activity_idx" ON "ledger_journals" USING btree ("user_id","occurred_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "ledger_journals_event_activity_idx" ON "ledger_journals" USING btree ("event_type","occurred_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "ledger_journals_deposit_idx" ON "ledger_journals" USING btree ("deposit_id");--> statement-breakpoint
CREATE INDEX "ledger_journals_swap_idx" ON "ledger_journals" USING btree ("swap_id");--> statement-breakpoint
CREATE INDEX "ledger_journals_provider_event_idx" ON "ledger_journals" USING btree ("provider_event_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_assert_journal_valid(p_journal_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  j ledger_journals%ROWTYPE;
  entry_count integer;
  d deposits%ROWTYPE;
  s swaps%ROWTYPE;
BEGIN
  SELECT * INTO j FROM ledger_journals WHERE id = p_journal_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO entry_count FROM ledger_entries WHERE journal_id = p_journal_id;
  IF entry_count < 2 THEN
    RAISE EXCEPTION 'Ledger journal % must contain at least two entries', p_journal_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT a.currency,
        coalesce(sum(e.amount) FILTER (WHERE e.side = 'debit'), 0) AS debits,
        coalesce(sum(e.amount) FILTER (WHERE e.side = 'credit'), 0) AS credits
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE e.journal_id = p_journal_id
      GROUP BY a.currency
    ) totals WHERE totals.debits <> totals.credits
  ) THEN
    RAISE EXCEPTION 'Ledger journal % is not balanced by currency', p_journal_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
    LEFT JOIN wallets w ON w.id = a.wallet_id
    WHERE e.journal_id = p_journal_id AND (
      (a.account_class IN ('customer_wallet_available', 'customer_wallet_locked')
        AND (a.user_id IS NULL OR a.wallet_id IS NULL OR w.id IS NULL
          OR w.user_id <> a.user_id OR lower(w.currency) <> lower(a.currency)))
      OR (a.account_class = 'customer_ngn_payable'
        AND (a.user_id IS NULL OR a.wallet_id IS NOT NULL OR lower(a.currency) <> 'ngn'))
      OR (a.account_class = 'user_quidax_custody_asset'
        AND (a.user_id IS NULL OR a.wallet_id IS NOT NULL))
      OR (a.account_class IN ('platform_quidax_custody_asset', 'fee_revenue', 'provider_fee_expense', 'opening_balance_offset')
        AND (a.user_id IS NOT NULL OR a.wallet_id IS NOT NULL))
      OR (a.normal_side <> CASE a.account_class
        WHEN 'customer_wallet_available' THEN 'credit'::ledger_side
        WHEN 'customer_wallet_locked' THEN 'credit'::ledger_side
        WHEN 'customer_ngn_payable' THEN 'credit'::ledger_side
        WHEN 'user_quidax_custody_asset' THEN 'debit'::ledger_side
        WHEN 'platform_quidax_custody_asset' THEN 'debit'::ledger_side
        WHEN 'fee_revenue' THEN 'credit'::ledger_side
        WHEN 'provider_fee_expense' THEN 'debit'::ledger_side
        WHEN 'opening_balance_offset' THEN 'debit'::ledger_side
      END)
    )
  ) THEN
    RAISE EXCEPTION 'Ledger journal % contains an invalid account relationship', p_journal_id;
  END IF;

  IF j.user_id IS NOT NULL AND j.wallet_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM wallets w WHERE w.id = j.wallet_id AND w.user_id = j.user_id
  ) THEN
    RAISE EXCEPTION 'Ledger journal % has an invalid user/wallet relationship', p_journal_id;
  END IF;

  IF j.event_type = 'opening_balance' THEN
    IF j.user_id IS NULL OR j.wallet_id IS NULL OR j.deposit_id IS NOT NULL OR j.swap_id IS NOT NULL THEN
      RAISE EXCEPTION 'Opening journal % has invalid source references', p_journal_id;
    END IF;
  ELSIF j.event_type = 'deposit_credit' THEN
    IF j.user_id IS NULL OR j.deposit_id IS NULL OR j.swap_id IS NOT NULL THEN
      RAISE EXCEPTION 'Deposit journal % has invalid source references', p_journal_id;
    END IF;
    SELECT * INTO d FROM deposits WHERE id = j.deposit_id;
    IF NOT FOUND OR d.user_id <> j.user_id OR NOT EXISTS (
      SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
      WHERE e.journal_id = p_journal_id AND a.account_class = 'customer_wallet_available'
        AND a.user_id = d.user_id AND a.wallet_id = d.wallet_id AND lower(a.currency) = lower(d.currency)
    ) OR NOT EXISTS (
      SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
      WHERE e.journal_id = p_journal_id AND a.account_class = 'user_quidax_custody_asset'
        AND a.user_id = d.user_id AND lower(a.currency) = lower(d.currency)
    ) THEN
      RAISE EXCEPTION 'Deposit journal % has invalid deposit/account relationships', p_journal_id;
    END IF;
  ELSIF j.event_type IN ('swap_lock', 'swap_unlock', 'swap_execution', 'swap_execution_reversal', 'fiat_sweep', 'fiat_withdrawal') THEN
    IF j.user_id IS NULL OR j.swap_id IS NULL THEN
      RAISE EXCEPTION 'Swap journal % has invalid source references', p_journal_id;
    END IF;
    SELECT * INTO s FROM swaps WHERE id = j.swap_id;
    IF NOT FOUND OR s.user_id <> j.user_id THEN
      RAISE EXCEPTION 'Swap journal % has an invalid swap/user relationship', p_journal_id;
    END IF;
    IF j.event_type = 'swap_lock' AND (
      NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND e.side = 'debit' AND a.account_class = 'customer_wallet_available' AND a.user_id = j.user_id AND lower(a.currency) = lower(s.from_currency))
      OR NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND e.side = 'credit' AND a.account_class = 'customer_wallet_locked' AND a.user_id = j.user_id AND lower(a.currency) = lower(s.from_currency))
    ) THEN RAISE EXCEPTION 'Swap lock journal % has invalid accounts', p_journal_id;
    ELSIF j.event_type = 'swap_unlock' AND (
      NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND e.side = 'debit' AND a.account_class = 'customer_wallet_locked' AND a.user_id = j.user_id AND lower(a.currency) = lower(s.from_currency))
      OR NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND e.side = 'credit' AND a.account_class = 'customer_wallet_available' AND a.user_id = j.user_id AND lower(a.currency) = lower(s.from_currency))
    ) THEN RAISE EXCEPTION 'Swap unlock journal % has invalid accounts', p_journal_id;
    ELSIF j.event_type = 'swap_execution' AND (
      NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND a.account_class = 'customer_wallet_locked' AND a.user_id = j.user_id AND lower(a.currency) = lower(s.from_currency))
      OR NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND a.account_class = 'user_quidax_custody_asset' AND a.user_id = j.user_id AND lower(a.currency) = lower(s.from_currency))
      OR NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND a.account_class = 'customer_ngn_payable' AND a.user_id = j.user_id AND lower(a.currency) = 'ngn')
      OR NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND a.account_class = 'fee_revenue' AND lower(a.currency) = 'ngn')
    ) THEN RAISE EXCEPTION 'Swap execution journal % has invalid accounts', p_journal_id;
    ELSIF j.event_type = 'swap_execution_reversal' THEN
      IF j.reversal_of_journal_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM ledger_journals r WHERE r.id = j.reversal_of_journal_id
          AND r.event_type = 'swap_execution' AND r.swap_id = j.swap_id AND r.user_id = j.user_id
      ) THEN RAISE EXCEPTION 'Swap reversal journal % has an invalid reversal source', p_journal_id; END IF;
    ELSIF j.event_type = 'fiat_sweep' AND (
      NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND a.account_class = 'platform_quidax_custody_asset' AND a.currency = 'ngn')
      OR NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND a.account_class = 'user_quidax_custody_asset' AND a.user_id = j.user_id AND a.currency = 'ngn')
    ) THEN RAISE EXCEPTION 'Fiat sweep journal % has invalid accounts', p_journal_id;
    ELSIF j.event_type = 'fiat_withdrawal' AND (
      NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND a.side = 'debit' AND a.account_class = 'customer_ngn_payable' AND a.user_id = j.user_id)
      OR NOT EXISTS (SELECT 1 FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.journal_id = p_journal_id AND a.side = 'credit' AND a.account_class = 'platform_quidax_custody_asset' AND a.currency = 'ngn')
    ) THEN RAISE EXCEPTION 'Fiat withdrawal journal % has invalid accounts', p_journal_id;
    END IF;
  END IF;

  IF j.reversal_of_journal_id IS NOT NULL AND j.event_type <> 'swap_execution_reversal' THEN
    RAISE EXCEPTION 'Only execution reversal journals may reference a prior journal';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_validate_journal_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM ledger_assert_journal_valid(NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_validate_entry_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM ledger_assert_journal_valid(NEW.journal_id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_journals_balanced_trigger
AFTER INSERT ON ledger_journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_validate_journal_trigger();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced_trigger
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_validate_entry_trigger();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Ledger journals and entries are immutable; post a reversing journal';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_journals_immutable_trigger
BEFORE UPDATE OR DELETE ON ledger_journals
FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_immutable_trigger
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
