/**
 * For drizzle-kit only. NOT how the app reaches a database.
 *
 * drizzle-kit is a CLI that reads one config file, so it cannot be pointed at a database per
 * account. That is exactly why `accountSchema.ts` is generated from the schema and applied per
 * account by `applyAccountSchema`, and why `npm run migrate:all` exists.
 *
 * The default used to be `data/steady.db`, which since the split is the PRE-MIGRATION BACKUP of
 * the first account's data. So `npm run db:push` wrote schema changes into a file the app never
 * reads and, worse, could alter a backup. It points at a scratch file now: generating and
 * diffing a schema does not need real data, and nothing this tool does should be able to reach any.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DRIZZLE_SCRATCH_URL ?? "file:./data/schema-scratch.db" },
});
