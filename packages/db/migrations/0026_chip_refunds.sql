CREATE TABLE `refund_sends` (
	`refund_id` text PRIMARY KEY NOT NULL,
	`claimed_at` integer NOT NULL,
	`sent_at` integer,
	`error` text
);
