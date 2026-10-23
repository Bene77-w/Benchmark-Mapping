CREATE TABLE "configurations" (
	"id" serial PRIMARY KEY NOT NULL,
	"harness" text NOT NULL,
	"model" text NOT NULL,
	"effort" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configurations_harness_model_effort_mode_unique" UNIQUE("harness","model","effort","mode")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"configuration_id" integer NOT NULL,
	"kind" text DEFAULT 'benchmark' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"snapshot_id" integer NOT NULL,
	"snapshot_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"output_schema_version" text NOT NULL,
	"output_schema_hash" text NOT NULL,
	"parallelism" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unit_results" (
	"run_id" integer NOT NULL,
	"unit_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"unit_prompt_hash" text,
	"answer" jsonb,
	"error_kind" text,
	"error_message" text,
	"rate_limit_reset_at" timestamp with time zone,
	"raw_response" text,
	"log" text,
	"input_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"web_searches" integer,
	"effort_reported" text,
	"effort_confirmed" boolean,
	"native_cost_usd" double precision,
	"duration_ms" integer,
	"exit_code" integer,
	"cli_version" text,
	"model_reported" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "unit_results_run_id_unit_id_pk" PRIMARY KEY("run_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_configuration_id_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_results" ADD CONSTRAINT "unit_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;