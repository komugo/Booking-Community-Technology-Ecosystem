ALTER TABLE `venues` ADD `slug_en` text;--> statement-breakpoint
ALTER TABLE `venues` ADD `slug_ms` text;--> statement-breakpoint
CREATE UNIQUE INDEX `venues_city_slug_en` ON `venues` (`city_id`,`slug_en`);--> statement-breakpoint
CREATE UNIQUE INDEX `venues_city_slug_ms` ON `venues` (`city_id`,`slug_ms`);