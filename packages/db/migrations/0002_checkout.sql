CREATE TABLE `bills` (
	`id` text PRIMARY KEY NOT NULL,
	`checkout_id` text NOT NULL,
	`hold_id` text NOT NULL,
	`amount_sen` integer NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bills_holdId_unique` ON `bills` (`hold_id`);--> statement-breakpoint
CREATE INDEX `bills_paid_created` ON `bills` (`paid_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `checkouts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`customer_id` text,
	`operator_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`option_id` text NOT NULL,
	`timeslot_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`add_ons` text DEFAULT '[]' NOT NULL,
	`draft` text,
	`participant_ids` text,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`locale` text NOT NULL,
	`hold_id` text,
	`hold_seq` integer DEFAULT 0 NOT NULL,
	`hold_expires_at` integer,
	`amount_sen` integer,
	`booking_id` text,
	`refund_reason` text,
	`emailed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkouts_bookingId_unique` ON `checkouts` (`booking_id`);--> statement-breakpoint
CREATE INDEX `checkouts_session` ON `checkouts` (`session_id`);--> statement-breakpoint
CREATE INDEX `checkouts_customer` ON `checkouts` (`customer_id`);--> statement-breakpoint
CREATE INDEX `checkouts_hold` ON `checkouts` (`hold_id`);--> statement-breakpoint
CREATE TABLE `otps` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `otps_email_created` ON `otps` (`email`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_customer` ON `sessions` (`customer_id`);--> statement-breakpoint
ALTER TABLE `customers` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `customers` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `proj_options` ADD `asks_weight` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `waivers` ADD `version` text;--> statement-breakpoint
ALTER TABLE `waivers` ADD `locale` text;--> statement-breakpoint
ALTER TABLE `waivers` ADD `guardian` integer DEFAULT 0 NOT NULL CHECK (`guardian` IN (0, 1));--> statement-breakpoint
ALTER TABLE `waivers` ADD `signer_customer_id` text;--> statement-breakpoint
ALTER TABLE `waivers` ADD `text_sha256` text;