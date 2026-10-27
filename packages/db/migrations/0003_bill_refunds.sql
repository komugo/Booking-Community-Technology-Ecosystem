ALTER TABLE `bills` ADD `paid_amount_sen` integer;--> statement-breakpoint
ALTER TABLE `bills` ADD `refund_reason` text;--> statement-breakpoint
ALTER TABLE `bills` ADD `emailed_at` integer;--> statement-breakpoint
ALTER TABLE `otps` ADD `checkout_id` text;