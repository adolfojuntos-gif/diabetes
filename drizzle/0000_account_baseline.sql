CREATE TABLE `ai_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`conversation_id` text,
	`message_id` text,
	`mode` text NOT NULL,
	`user_question` text NOT NULL,
	`data_accessed` text NOT NULL,
	`knowledge_used` text NOT NULL,
	`safety_rules` text NOT NULL,
	`triage_level` text NOT NULL,
	`feature` text DEFAULT 'copilot' NOT NULL,
	`responder` text NOT NULL,
	`model` text,
	`filtered` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `ai_audit` (`at`);--> statement-breakpoint
CREATE TABLE `app_secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`with_whom` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`brief` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `appt_at_idx` ON `appointments` (`at`);--> statement-breakpoint
CREATE TABLE `blood_pressure_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`systolic` integer NOT NULL,
	`diastolic` integer NOT NULL,
	`pulse` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bp_at_idx` ON `blood_pressure_logs` (`at`);--> statement-breakpoint
CREATE TABLE `caregiver_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`caregiver_id` text NOT NULL,
	`at` integer NOT NULL,
	`body` text NOT NULL,
	`about_date` text,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `cg_comment_at_idx` ON `caregiver_comments` (`at`);--> statement-breakpoint
CREATE TABLE `caregivers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`relationship` text DEFAULT '' NOT NULL,
	`token` text NOT NULL,
	`can_view` text DEFAULT '' NOT NULL,
	`can_comment` integer DEFAULT false NOT NULL,
	`alert_kinds` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `caregiver_token_uq` ON `caregivers` (`token`);--> statement-breakpoint
CREATE TABLE `coach_events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`route` text NOT NULL,
	`outcome` text NOT NULL,
	`detail` text,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `coach_event_at_idx` ON `coach_events` (`at`);--> statement-breakpoint
CREATE TABLE `coach_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`body` text NOT NULL,
	`facts` text NOT NULL,
	`triage_level` text NOT NULL,
	`responder` text NOT NULL,
	`model` text,
	`filtered` integer DEFAULT false NOT NULL,
	`conversation_id` text,
	`created_at` integer NOT NULL,
	`delivered_at` integer,
	`channel` text,
	`read_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coach_kind_date_uq` ON `coach_messages` (`kind`,`date`);--> statement-breakpoint
