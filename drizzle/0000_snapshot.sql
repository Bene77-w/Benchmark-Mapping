CREATE TABLE "industries" (
	"snapshot_id" integer NOT NULL,
	"industry_id" text NOT NULL,
	"industry_name" text NOT NULL,
	"sector_id" text NOT NULL,
	"sector_name" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "industries_snapshot_id_industry_id_pk" PRIMARY KEY("snapshot_id","industry_id")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"content_hash" text NOT NULL,
	"format" text NOT NULL,
	"source" jsonb NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshots_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "unit_cleanups" (
	"snapshot_id" integer NOT NULL,
	"position" integer NOT NULL,
	"unit_id" text NOT NULL,
	"kind" text NOT NULL,
	"before" text NOT NULL,
	"after" text NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "unit_cleanups_snapshot_id_position_pk" PRIMARY KEY("snapshot_id","position")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"snapshot_id" integer NOT NULL,
	"unit_id" text NOT NULL,
	"kind" text NOT NULL,
	"chamber" text NOT NULL,
	"committee_name" text NOT NULL,
	"unit_name" text NOT NULL,
	"parent_unit_id" text,
	"parent_committee_name" text,
	"parent_context_text" text,
	"input_basis" text NOT NULL,
	"jurisdiction_text" text,
	"source_path" text NOT NULL,
	"source_input_hash" text NOT NULL,
	CONSTRAINT "units_snapshot_id_unit_id_pk" PRIMARY KEY("snapshot_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "industries" ADD CONSTRAINT "industries_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_cleanups" ADD CONSTRAINT "unit_cleanups_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;