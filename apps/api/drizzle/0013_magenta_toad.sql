ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_bank_snapshot_complete" CHECK (
    ("withdrawals"."approved_at" IS NULL AND "withdrawals"."bank_id" IS NULL AND "withdrawals"."account_number" IS NULL
      AND "withdrawals"."account_name" IS NULL AND "withdrawals"."bank_code" IS NULL) OR
    ("withdrawals"."approved_at" IS NOT NULL AND "withdrawals"."bank_id" IS NOT NULL AND "withdrawals"."account_number" IS NOT NULL
      AND "withdrawals"."account_name" IS NOT NULL AND "withdrawals"."bank_code" IS NOT NULL)
  );