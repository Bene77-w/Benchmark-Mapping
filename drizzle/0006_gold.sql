CREATE TABLE "gold_industries" (
	"gold_version_id" integer NOT NULL,
	"unit_id" text NOT NULL,
	"industry_id" text NOT NULL,
	"class" text NOT NULL,
	"web_only" boolean DEFAULT false NOT NULL,
	CONSTRAINT "gold_industries_gold_version_id_unit_id_industry_id_pk" PRIMARY KEY("gold_version_id","unit_id","industry_id")
);
--> statement-breakpoint
CREATE TABLE "gold_proposal_runs" (
	"gold_version_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	CONSTRAINT "gold_proposal_runs_gold_version_id_run_id_pk" PRIMARY KEY("gold_version_id","run_id")
);
--> statement-breakpoint
CREATE TABLE "gold_units" (
	"gold_version_id" integer NOT NULL,
	"unit_id" text NOT NULL,
	"category" text NOT NULL,
	"no_mapping" boolean DEFAULT false NOT NULL,
	"note" text,
	CONSTRAINT "gold_units_gold_version_id_unit_id_pk" PRIMARY KEY("gold_version_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "gold_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"snapshot_id" integer NOT NULL,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_at" timestamp with time zone,
	CONSTRAINT "gold_versions_label_unique" UNIQUE("label")
);
--> statement-breakpoint
ALTER TABLE "gold_industries" ADD CONSTRAINT "gold_industries_gold_version_id_unit_id_gold_units_gold_version_id_unit_id_fk" FOREIGN KEY ("gold_version_id","unit_id") REFERENCES "public"."gold_units"("gold_version_id","unit_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_proposal_runs" ADD CONSTRAINT "gold_proposal_runs_gold_version_id_gold_versions_id_fk" FOREIGN KEY ("gold_version_id") REFERENCES "public"."gold_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_proposal_runs" ADD CONSTRAINT "gold_proposal_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_units" ADD CONSTRAINT "gold_units_gold_version_id_gold_versions_id_fk" FOREIGN KEY ("gold_version_id") REFERENCES "public"."gold_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_versions" ADD CONSTRAINT "gold_versions_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gold_versions_one_draft" ON "gold_versions" USING btree ("status") WHERE status = 'draft';