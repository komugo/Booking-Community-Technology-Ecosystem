CREATE TABLE `operator_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`role` text NOT NULL,
	`locale` text DEFAULT 'ms' NOT NULL,
	`email` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operator_id`) REFERENCES `operators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operator_contacts_phone` ON `operator_contacts` (`operator_id`,`phone`);--> statement-breakpoint
CREATE TABLE `whatsapp_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`phone` text NOT NULL,
	`template` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operator_id`) REFERENCES `operators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `whatsapp_messages_contact` ON `whatsapp_messages` (`contact_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `whatsapp_messages_status` ON `whatsapp_messages` (`status`,`created_at`);