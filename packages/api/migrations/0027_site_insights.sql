CREATE TABLE "site_stat_daily" (
	"assistant_id" text NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "site_stat_daily_assistant_id_day_metric_value_pk" PRIMARY KEY("assistant_id","day","metric","value")
);
--> statement-breakpoint
CREATE TABLE "site_visitor_daily" (
	"assistant_id" text NOT NULL,
	"day" date NOT NULL,
	"visitor_hash" text NOT NULL,
	CONSTRAINT "site_visitor_daily_assistant_id_day_visitor_hash_pk" PRIMARY KEY("assistant_id","day","visitor_hash")
);
--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "tracking" jsonb DEFAULT '{"visits":true,"location":true,"device":true,"chat":true}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "site_stat_daily" ADD CONSTRAINT "site_stat_daily_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visitor_daily" ADD CONSTRAINT "site_visitor_daily_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;