CREATE TABLE "bank_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(250) NOT NULL,
	"country" varchar(100) NOT NULL,
	"currency" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bank_catalog_code_idx" ON "bank_catalog" USING btree ("code");--> statement-breakpoint
CREATE INDEX "bank_catalog_name_idx" ON "bank_catalog" USING btree ("name");
--> statement-breakpoint
