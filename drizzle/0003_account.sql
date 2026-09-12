CREATE TABLE `world_events` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`seen_at` integer,
	`engine_version` text DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `world_event_key_uq` ON `world_events` (`key`);--> statement-breakpoint
CREATE INDEX `world_event_at_idx` ON `world_events` (`at`);