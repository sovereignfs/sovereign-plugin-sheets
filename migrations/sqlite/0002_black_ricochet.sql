ALTER TABLE `workbook_members` ADD `last_opened_at` integer;--> statement-breakpoint
ALTER TABLE `workbooks` DROP COLUMN `last_opened_at`;