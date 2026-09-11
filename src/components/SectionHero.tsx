"use client";
/**
 * A section's cover band. Footage only, no type in it, dissolving into the page ground at the
 * bottom so the page's own header sits on paper rather than on a frame of video.
 *
 * It renders ONLY on the section's hub path, never on the sub-pages where someone is typing a
 * number. `only` is matched exactly, so /log gets the band and /log/glucose does not.
 */
import { usePathname } from "next/navigation";
import { HeroVideo } from "./HeroVideo";

export function SectionHero({ name, only, focus = "bottom" }: { name: string; only: string; focus?: "bottom" | "center" }) {
  const path = usePathname();
  if (path !== only) return null;
  return (
    <div className="-mb-2">
      <HeroVideo name={name} height="h-[30vh] min-h-[11rem] max-h-[17rem]" align="end" scrim="edge" focus={focus} />
    </div>
  );
}
