CREATE TABLE `interests` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`email` text NOT NULL,
	`locale` text NOT NULL,
	`created_at` integer NOT NULL,
	`emailed_at` integer,
	`unsubscribed_at` integer,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interests_activity_email` ON `interests` (`activity_id`,`email`);--> statement-breakpoint
CREATE INDEX `interests_unsent` ON `interests` (`emailed_at`,`unsubscribed_at`);