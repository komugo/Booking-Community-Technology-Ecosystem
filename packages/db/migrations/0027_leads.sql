CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`package_id` text,
	`name` text NOT NULL,
	`company` text,
	`email` text NOT NULL,
	`whatsapp` text NOT NULL,
	`budget` text,
	`brief` text NOT NULL,
	`agency` text,
	`procurement` text,
	`timeline` text,
	`source_page` text NOT NULL,
	`locale` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "leads_kind" CHECK("leads"."kind" in ('quote', 'proposal')),
	CONSTRAINT "leads_status" CHECK("leads"."status" in ('new', 'contacted', 'won', 'lost'))
);
--> statement-breakpoint
CREATE INDEX `leads_created` ON `leads` (`created_at`);