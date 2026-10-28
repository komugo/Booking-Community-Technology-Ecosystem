CREATE TABLE `closure_notices` (
	`timeslot_id` text NOT NULL,
	`ref` text NOT NULL,
	`customer_id` text NOT NULL,
	`booking_id` text,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`emailed_at` integer,
	PRIMARY KEY(`timeslot_id`, `ref`),
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `closure_notices_unsent` ON `closure_notices` (`emailed_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `member_sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`operator_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operator_id`) REFERENCES `operators`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "members_scope" CHECK(("members"."role" = 'staff') = ("members"."operator_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE INDEX `members_operator` ON `members` (`operator_id`);--> statement-breakpoint
ALTER TABLE `otps` ADD `ip` text;