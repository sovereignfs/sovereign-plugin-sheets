ALTER TABLE "sheets" ADD COLUMN "frozen_rows" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sheets" ADD COLUMN "frozen_cols" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sheets" ADD COLUMN "revision" text DEFAULT '' NOT NULL;