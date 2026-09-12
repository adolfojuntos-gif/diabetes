/**
 * Point the control database at a temporary file, as a side effect, before anything imports it.
 *
 * This has to be its own module. `src/lib/db/control.ts` reads `CONTROL_DATABASE_URL` once at module
 * load, and a static import is hoisted above any assignment in the importing file, so setting the
 * variable inside the test would be too late and the test would write to the REAL control database.
 * Importing this first works because import side effects run in source order.
 *
 * A top-level `await import()` would also work and is not available: this project compiles to CJS,
 * where esbuild rejects top-level await.
 */
import { mkdirSync } from "node:fs";

export const CONTROL_DIR = "./data/test-control";

/**
 * Unique per process, because node's test runner puts each file in its own one and they run at the
 * same time. Three test files use this directory.
 */
export const CONTROL_PATH = `${CONTROL_DIR}/control-${process.pid}-${Date.now()}.db`;

/**
 * Delete only THIS process's files, never the directory.
 *
 * Each of the three files that use this used to remove the whole directory in its teardown, so
 * whichever finished first deleted the databases the other two were still using. It showed up as
 * one unrelated test failing in a full-suite run and passing on its own, which is the most
 * expensive kind of flake to chase.
 */
export async function cleanupControl(): Promise<void> {
  const { rm } = await import("node:fs/promises");
  for (const f of [CONTROL_PATH, `${CONTROL_PATH}-wal`, `${CONTROL_PATH}-shm`]) {
    await rm(f, { force: true }).catch(() => {});
  }
}

// Synchronous, because the libsql client is created on first use and will not create the directory.
mkdirSync(CONTROL_DIR, { recursive: true });

process.env.CONTROL_DATABASE_URL = `file:${CONTROL_PATH}`;
