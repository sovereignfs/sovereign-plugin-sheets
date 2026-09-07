ALTER TABLE `sheets` ADD `frozen_rows` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sheets` ADD `frozen_cols` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sheets` ADD `revision` text DEFAULT '' NOT NULL;