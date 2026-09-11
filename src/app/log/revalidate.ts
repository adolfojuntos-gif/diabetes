import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Every logging write changes what the hub and the Today screen show, so those two are always
 * refreshed; callers add the screen they are on and anywhere else the data appears.
 */
export function revalidateLog(...extra: string[]) {
  for (const p of ["/", "/log", ...extra]) revalidatePath(p);
}
