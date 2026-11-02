CREATE TABLE `link_closures` (
	`timeslot_id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`contact_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operator_id`) REFERENCES `operators`(`id`) ON UPDATE no action ON DELETE no action
);
