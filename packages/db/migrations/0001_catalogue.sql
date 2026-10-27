CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`url` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`alt_en` text NOT NULL,
	`alt_ms` text NOT NULL,
	`credit_name` text NOT NULL,
	`credit_url` text NOT NULL,
	`source_url` text NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `photos_activity_position` ON `photos` (`activity_id`,`position`);--> statement-breakpoint
CREATE TABLE `proj_add_ons` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ms` text NOT NULL,
	`price_sen` integer NOT NULL,
	`active` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proj_add_ons_activity` ON `proj_add_ons` (`activity_id`);--> statement-breakpoint
ALTER TABLE `activities` ADD `published` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `activities` ADD `street_address` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `postal_code` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `lat` real;--> statement-breakpoint
ALTER TABLE `activities` ADD `lng` real;--> statement-breakpoint
ALTER TABLE `activities` ADD `opening_hours` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `activities` ADD `hours_note_en` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `hours_note_ms` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `highlights_en` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `activities` ADD `highlights_ms` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `activities` ADD `faq_en` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `activities` ADD `faq_ms` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `intro_en` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `intro_ms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `photo_id` text;--> statement-breakpoint
ALTER TABLE `cities` ADD `intro_en` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `cities` ADD `intro_ms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `cities` ADD `photo_id` text;--> statement-breakpoint
ALTER TABLE `proj_options` ADD `min_participants` integer;