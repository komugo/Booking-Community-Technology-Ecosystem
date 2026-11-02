CREATE TABLE `payouts` (
	`operator_id` text NOT NULL,
	`month` text NOT NULL,
	`amount_sen` integer NOT NULL,
	`paid_at` integer NOT NULL,
	`paid_by` text NOT NULL,
	PRIMARY KEY(`operator_id`, `month`),
	FOREIGN KEY (`operator_id`) REFERENCES `operators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payouts_paid_at` ON `payouts` (`paid_at`);--> statement-breakpoint
ALTER TABLE `operators` ADD `commission_bps` integer;--> statement-breakpoint
ALTER TABLE `proj_packs` ADD `price_sen` integer;--> statement-breakpoint
ALTER TABLE `proj_packs` ADD `commission_bps` integer;--> statement-breakpoint
ALTER TABLE `proj_packs` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `proj_tickets` ADD `commission_bps` integer;