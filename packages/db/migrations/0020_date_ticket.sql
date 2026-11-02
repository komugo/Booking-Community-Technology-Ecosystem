ALTER TABLE `proj_options` ADD `ticket_type` text DEFAULT 'timeslot' NOT NULL;--> statement-breakpoint
ALTER TABLE `proj_options` ADD `daily_limit` integer;--> statement-breakpoint
ALTER TABLE `proj_tickets` ADD `ends_at` integer;--> statement-breakpoint
ALTER TABLE `proj_timeslots` ADD `ends_at` integer;