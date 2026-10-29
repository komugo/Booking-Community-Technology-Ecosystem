CREATE TABLE `venues` (
	`id` text PRIMARY KEY NOT NULL,
	`city_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ms` text NOT NULL,
	`street_address` text,
	`postal_code` text,
	`presint` integer,
	`phone` text,
	`lat` real,
	`lng` real,
	`opening_hours` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "venues_presint" CHECK("venues"."presint" between 1 and 20)
);
--> statement-breakpoint
CREATE INDEX `venues_city` ON `venues` (`city_id`);--> statement-breakpoint
ALTER TABLE `activities` ADD `venue_id` text REFERENCES venues(id);--> statement-breakpoint
ALTER TABLE `activities` ADD `listing_mode` text DEFAULT 'hidden' NOT NULL;--> statement-breakpoint
ALTER TABLE `activities` ADD `how_to_book` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `activities` ADD `book_url` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `price_note_en` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `price_note_ms` text;--> statement-breakpoint
CREATE INDEX `activities_venue` ON `activities` (`venue_id`);--> statement-breakpoint
ALTER TABLE `operators` ADD `signed_up` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `photos` ADD `venue_id` text REFERENCES venues(id);--> statement-breakpoint
CREATE INDEX `photos_venue_position` ON `photos` (`venue_id`,`position`);--> statement-breakpoint
UPDATE `activities` SET `listing_mode` = 'bookable' WHERE `published` = 1;--> statement-breakpoint
UPDATE `operators` SET `signed_up` = 1 WHERE `id` IN (SELECT `operator_id` FROM `activities` WHERE `published` = 1);