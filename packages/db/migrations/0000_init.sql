CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`city_id` text NOT NULL,
	`category_id` text NOT NULL,
	`slug_en` text NOT NULL,
	`slug_ms` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ms` text NOT NULL,
	`description_en` text NOT NULL,
	`description_ms` text NOT NULL,
	FOREIGN KEY (`operator_id`) REFERENCES `operators`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activities_slugEn_unique` ON `activities` (`slug_en`);--> statement-breakpoint
CREATE UNIQUE INDEX `activities_slugMs_unique` ON `activities` (`slug_ms`);--> statement-breakpoint
CREATE INDEX `activities_city_category` ON `activities` (`city_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `activities_operator` ON `activities` (`operator_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug_en` text NOT NULL,
	`slug_ms` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ms` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slugEn_unique` ON `categories` (`slug_en`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slugMs_unique` ON `categories` (`slug_ms`);--> statement-breakpoint
CREATE TABLE `cities` (
	`id` text PRIMARY KEY NOT NULL,
	`slug_en` text NOT NULL,
	`slug_ms` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ms` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cities_slugEn_unique` ON `cities` (`slug_en`);--> statement-breakpoint
CREATE UNIQUE INDEX `cities_slugMs_unique` ON `cities` (`slug_ms`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	CONSTRAINT "customers_contact" CHECK("customers"."email" is not null or "customers"."phone" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_phone_unique` ON `customers` (`phone`);--> statement-breakpoint
CREATE TABLE `operators` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`birth_date` text NOT NULL,
	`weight_kg` integer,
	`certs` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "participants_birth_date" CHECK("participants"."birth_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "participants_weight_kg" CHECK("participants"."weight_kg" > 0)
);
--> statement-breakpoint
CREATE INDEX `participants_customer` ON `participants` (`customer_id`);--> statement-breakpoint
CREATE TABLE `proj_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`free_cancel_hours` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proj_options` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ms` text NOT NULL,
	`price_sen` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`min_age` integer,
	`max_age` integer,
	`max_weight_kg` integer,
	`required_cert` text,
	`active` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proj_options_activity` ON `proj_options` (`activity_id`);--> statement-breakpoint
CREATE TABLE `proj_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`sessions_total` integer NOT NULL,
	`sessions_used` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proj_packs_customer` ON `proj_packs` (`customer_id`);--> statement-breakpoint
CREATE TABLE `proj_payments` (
	`bill_id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`hold_id` text NOT NULL,
	`booking_id` text,
	`amount_sen` integer NOT NULL,
	`status` text NOT NULL,
	`refund_reason` text,
	`received_at` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proj_payments_operator` ON `proj_payments` (`operator_id`);--> statement-breakpoint
CREATE INDEX `proj_payments_status` ON `proj_payments` (`status`);--> statement-breakpoint
CREATE TABLE `proj_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`booking_id` text,
	`pack_id` text,
	`option_id` text NOT NULL,
	`timeslot_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`closed_at` integer,
	`price_sen` integer NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proj_tickets_customer_starts` ON `proj_tickets` (`customer_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `proj_tickets_operator_starts` ON `proj_tickets` (`operator_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `proj_timeslots` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`option_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`closed_at` integer,
	`spots` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proj_timeslots_option_starts` ON `proj_timeslots` (`option_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `proj_timeslots_starts` ON `proj_timeslots` (`starts_at`);--> statement-breakpoint
CREATE TABLE `waivers` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`operator_id` text NOT NULL,
	`signer_name` text NOT NULL,
	`signed_at` integer NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operator_id`) REFERENCES `operators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waivers_participant_operator` ON `waivers` (`participant_id`,`operator_id`);