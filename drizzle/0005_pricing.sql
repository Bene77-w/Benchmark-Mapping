CREATE TABLE "model_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"valid_from" date NOT NULL,
	"input" double precision NOT NULL,
	"cache_read" double precision,
	"cache_write" double precision,
	"output" double precision NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_prices_model_id_valid_from_unique" UNIQUE("model_id","valid_from")
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_search_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"harness" text NOT NULL,
	"valid_from" date NOT NULL,
	"per_search" double precision NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_search_prices_harness_valid_from_unique" UNIQUE("harness","valid_from")
);
--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;