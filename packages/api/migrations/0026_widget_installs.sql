CREATE TABLE "widget_install" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "widget_install" ADD CONSTRAINT "widget_install_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "widget_install_origin_unique" ON "widget_install" USING btree ("assistant_id","origin");--> statement-breakpoint
CREATE INDEX "widget_install_assistant_idx" ON "widget_install" USING btree ("assistant_id");