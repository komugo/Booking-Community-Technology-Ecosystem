CREATE TABLE `public_holidays` (
	`date` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `operators` ADD `holidays_as_weekend` integer DEFAULT false NOT NULL;