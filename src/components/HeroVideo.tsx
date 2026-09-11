"use client";
/**
 * Background hero video.
 *
 * Rules this component enforces, because a health app is read at 3am with shaking hands:
 *  - It never sits behind live numbers. Entry screens and section heroes only.
 *  - A scrim always covers it, so type contrast never depends on which frame is showing.
 *  - `prefers-reduced-motion` gets the poster still and no video element at all.
 *  - It is muted, inline, looping, and `preload="none"` until it is on screen, so it costs
 *    nothing on a phone that never scrolls to it.
 *  - If the file is missing the poster shows and nothing breaks.
 *
 * Drop files in `public/hero/` as `<name>.mp4` and `<name>.jpg`.
 */
import { useEffect, useRef, useState } from "react";

export function HeroVideo({
  name,
  height = "h-[58vh] min-h-[22rem]",
  children,
  align = "end",
  focus = "bottom",
  scrim = "full",
  start,
  end,
  rate = 1,
  zoom = 1,
}: {
  name: string;
  height?: string;
  children?: React.ReactNode;
  align?: "center" | "end";
  /** Which part of the frame survives the crop. The prompts put the subject low, so: bottom. */
  focus?: "bottom" | "center";
  /**
   * "full" protects type sitting on the footage. "edge" only feathers the bottom into the page,
   * for a band with no text on it, where a heavy scrim would bury the subject.
   */
  scrim?: "full" | "edge";
  /**
   * Play only a window of the file, in seconds, and loop that instead of the whole clip. This is
   * how a plate cut from longer footage is used without re-encoding it: the unusable head and tail
   * simply never play. `end` is exclusive and the loop returns to `start`.
   */
  start?: number;
  end?: number;
  /**
   * Playback rate. A short window becomes a usable background loop when it is slowed down, and a
   * background wants drift rather than action anyway.
   */
  rate?: number;
  /**
   * Extra magnification, anchored to the bottom of the frame. `object-fit: cover` already crops to
   * the hero's aspect; this crops further, which is how anything burnt into the upper frame (a
   * title card, a face, a logo) is pushed out of shot.
   */
  zoom?: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMotion(!mq.matches);
    const onChange = () => setMotion(!mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !motion) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [motion]);

  /**
   * Window and speed. `loop` on the element would return to 0, so when a window is set the element
   * is left un-looped and sent back to `start` here instead.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el || !motion) return;
    el.playbackRate = rate;
    const from = start ?? 0;
    const to = end ?? Infinity;
    const onLoaded = () => {
      el.playbackRate = rate;
      if (start !== undefined && el.currentTime < from) el.currentTime = from;
    };
    const onTime = () => {
      if (el.currentTime >= to || el.currentTime < from - 0.05) el.currentTime = from;
    };
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    if (el.readyState > 0) onLoaded();
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
    };
  }, [motion, start, end, rate]);

  return (
    <section className={`relative ${height} overflow-hidden flex ${align === "end" ? "items-end" : "items-center"} isolate`}>
      <div
        className="absolute inset-0 -z-20 bg-sunk"
        style={{
          backgroundImage: `url(/hero/${name}.jpg)`,
          backgroundSize: zoom === 1 ? "cover" : `${zoom * 100}% auto`,
          backgroundPosition: focus,
        }}
        aria-hidden
      />
      {motion ? (
        <video
          ref={ref}
          className="absolute inset-0 -z-10 w-full h-full object-cover"
          style={{
            objectPosition: focus,
            ...(zoom === 1 ? {} : { transform: `scale(${zoom})`, transformOrigin: "50% 100%" }),
          }}
          poster={`/hero/${name}.jpg`}
          muted
          // A windowed clip must not loop to 0: the effect above sends it back to `start` instead.
          loop={start === undefined}
          playsInline
          preload={start === undefined ? "none" : "metadata"}
          aria-hidden
          tabIndex={-1}
        >
          <source src={`/hero/${name}.mp4`} type="video/mp4" />
        </video>
      ) : null}
      {/* The scrim. Type sits on this, never on the footage. */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            scrim === "edge"
              ? "linear-gradient(to top, var(--paper) 0%, color-mix(in srgb, var(--paper) 42%, transparent) 12%, transparent 38%)"
              : // Heavy only where the type actually sits, then out of the way. The old curve held
                // 82% paper at 38% height, which washed every plate to dust before it reached the eye.
                "linear-gradient(to top, var(--paper) 3%, color-mix(in srgb, var(--paper) 72%, transparent) 26%, color-mix(in srgb, var(--paper) 18%, transparent) 62%, transparent 100%)",
        }}
        aria-hidden
      />
      <div className="relative w-full max-w-5xl mx-auto px-4 pb-8 md:px-8 md:pb-12">{children}</div>
    </section>
  );
}
