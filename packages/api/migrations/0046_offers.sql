CREATE TABLE "offer" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_text" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_service" (
	"offer_id" text NOT NULL,
	"service_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "offer_service_offer_id_service_id_pk" PRIMARY KEY("offer_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "offer_id" text;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_service" ADD CONSTRAINT "offer_service_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_service" ADD CONSTRAINT "offer_service_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_org_position_idx" ON "offer" USING btree ("organization_id","position");--> statement-breakpoint
CREATE INDEX "offer_service_service_idx" ON "offer_service" USING btree ("service_id");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_offer_idx" ON "lead" USING btree ("offer_id");