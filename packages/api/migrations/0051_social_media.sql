CREATE TABLE "social_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"assistant_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"name" text,
	"prompt" text,
	"parent_asset_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"assistant_id" text NOT NULL,
	"platforms" text[] NOT NULL,
	"text" text NOT NULL,
	"image_asset_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp,
	"posted_at" timestamp,
	"notified_at" timestamp,
	"source" text NOT NULL,
	"service_id" text,
	"offer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_asset" ADD CONSTRAINT "social_asset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_asset" ADD CONSTRAINT "social_asset_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_asset" ADD CONSTRAINT "social_asset_parent_asset_id_social_asset_id_fk" FOREIGN KEY ("parent_asset_id") REFERENCES "public"."social_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_image_asset_id_social_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "public"."social_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_asset_assistant_created_idx" ON "social_asset" USING btree ("assistant_id","created_at");--> statement-breakpoint
CREATE INDEX "social_post_assistant_scheduled_idx" ON "social_post" USING btree ("assistant_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "social_post_due_idx" ON "social_post" USING btree ("scheduled_for") WHERE "social_post"."status" = 'approved' and "social_post"."notified_at" is null;