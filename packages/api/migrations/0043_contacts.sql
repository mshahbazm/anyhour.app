CREATE TABLE "company" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_fact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"conversation_id" text,
	"created_by_member_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_contact" (
	"lead_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"role" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lead_contact_lead_id_contact_id_pk" PRIMARY KEY("lead_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_text" text,
	"duration_minutes" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_fact" ADD CONSTRAINT "contact_fact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_fact" ADD CONSTRAINT "contact_fact_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_fact" ADD CONSTRAINT "contact_fact_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_fact" ADD CONSTRAINT "contact_fact_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identity" ADD CONSTRAINT "contact_identity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identity" ADD CONSTRAINT "contact_identity_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_contact" ADD CONSTRAINT "lead_contact_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_contact" ADD CONSTRAINT "lead_contact_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_org_created_id_idx" ON "company" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_org_domain_unique" ON "company" USING btree ("organization_id","domain") WHERE "company"."domain" is not null;--> statement-breakpoint
CREATE INDEX "contact_fact_contact_created_idx" ON "contact_fact" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identity_org_kind_value_unique" ON "contact_identity" USING btree ("organization_id","kind","normalized_value");--> statement-breakpoint
CREATE INDEX "contact_identity_contact_idx" ON "contact_identity" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "lead_contact_contact_idx" ON "lead_contact" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "service_org_position_idx" ON "service" USING btree ("organization_id","position");--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_company_idx" ON "contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "lead_service_idx" ON "lead" USING btree ("service_id");