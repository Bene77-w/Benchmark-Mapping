CREATE TABLE "evaluations" (
	"run_id" integer NOT NULL,
	"gold_version" text NOT NULL,
	"gold_hash" text NOT NULL,
	"scoring_version" text NOT NULL,
	"complete" boolean NOT NULL,
	"score" double precision,
	"interval_low" double precision,
	"interval_high" double precision,
	"format_errors" integer NOT NULL,
	"violation_count" integer NOT NULL,
	"evidence_fidelity" double precision,
	"result" jsonb NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_run_id_gold_version_pk" PRIMARY KEY("run_id","gold_version")
);
--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;