CREATE TABLE `pack_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`operator_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`amount_sen` integer NOT NULL,
	`locale` text NOT NULL,
	`pack_id` text,
	`emailed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pack_orders_packId_unique` ON `pack_orders` (`pack_id`);--> statement-breakpoint
CREATE INDEX `pack_orders_customer_offer` ON `pack_orders` (`customer_id`,`offer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `proj_pack_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ms` text NOT NULL,
	`sessions` integer NOT NULL,
	`price_sen` integer NOT NULL,
	`valid_days` integer NOT NULL,
	`option_ids` text DEFAULT '[]' NOT NULL,
	`active` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proj_pack_offers_activity` ON `proj_pack_offers` (`activity_id`);--> statement-breakpoint
CREATE TABLE `proj_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`customer_id` text,
	`bill_id` text,
	`booking_id` text,
	`amount_sen` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`refunded_at` integer,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proj_refunds_refunded_created` ON `proj_refunds` (`refunded_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `proj_refunds_operator` ON `proj_refunds` (`operator_id`);--> statement-breakpoint
CREATE TABLE `refund_emails` (
	`refund_id` text NOT NULL,
	`kind` text NOT NULL,
	`emailed_at` integer NOT NULL,
	PRIMARY KEY(`refund_id`, `kind`)
);
--> statement-breakpoint
ALTER TABLE `bills` ADD `kind` text DEFAULT 'booking' NOT NULL;--> statement-breakpoint
ALTER TABLE `checkouts` ADD `pack_id` text;--> statement-breakpoint
ALTER TABLE `closure_notices` ADD `pack_id` text;--> statement-breakpoint
ALTER TABLE `closure_notices` ADD `choice` text;--> statement-breakpoint
ALTER TABLE `closure_notices` ADD `chosen_at` integer;--> statement-breakpoint
ALTER TABLE `proj_packs` ADD `offer_id` text;--> statement-breakpoint
ALTER TABLE `proj_packs` ADD `option_ids` text DEFAULT '[]' NOT NULL;