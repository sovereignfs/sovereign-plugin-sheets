CREATE TABLE `workbook_members` (
	`workbook_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`workbook_id`, `user_id`),
	FOREIGN KEY (`workbook_id`) REFERENCES `workbooks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workbook_members_workbook_user_idx` ON `workbook_members` (`workbook_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `workbooks` ADD `last_opened_at` integer;--> statement-breakpoint
-- Hand-added (not drizzle-kit generated): backfill an `owner` membership row
-- for every workbook that predates workbook_members, keyed off the existing
-- owner_user_id column. Without this, every workbook created before this
-- migration would have zero rows in workbook_members and its own owner
-- would lose access under resolveWorkbookRole()'s membership check.
INSERT INTO `workbook_members` (`workbook_id`, `user_id`, `tenant_id`, `role`, `invited_by`, `joined_at`)
SELECT `id`, `owner_user_id`, `tenant_id`, 'owner', NULL, `created_at` FROM `workbooks`;