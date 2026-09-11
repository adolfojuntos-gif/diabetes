import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  pw: string | Buffer,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

/** Stored as scrypt$N$r$p$salt$hash. The salt is per user. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Constant-time within a given stored format. Anything malformed is false, never a throw. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = await scrypt(password.normalize("NFKC"), salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 256 bits of randomness in the cookie; only the digest in the database. */
export function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Password rules, stated plainly and enforced server-side. Length does the work; a composition
 * rule that demands a symbol mostly produces "Password1!" and a sticky note.
 */
export function passwordProblem(password: string): string | null {
  const pw = password.normalize("NFKC");
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "That is longer than 200 characters.";
  if (/^\s+$/.test(pw)) return "Use at least 10 characters.";
  return null;
}

/**
 * Two words and a number: readable enough to be said out loud, random enough to be a real
 * temporary password. Vocabulary is calm on purpose - this string is the first thing a new
 * moderator reads from the product.
 */
export function suggestPassword() {
  const words = [
    "amber", "atlas", "birch", "cadence", "cedar", "delta", "ember", "harbor", "ivory", "juniper",
    "lantern", "meadow", "north", "opal", "quiet", "river", "sable", "thistle", "umber", "willow",
  ];
  const pick = () => words[randomBytes(1)[0] % words.length];
  return `${pick()}-${pick()}-${(randomBytes(2).readUInt16BE(0) % 900) + 100}`;
}

/** One normalization, used for both the uniqueness index and every lookup. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
