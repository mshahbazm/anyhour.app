CREATE TABLE "embedding_checkpoint" (
	"run_id" text NOT NULL,
	"source_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"vectors" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_checkpoint_run_id_source_id_input_hash_pk" PRIMARY KEY("run_id","source_id","input_hash")
);
--> statement-breakpoint
ALTER TABLE "embedding_checkpoint" ADD CONSTRAINT "embedding_checkpoint_run_id_index_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."index_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedding_checkpoint" ADD CONSTRAINT "embedding_checkpoint_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embedding_checkpoint_source_idx" ON "embedding_checkpoint" USING btree ("source_id");