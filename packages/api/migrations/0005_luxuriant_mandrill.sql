CREATE TABLE "index_run_item" (
	"run_id" text NOT NULL,
	"source_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "index_run_item_run_id_source_id_pk" PRIMARY KEY("run_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "index_run_item" ADD CONSTRAINT "index_run_item_run_id_index_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."index_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_run_item" ADD CONSTRAINT "index_run_item_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;