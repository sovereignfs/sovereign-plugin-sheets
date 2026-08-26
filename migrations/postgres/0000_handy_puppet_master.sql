CREATE TABLE "finance_rate_cache" (
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" text NOT NULL,
	"as_of" bigint NOT NULL,
	"fetched_at" bigint NOT NULL,
	"source" text DEFAULT 'frankfurter' NOT NULL,
	CONSTRAINT "finance_rate_cache_base_quote_pk" PRIMARY KEY("base","quote")
);
--> statement-breakpoint
CREATE TABLE "sheets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workbook_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"row_count" integer DEFAULT 200 NOT NULL,
	"col_count" integer DEFAULT 26 NOT NULL,
	"cells_json" text DEFAULT '{}' NOT NULL,
	"col_widths_json" text DEFAULT '{}' NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbook_members" (
	"workbook_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"joined_at" bigint NOT NULL,
	"last_opened_at" bigint,
	CONSTRAINT "workbook_members_workbook_id_user_id_pk" PRIMARY KEY("workbook_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workbooks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"active_sheet_id" text,
	"named_ranges_json" text DEFAULT '{}' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint
);
--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_workbook_id_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "workbooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbook_members" ADD CONSTRAINT "workbook_members_workbook_id_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "workbooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sheets_workbook_idx" ON "sheets" USING btree ("workbook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workbook_members_workbook_user_idx" ON "workbook_members" USING btree ("workbook_id","user_id");--> statement-breakpoint
CREATE INDEX "workbooks_tenant_owner_idx" ON "workbooks" USING btree ("tenant_id","owner_user_id");