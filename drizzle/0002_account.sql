CREATE TABLE `discoveries` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`name` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`place` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `discovery_at_idx` ON `discoveries` (`at`);--> statement-breakpoint
CREATE TABLE `journey_awards` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`code` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`evidence` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`gems` integer DEFAULT 0 NOT NULL,
	`earned_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`seen_at` integer,
	`engine_version` text DEFAULT '0' NOT NULL,
	`rule_version` text DEFAULT '0' NOT NULL,
	`metric_version` text DEFAULT '0' NOT NULL,
	`sample_size` integer DEFAULT 0 NOT NULL,
	`window_from` integer,
	`window_to` integer,
	`compare_from` integer,
	`compare_to` integer,
	`data_quality` text DEFAULT 'high' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journey_award_key_uq` ON `journey_awards` (`key`);--> statement-breakpoint
CREATE INDEX `journey_award_earned_idx` ON `journey_awards` (`earned_at`);--> statement-breakpoint
CREATE TABLE `journey_quests` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`week_key` text NOT NULL,
	`code` text NOT NULL,
	`slot` integer DEFAULT 0 NOT NULL,
	`adventure` text NOT NULL,
	`title` text NOT NULL,
	`ask` text NOT NULL,
	`why` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`dimension` text NOT NULL,
	`completed_at` integer,
	`verified_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journey_quest_key_uq` ON `journey_quests` (`key`);--> statement-breakpoint
CREATE INDEX `journey_quest_week_idx` ON `journey_quests` (`week_key`);--> statement-breakpoint
CREATE TABLE `player_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`world_theme` text DEFAULT 'forest' NOT NULL,
	`region_seen_level` integer DEFAULT 0 NOT NULL,
	`morning_seen_date` text DEFAULT '' NOT NULL,
	`rest_until` integer,
	`last_visit_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