CREATE INDEX `coach_created_idx` ON `coach_messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'talk' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`state` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conv_updated_idx` ON `conversations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `doctor_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`evidence` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`pattern_key` text,
	`asked` integer DEFAULT false NOT NULL,
	`answer` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doctor_q_pattern_uq` ON `doctor_questions` (`pattern_key`);--> statement-breakpoint
CREATE TABLE `exercise_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`minutes` integer NOT NULL,
	`intensity` text NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`glucose_note` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exercise_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`minutes` integer NOT NULL,
	`intensity` text DEFAULT 'moderate' NOT NULL,
	`idea_id` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exercise_at_idx` ON `exercise_sessions` (`at`);--> statement-breakpoint
CREATE TABLE `food_portions` (
	`id` text PRIMARY KEY NOT NULL,
	`food_id` text NOT NULL,
	`label` text NOT NULL,
	`grams` real NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`custom` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `food_portions_food_idx` ON `food_portions` (`food_id`);--> statement-breakpoint
CREATE TABLE `foods` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`category` text DEFAULT 'other' NOT NULL,
	`carbs_g` real NOT NULL,
	`protein_g` real DEFAULT 0 NOT NULL,
	`fat_g` real DEFAULT 0 NOT NULL,
	`fiber_g` real DEFAULT 0 NOT NULL,
	`calories_kcal` real DEFAULT 0 NOT NULL,
	`aliases` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`aisle` text DEFAULT 'other' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`custom` integer DEFAULT false NOT NULL,
	`times_used` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `foods_name_idx` ON `foods` (`name`);--> statement-breakpoint
CREATE INDEX `foods_used_idx` ON `foods` (`times_used`);--> statement-breakpoint
CREATE TABLE `glucose_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`value_mgdl` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`context` text,
	`note` text,
	`import_batch` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `glucose_at_idx` ON `glucose_readings` (`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `glucose_at_source_uq` ON `glucose_readings` (`at`,`source`);--> statement-breakpoint
CREATE TABLE `grocery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`week_of` text NOT NULL,
	`name` text NOT NULL,
	`qty` text DEFAULT '' NOT NULL,
	`aisle` text DEFAULT 'other' NOT NULL,
	`from_recipe_id` text,
	`checked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `grocery_week_idx` ON `grocery_items` (`week_of`);--> statement-breakpoint
CREATE TABLE `hydration_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`ml` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hydration_at_idx` ON `hydration_logs` (`at`);--> statement-breakpoint
CREATE TABLE `insulin_doses` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`insulin_name` text DEFAULT '' NOT NULL,
	`units` real NOT NULL,
	`meal_id` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `insulin_at_idx` ON `insulin_doses` (`at`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`body` text NOT NULL,
	`mood` integer,
	`patterns_snapshot` text,
	`reflection` text,
	`reflection_source` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `journal_at_idx` ON `journal_entries` (`at`);--> statement-breakpoint
CREATE TABLE `lab_results` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`test_key` text,
	`name` text NOT NULL,
	`value` real NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`ref_low` real,
	`ref_high` real,
	`lab_flag` text,
	`verified` integer DEFAULT false NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lab_at_idx` ON `lab_results` (`at`);--> statement-breakpoint
CREATE TABLE `meal_items` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
	`food_id` text,
	`name` text NOT NULL,
	`portion_label` text DEFAULT '' NOT NULL,
	`grams` real NOT NULL,
	`carbs_g` real NOT NULL,
	`protein_g` real DEFAULT 0 NOT NULL,
	`fat_g` real DEFAULT 0 NOT NULL,
	`fiber_g` real DEFAULT 0 NOT NULL,
	`calories_kcal` real DEFAULT 0 NOT NULL,
	`basis` text DEFAULT 'reference' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meal_items_meal_idx` ON `meal_items` (`meal_id`);--> statement-breakpoint
CREATE INDEX `meal_items_food_idx` ON `meal_items` (`food_id`);--> statement-breakpoint
CREATE TABLE `meal_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`week_of` text NOT NULL,
	`day` integer NOT NULL,
	`slot` text NOT NULL,
	`recipe_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_plan_cell_uq` ON `meal_plan` (`week_of`,`day`,`slot`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`slot` text DEFAULT 'snack' NOT NULL,
	`name` text NOT NULL,
	`carbs_g` real DEFAULT 0 NOT NULL,
	`protein_g` real,
	`fat_g` real,
	`fiber_g` real,
	`tags` text DEFAULT '' NOT NULL,
	`recipe_id` text,
	`calories_kcal` real,
	`estimate_source` text DEFAULT 'manual' NOT NULL,
	`items` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meals_at_idx` ON `meals` (`at`);--> statement-breakpoint
CREATE TABLE `medication_taken` (
	`id` text PRIMARY KEY NOT NULL,
	`medication_id` text NOT NULL,
	`at` integer NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `med_taken_at_idx` ON `medication_taken` (`at`);--> statement-breakpoint
CREATE TABLE `medications` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`dose_text` text DEFAULT '' NOT NULL,
	`knowledge_id` text,
	`started_on` text,
	`active` integer DEFAULT true NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`text` text NOT NULL,
	`evidence` text,
	`source` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`times_seen` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_kind_key_uq` ON `memory_facts` (`kind`,`key`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`triage_level` text,
	`meta` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `msg_conv_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `nudges` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`href` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`dismissed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nudges_dedupe_uq` ON `nudges` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `packing_items` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`label` text NOT NULL,
	`per_day` real,
	`unit` text,
	`tip` text,
	`only_if` text,
	`custom` integer DEFAULT false NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`diabetes_type` text DEFAULT 'type2' NOT NULL,
	`units` text DEFAULT 'mgdl' NOT NULL,
	`target_low_mgdl` integer DEFAULT 70 NOT NULL,
	`target_high_mgdl` integer DEFAULT 180 NOT NULL,
	`insulin_regimen` text DEFAULT 'none' NOT NULL,
	`uses_cgm` integer DEFAULT false NOT NULL,
	`hydration_goal_ml` integer DEFAULT 2000 NOT NULL,
	`sleep_goal_minutes` integer DEFAULT 450 NOT NULL,
	`daily_carb_target_g` integer,
	`reminder_times` text DEFAULT '' NOT NULL,
	`quiet_start` text DEFAULT '22:00' NOT NULL,
	`quiet_end` text DEFAULT '07:00' NOT NULL,
	`copilot_style` text DEFAULT 'standard' NOT NULL,
	`goals` text DEFAULT '' NOT NULL,
	`pregnant` integer DEFAULT false NOT NULL,
	`birth_year` integer,
	`onboarded` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slot` text NOT NULL,
	`carbs_g` real NOT NULL,
	`protein_g` real NOT NULL,
	`fiber_g` real NOT NULL,
	`minutes` integer NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`ingredients` text NOT NULL,
	`steps` text NOT NULL,
	`why_it_works` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sleep_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`wake_date` text NOT NULL,
	`bed_at` integer NOT NULL,
	`wake_at` integer NOT NULL,
	`minutes` integer NOT NULL,
	`quality` integer DEFAULT 3 NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sleep_wake_date_uq` ON `sleep_logs` (`wake_date`);--> statement-breakpoint
CREATE TABLE `symptom_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`symptoms` text NOT NULL,
	`severity` integer DEFAULT 2 NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `symptom_at_idx` ON `symptom_logs` (`at`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`days` integer DEFAULT 7 NOT NULL,
	`spare_fraction` real DEFAULT 0.5 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weight_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`kg` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `weight_at_idx` ON `weight_logs` (`at`);--> statement-breakpoint
CREATE TABLE `wellbeing_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`feeling` integer NOT NULL,
	`energy` integer,
	`stress` integer,
	`unusual` text,
	`want_to_discuss` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkin_date_uq` ON `wellbeing_checkins` (`date`);