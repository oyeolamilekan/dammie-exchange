ALTER TABLE "account_versions" ADD COLUMN "amount" numeric(36, 18);--> statement-breakpoint
DROP TRIGGER "account_versions_immutable_trigger" ON "account_versions";--> statement-breakpoint
UPDATE "account_versions" av
SET "amount" = d."amount"
FROM "deposits" d
WHERE av."transaction_type" = 'deposit' AND av."transaction_id" = d."id";--> statement-breakpoint
UPDATE "account_versions" av
SET "amount" = w."amount" + w."fee"
FROM "withdrawals" w
WHERE av."transaction_type" = 'withdrawal' AND av."transaction_id" = w."id";--> statement-breakpoint
UPDATE "account_versions" av
SET "amount" = CASE
  WHEN av."action" = 'swap_credit' THEN s."to_amount"
  ELSE s."from_amount"
END
FROM "swaps" s
WHERE av."transaction_type" = 'swap' AND av."transaction_id" = s."id";--> statement-breakpoint
ALTER TABLE "account_versions" ALTER COLUMN "amount" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "account_versions" ADD CONSTRAINT "account_versions_amount_nonnegative" CHECK ("account_versions"."amount" >= 0);--> statement-breakpoint
CREATE TRIGGER "account_versions_immutable_trigger"
BEFORE UPDATE OR DELETE ON "account_versions"
FOR EACH ROW EXECUTE FUNCTION account_versions_reject_mutation();
