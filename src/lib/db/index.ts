import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import * as schema from "./schema";

/**
 * THE ACCOUNT DATABASE HANDLE.
 *
 * `db` looks like a plain Drizzle instance and is a Proxy that resolves, per request, to the
 * database belonging to the signed-in account. That indirection is the entire multi-tenancy
 * mechanism, and it is why roughly 300 existing query sites did not have to change.
 *
 * The alternative was one shared database with an `accountId` column and a predicate on every
 * query. Correctness would then depend on all 300 of those sites carrying a `where` forever, and a
 * single omission is one patient reading another patient's glucose readings. Here a missing
 * predicate cannot leak anything, because the other person's rows are not in the file.
 *
 * IT FAILS CLOSED. With no account in context, `db` throws rather than falling back to a default
 * database. A handle that quietly resolves to something is how a background job ends up writing
 * into the wrong person's records, so there is no default to resolve to.
 *
 * The only way to get a handle is `withAccount`, which the session helper calls once per request.
 */
type Db = ReturnType<typeof drizzle<typeof schema>>;

const SCHEMA_KEY = Object.keys(schema).sort().join(",");

/**
 * Per-request account context. Next gives every request its own async context, so this is how a
 * server component three layers deep knows whose database it is reading without being passed it.
 */
type Ctx = { accountId: string; dbRef: string };
const store = new AsyncLocalStorage<Ctx>();

const g = globalThis as unknown as { __stHandles?: Map<string, Db>; __stKey?: string };

/**
 * How many account databases may be open at once.
 *
 * The cache used to be unbounded, which is fine at three accounts and a file-descriptor exhaustion
 * at thousands: every entry is a live SQLite connection that nothing ever closed. Least recently
 * used is the right eviction here because traffic is per person and bursty. Someone using the app
 * makes many requests in a few minutes and then none for a day, so the account that has been idle
 * longest is also the one least likely to be needed next. Evicting costs one reconnect.
 */
const MAX_OPEN = Number(process.env.MAX_OPEN_ACCOUNT_DBS ?? 256);

/** One handle per account, cached. A new schema key discards them all, so a dev-time table addition lands. */
function handles(): Map<string, Db> {
  if (!g.__stHandles || g.__stKey !== SCHEMA_KEY) {
    g.__stHandles = new Map();
    g.__stKey = SCHEMA_KEY;
  }
  return g.__stHandles;
}

/** The underlying libsql client, which drizzle exposes but does not type on the narrowed Db. */
function clientOf(handle: Db): { close?: () => void } | null {
  const c = (handle as unknown as { $client?: { close?: () => void } }).$client;
  return c ?? null;
}

/**
 * Close an account's connection and forget it.
 *
 * Needed in two places, and it is not only tidiness in either. Deleting an account has to release
 * the file before it can be removed, and on Windows an open handle makes the delete fail outright
 * rather than leaving a stale file. Tests need it for the same reason.
 */
export function closeHandle(dbRef: string): boolean {
  const cache = handles();
  const existing = cache.get(dbRef);
  if (!existing) return false;
  cache.delete(dbRef);
  try {
    clientOf(existing)?.close?.();
  } catch {
    // A handle that will not close is still gone from the cache, which is the part that matters.
  }
  return true;
}

/** How many account databases are currently open. Exposed so a test can assert the bound holds. */
export function openHandleCount(): number {
  return handles().size;
}

/**
 * Where account databases live.
 *
 * Configurable because the default is relative to the working directory, and on a deployment the
 * working directory is NOT the persistent disk. On Fly the volume is mounted at `/data` and the app
 * runs from `/app`, so every account database was about to be written inside the container and
 * deleted on the next restart, taking every account's records with it. The control database had the
 * same problem. Nothing would have failed or logged: signup would work, the app would work, and the
 * data would be gone after a deploy.
 */
export const ACCOUNTS_DIR = (process.env.ACCOUNTS_DIR ?? "./data/accounts").replace(/\/+$/, "");

/** Turn a stored `dbRef` into a libsql URL. A path is local; a bare name is a Turso database. */
export function urlForRef(dbRef: string): string {
  if (dbRef.startsWith("file:") || dbRef.startsWith("libsql:") || dbRef.startsWith("http")) return dbRef;
  const host = process.env.TURSO_ORG_HOST;
  if (host) return `libsql://${dbRef}-${host}`;
  return `file:${ACCOUNTS_DIR}/${dbRef}.db`;
}

export function handleFor(dbRef: string): Db {
  const cache = handles();
  const existing = cache.get(dbRef);
  if (existing) {
    // Re-inserting moves this key to the end, which is what makes the Map's insertion order a
    // recency order and lets the eviction below pick the genuinely coldest account.
    cache.delete(dbRef);
    cache.set(dbRef, existing);
    return existing;
  }
  const instance = drizzle(
    createClient({ url: urlForRef(dbRef), authToken: process.env.ACCOUNT_DATABASE_AUTH_TOKEN }),
    { schema },
  );
  cache.set(dbRef, instance);

  /**
   * Evict after inserting, never before, so the handle just handed out cannot be the one closed.
   * A loop rather than a single eviction because MAX_OPEN can be lowered at runtime by a restart
   * with a smaller value while a cache built under the old one is still warm.
   */
  while (cache.size > MAX_OPEN) {
    const coldest = cache.keys().next();
    if (coldest.done || coldest.value === dbRef) break;
    closeHandle(coldest.value);
  }
  return instance;
}

/**
 * Run `fn` with this account's database as the ambient one. Everything inside, however deep, sees
 * `db` pointing at that account and nothing else.
 */
export function withAccount<T>(ctx: Ctx, fn: () => T): T {
  return store.run(ctx, fn);
}

/** The account whose database `db` currently resolves to, or null outside a request. */
export function currentAccountId(): string | null {
  return store.getStore()?.accountId ?? null;
}

export class NoAccountContextError extends Error {
  constructor() {
    super(
      "No account is in context, so there is no database to read. Every path that touches clinical data must run inside withAccount(). This is deliberate: a handle that silently defaulted somewhere is how data ends up in the wrong person's records.",
    );
    this.name = "NoAccountContextError";
  }
}

function resolve(): Db {
  const ctx = store.getStore();
  if (!ctx) throw new NoAccountContextError();
  return handleFor(ctx.dbRef);
}

export const db: Db = new Proxy({} as Db, {
  get(_t, prop, receiver) {
    const real = resolve() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_t, prop) {
    return prop in (resolve() as unknown as object);
  },
});

export * from "./schema";
