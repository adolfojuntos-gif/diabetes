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
export const CONTROL_PATH = `${CONTROL_DIR}/control-${process.pid}-${Date.now()}.db`;

// Synchronous, because the libsql client is created on first use and will not create the directory.
mkdirSync(CONTROL_DIR, { recursive: true });

process.env.CONTROL_DATABASE_URL = `file:${CONTROL_PATH}`;
