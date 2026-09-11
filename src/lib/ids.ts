import { randomBytes } from "node:crypto";

/**
 * Row ids. A URL-safe random string, 14 characters, from the platform's CSPRNG.
 *
 * This used to be `nanoid`, and that cost a production outage: `next build --standalone` traces
 * only what the route graph imports, so the seed and demo scripts ran inside the container with no
 * `nanoid` on disk and the database came up empty. One fewer dependency is one fewer thing to ship.
 *
 * 14 characters from a 64-symbol alphabet is 84 bits of entropy, which is far more than a
 * single-person database needs and is also what the caregiver share tokens are built from, where it
 * does matter: guessing one at 1000 attempts a second would take longer than the universe has run.
 */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

export function newId(size = 14): string {
  // Rejection-free because the alphabet is exactly 64 symbols, so 6 bits map cleanly per character
  // and no value is more likely than another.
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i] & 63];
  return out;
}

/** A longer id for anything that acts as a credential, such as a caregiver share token. */
export function newToken(): string {
  return newId(32);
}
