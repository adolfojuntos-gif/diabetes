CREATE TABLE `carb_guesses` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`round_key` text NOT NULL,
	`food_id` text,
	`food_name` text NOT NULL,
	`portion_label` text NOT NULL,
	`grams` real NOT NULL,
	`reference_carbs_g` real NOT NULL,
	`guess_g` real NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`engine_version` text DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carb_guess_round_uq` ON `carb_guesses` (`round_key`);--> statement-breakpoint
CREATE INDEX `carb_guess_at_idx` ON `carb_guesses` (`at`);