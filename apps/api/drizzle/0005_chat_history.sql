CREATE TYPE "public"."chat_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"role" "chat_message_role" NOT NULL,
	"content" text NOT NULL,
	"telegram_message_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_intent_history_idx" ON "chat_messages" USING btree ("intent_id","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "chat_messages_turn_idx" ON "chat_messages" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_telegram_inbound_unique" ON "chat_messages" USING btree ("intent_id","role","telegram_message_id");