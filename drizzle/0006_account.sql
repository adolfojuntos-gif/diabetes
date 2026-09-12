CREATE TABLE `knowledge_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_key` text NOT NULL,
	`learned_at` integer NOT NULL,
	`chose` integer DEFAULT 0 NOT NULL,
	`engine_version` text DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_lesson_uq` ON `knowledge_progress` (`lesson_key`);--> statement-breakpoint
CREATE INDEX `knowledge_learned_idx` ON `knowledge_progress` (`learned_at`);