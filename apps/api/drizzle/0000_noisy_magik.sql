CREATE TYPE "public"."deposit_status" AS ENUM('pending', 'failed', 'success');--> statement-breakpoint
CREATE TYPE "public"."provider_event_status" AS ENUM('received', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'processing', 'success');--> statement-breakpoint
CREATE TYPE "public"."recovery_event" AS ENUM('failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."swap_status" AS ENUM('pending', 'failed', 'success', 'processing');--> statement-breakpoint
CREATE TABLE "banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_number" varchar(32) NOT NULL,
	"account_name" varchar(250) NOT NULL,
	"bank_code" varchar(32) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"deposit_id" varchar(250) NOT NULL,
	"currency" varchar(16) NOT NULL,
	"txid" varchar(500) NOT NULL,
	"status" "deposit_status" DEFAULT 'pending' NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_amount_positive" CHECK ("deposits"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" varchar(15) NOT NULL,
	"chat_id" varchar(250) NOT NULL,
	"complete_signup_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"event_type" varchar(250) NOT NULL,
	"resource_id" varchar(250) NOT NULL,
	"correlation_id" varchar(600) NOT NULL,
	"status" "provider_event_status" DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(500),
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"quotation_id" varchar(250) NOT NULL,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL,
	"swap_transaction_id" varchar(250),
	"sweep_id" varchar(250),
	"sweep_reference" varchar(250),
	"from_currency" varchar(16) NOT NULL,
	"quoted_price" numeric(36, 18) NOT NULL,
	"to_currency" varchar(16) NOT NULL,
	"from_amount" numeric(36, 18) NOT NULL,
	"status" "swap_status" DEFAULT 'pending' NOT NULL,
	"withdraw_id" varchar(250),
	"withdraw_amount" numeric(36, 18),
	"swap_status" "swap_status" DEFAULT 'pending' NOT NULL,
	"sweep_status" "swap_status" DEFAULT 'pending' NOT NULL,
	"withdraw_reference" varchar(250),
	"recovery_event" "recovery_event",
	"reconciliation_required" boolean DEFAULT false NOT NULL,
	"to_amount" numeric(36, 18) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swaps_from_amount_positive" CHECK ("swaps"."from_amount" > 0),
	CONSTRAINT "swaps_to_amount_positive" CHECK ("swaps"."to_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(250) NOT NULL,
	"first_name" varchar(250) NOT NULL,
	"last_name" varchar(250) NOT NULL,
	"bvn_number" varchar(250) NOT NULL,
	"hashed_pin" varchar(250) NOT NULL,
	"telegram_id" varchar(32) NOT NULL,
	"sub_user_id" varchar(250) NOT NULL,
	"intent_id" uuid NOT NULL,
	"chat_id" varchar(250) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"network" varchar(64) NOT NULL,
	"destination_tag" varchar(250),
	"address" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" varchar(250),
	"in_progress" boolean DEFAULT false NOT NULL,
	"currency" varchar(16) NOT NULL,
	"balance" numeric(36, 18) DEFAULT '0' NOT NULL,
	"locked_balance" numeric(36, 18) DEFAULT '0' NOT NULL,
	"is_crypto" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_balance_nonnegative" CHECK ("wallets"."balance" >= 0),
	CONSTRAINT "wallets_locked_balance_nonnegative" CHECK ("wallets"."locked_balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "banks" ADD CONSTRAINT "banks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "banks_code_account_unique" ON "banks" USING btree ("bank_code","account_number");--> statement-breakpoint
CREATE UNIQUE INDEX "banks_one_default_per_user" ON "banks" USING btree ("user_id") WHERE "banks"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_deposit_id_unique" ON "deposits" USING btree ("deposit_id");--> statement-breakpoint
CREATE INDEX "deposit_user_history" ON "deposits" USING btree ("user_id","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "deposit_user_currency_history" ON "deposits" USING btree ("user_id","currency","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "deposit_user_status_currency_summary" ON "deposits" USING btree ("user_id","status","currency","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "intents_complete_signup_id_unique" ON "intents" USING btree ("complete_signup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_correlation_id_unique" ON "provider_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_resource_unique" ON "provider_events" USING btree ("provider","event_type","resource_id");--> statement-breakpoint
CREATE INDEX "provider_events_status_updated_idx" ON "provider_events" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "swap_user_history" ON "swaps" USING btree ("user_id","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "swap_user_currency_history" ON "swaps" USING btree ("user_id","from_currency","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "swap_user_status_currency_summary" ON "swaps" USING btree ("user_id","status","from_currency","created_at" desc);--> statement-breakpoint
CREATE INDEX "swaps_transaction_id_idx" ON "swaps" USING btree ("swap_transaction_id");--> statement-breakpoint
CREATE INDEX "swaps_sweep_id_idx" ON "swaps" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX "swaps_withdraw_id_idx" ON "swaps" USING btree ("withdraw_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_unique" ON "users" USING btree ("telegram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_sub_user_id_unique" ON "users" USING btree ("sub_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_chat_id_unique" ON "users" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_intent_id_unique" ON "users" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_wallet_network_unique" ON "wallet_addresses" USING btree ("wallet_id","network");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_currency_unique" ON "wallets" USING btree ("user_id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_provider_id_unique" ON "wallets" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "wallets_user_currency_idx" ON "wallets" USING btree ("user_id","currency");