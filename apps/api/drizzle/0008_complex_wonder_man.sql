CREATE TABLE "currency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(250) NOT NULL,
	"code" varchar(16) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currency_code_normalized" CHECK ("currency"."code" = lower(btrim("currency"."code")))
);
--> statement-breakpoint
CREATE TABLE "network" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(250) NOT NULL,
	"code" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_code_normalized" CHECK ("network"."code" = lower(btrim("network"."code")))
);
--> statement-breakpoint
CREATE TABLE "currency_network" (
	"currency_id" uuid NOT NULL,
	"network_id" uuid NOT NULL,
	CONSTRAINT "currency_network_pkey" PRIMARY KEY("currency_id","network_id")
);
--> statement-breakpoint
ALTER TABLE "currency_network" ADD CONSTRAINT "currency_network_currency_id_currency_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currency"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "currency_network" ADD CONSTRAINT "currency_network_network_id_network_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."network"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "currency_network_network_idx" ON "currency_network" USING btree ("network_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "currency_code_unique" ON "currency" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX "network_code_unique" ON "network" USING btree ("code");
--> statement-breakpoint
INSERT INTO "currency" ("name", "code") VALUES
	('USD Coin', 'usdc'),
	('CNGN', 'cngn'),
	('Tether USD', 'usdt');
--> statement-breakpoint
INSERT INTO "network" ("name", "code") VALUES
	('Ethereum', 'erc20'),
	('BNB Smart Chain', 'bep20'),
	('Base', 'base'),
	('Celo', 'celo'),
	('Tron', 'trc20');
--> statement-breakpoint
INSERT INTO "currency_network" ("currency_id", "network_id")
SELECT c.id, n.id
FROM (VALUES
	('usdc', 'erc20'),
	('usdc', 'bep20'),
	('usdc', 'base'),
	('cngn', 'base'),
	('cngn', 'bep20'),
	('usdt', 'bep20'),
	('usdt', 'celo'),
	('usdt', 'erc20'),
	('usdt', 'trc20')
) AS seed(currency_code, network_code)
INNER JOIN "currency" c ON c.code = seed.currency_code
INNER JOIN "network" n ON n.code = seed.network_code;
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "currency_id" uuid;
--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD COLUMN "network_id" uuid;
--> statement-breakpoint
UPDATE "wallets" w
SET "currency_id" = c.id
FROM "currency" c
WHERE lower(btrim(w."currency")) = c.code;
--> statement-breakpoint
UPDATE "wallet_addresses" wa
SET "network_id" = n.id
FROM "network" n
WHERE lower(btrim(wa."network")) = n.code;
--> statement-breakpoint
DO $$
DECLARE
	unmapped text;
BEGIN
	SELECT string_agg(DISTINCT coalesce(w."currency", '<null>'), ', ' ORDER BY coalesce(w."currency", '<null>'))
	INTO unmapped
	FROM "wallets" w
	WHERE w."currency_id" IS NULL;
	IF unmapped IS NOT NULL THEN
		RAISE EXCEPTION 'Currency catalog migration aborted: unmapped wallet currency code(s): %', unmapped;
	END IF;

	SELECT string_agg(DISTINCT coalesce(wa."network", '<null>'), ', ' ORDER BY coalesce(wa."network", '<null>'))
	INTO unmapped
	FROM "wallet_addresses" wa
	WHERE wa."network_id" IS NULL;
	IF unmapped IS NOT NULL THEN
		RAISE EXCEPTION 'Currency catalog migration aborted: unmapped wallet network code(s): %', unmapped;
	END IF;

	IF EXISTS (
		SELECT 1 FROM "wallets"
		GROUP BY "user_id", "currency_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Currency catalog migration aborted: duplicate wallet user/currency identities exist';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "wallet_addresses"
		GROUP BY "wallet_id", "network_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Currency catalog migration aborted: duplicate wallet/network identities exist';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "wallet_addresses" wa
		INNER JOIN "wallets" w ON w.id = wa.wallet_id
		WHERE NOT EXISTS (
			SELECT 1
			FROM "currency_network" cn
			WHERE cn.currency_id = w.currency_id
			  AND cn.network_id = wa.network_id
		)
	) THEN
		RAISE EXCEPTION 'Currency catalog migration aborted: existing wallet address uses an invalid currency/network pair';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "wallet_addresses" ALTER COLUMN "network_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "currency_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_network_id_network_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."network"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currency_id_currency_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currency"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_wallet_network_id_unique" ON "wallet_addresses" USING btree ("wallet_id","network_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_currency_id_unique" ON "wallets" USING btree ("user_id","currency_id");
--> statement-breakpoint
CREATE INDEX "wallets_user_currency_id_idx" ON "wallets" USING btree ("user_id","currency_id");
--> statement-breakpoint
ALTER TABLE "wallet_addresses" DROP COLUMN "network";
--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "currency";
