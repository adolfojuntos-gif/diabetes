/**
 * THE WORLD.
 *
 * The picture of somebody's progress, in whichever of the three places they chose to build it.
 * Everything in it is derived from `WorldState`, which is derived from the ledger, so the drawing
 * can never say something the numbers do not.
 *
 * Two constraints shape every colour here. Glucose owns coral, amber, ember and juniper across the
 * whole app, and the Copilot owns slate, so a world that used coral for a roof would make a red
 * thing mean two things. Foliage may use juniper because juniper already means "in range" and a
 * green tree saying "in range" is the one collision that helps. Everything else that wants colour
 * uses bloom and sky, which are the decorative hues.
 *
 * The three terrains are genuinely different drawings rather than a hue rotation, because a
 * recoloured forest is not a coast and nobody is fooled. What they share is the STRUCTURE: the
 * same seven layers in the same order, driven by the same numbers, so a person at level 7 sees the
 * same amount of world whichever one they picked.
 *
 * It is one inline SVG with no library, no canvas and no script: it renders on the server, it is
 * about 7 kB, and it draws identically in a print stylesheet and in a screenshot.
 */
import type { WorldState } from "@/lib/engines/journey";
import type { ThemeKey } from "@/lib/game/themes";

/**
 * Deterministic jitter. The same level must draw the same world every time it is opened, so this
 * is a hash of the index rather than Math.random: a world that reshuffled on every page load would
 * read as decoration rather than as a place.
 */
function jitter(i: number, seed: number, spread: number): number {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * spread;
}

const GROUND = 250;

/* --------------------------------- pieces --------------------------------- */

function Tree({ x, y, scale, dark }: { x: number; y: number; scale: number; dark?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x={-2.5} y={-14} width={5} height={22} rx={2} fill="var(--tree-trunk)" />
      <ellipse cx={0} cy={-26} rx={17} ry={20} fill={dark ? "var(--tree-dark)" : "var(--tree-leaf)"} />
      <ellipse cx={-9} cy={-16} rx={12} ry={12} fill={dark ? "var(--tree-dark)" : "var(--tree-leaf)"} opacity={0.92} />
      <ellipse cx={10} cy={-17} rx={11} ry={11} fill={dark ? "var(--tree-dark)" : "var(--tree-leaf)"} opacity={0.92} />
    </g>
  );
}

/** The coast's equivalent of a tree: a palm, leaning the way the wind has been going. */
function Palm({ x, y, scale, dark }: { x: number; y: number; scale: number; dark?: boolean }) {
  const leaf = dark ? "var(--tree-dark)" : "var(--tree-leaf)";
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0 4 C 2 -8, 5 -18, 9 -30" stroke="var(--tree-trunk)" strokeWidth={4} fill="none" strokeLinecap="round" />
      <g transform="translate(9 -30)">
        <path d="M0 0 C -12 -6, -20 -2, -24 6 C -16 -2, -8 -3, 0 0 Z" fill={leaf} />
        <path d="M0 0 C 12 -7, 20 -3, 24 5 C 16 -3, 8 -4, 0 0 Z" fill={leaf} />
        <path d="M0 0 C -6 -14, -2 -20, 4 -24 C 0 -16, 1 -7, 0 0 Z" fill={leaf} opacity={0.94} />
        <path d="M0 0 C 8 -12, 16 -14, 21 -12 C 12 -9, 5 -5, 0 0 Z" fill={leaf} opacity={0.88} />
      </g>
    </g>
  );
}

/** The city's equivalent: a street tree in a planter, which is what a city does with a tree. */
function StreetTree({ x, y, scale, dark }: { x: number; y: number; scale: number; dark?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x={-9} y={-3} width={18} height={6} rx={1.5} fill="var(--world-path)" />
      <rect x={-2} y={-18} width={4} height={16} rx={1.5} fill="var(--tree-trunk)" />
      <circle cx={0} cy={-25} r={13} fill={dark ? "var(--tree-dark)" : "var(--tree-leaf)"} />
    </g>
  );
}

function Plant({ x, y, scale }: { x: number; y: number; scale: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0 0 C0 -6 0 -9 0 -12" stroke="var(--tree-trunk)" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <ellipse cx={-4} cy={-11} rx={4.5} ry={3} fill="var(--tree-leaf)" transform="rotate(-28 -4 -11)" />
      <ellipse cx={4} cy={-13} rx={4.5} ry={3} fill="var(--tree-leaf)" transform="rotate(28 4 -13)" />
    </g>
  );
}

/** Marram grass. Three blades and it reads as a dune. */
function Grass({ x, y, scale }: { x: number; y: number; scale: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} stroke="var(--tree-leaf)" strokeWidth={1.4} fill="none" strokeLinecap="round">
      <path d="M0 0 C -1 -6, -4 -9, -7 -12" />
      <path d="M0 0 C 0 -7, 0 -10, 1 -14" />
      <path d="M0 0 C 2 -6, 5 -9, 8 -11" />
    </g>
  );
}

/**
 * Home, at five stages. Whatever the terrain, this is the piece that says "somewhere of yours",
 * so every theme has one and it grows on the same schedule.
 */
function Home({ stage, terrain }: { stage: number; terrain: ThemeKey }) {
  if (stage === 0) return null;
  const lit = stage >= 4;
  if (terrain === "city") {
    // A block that gains floors and lit windows rather than a roof that gets taller.
    const floors = Math.min(5, stage + 1);
    return (
      <g transform="translate(112 250)">
        <rect x={0} y={-22 * floors} width={72} height={22 * floors} rx={2} fill="var(--home-wall)" />
        {Array.from({ length: floors }).map((_, f) =>
          [0, 1, 2].map((w) => (
            <rect
              key={`${f}-${w}`}
              x={9 + w * 22}
              y={-22 * floors + 7 + f * 22}
              width={13}
              height={11}
              rx={1}
              fill={lit && (f + w) % 2 === 0 ? "var(--home-lit)" : "var(--home-dark)"}
            />
          )),
        )}
        <rect x={-4} y={-22 * floors - 5} width={80} height={6} rx={2} fill="var(--home-roof)" />
      </g>
    );
  }
  return (
    <g transform={terrain === "coast" ? "translate(128 282)" : "translate(128 250)"}>
      {stage === 1 ? (
        <>
          <path d="M0 0 L22 -40 L44 0 Z" fill="var(--home-wall)" />
          <path d="M16 0 L22 -30 L28 0 Z" fill="var(--home-dark)" />
        </>
      ) : (
        <>
          {stage >= 4 ? (
            <g stroke="var(--tree-trunk)" strokeWidth={2.4} strokeLinecap="round" opacity={0.75}>
              <path d="M-26 0 v-14 M-14 0 v-14 M-2 0 v-14 M-30 -10 h32" />
            </g>
          ) : null}
          <rect x={0} y={-34} width={64} height={34} rx={2} fill="var(--home-wall)" />
          <path d={`M-8 -34 L32 ${stage >= 3 ? -62 : -54} L72 -34 Z`} fill="var(--home-roof)" />
          <rect x={26} y={-20} width={14} height={20} rx={1.5} fill="var(--home-dark)" />
          <rect x={8} y={-28} width={12} height={11} rx={1.5} fill={lit ? "var(--home-lit)" : "var(--home-dark)"} />
          {stage >= 3 ? <rect x={46} y={-28} width={12} height={11} rx={1.5} fill={lit ? "var(--home-lit)" : "var(--home-dark)"} /> : null}
          {stage >= 3 ? <rect x={48} y={-68} width={9} height={16} rx={1.5} fill="var(--home-roof)" /> : null}
        </>
      )}
    </g>
  );
}

/**
 * The people who arrived and stayed.
 *
 * Drawn from the world's event ledger rather than from the level, which is the whole difference
 * between a world that grows and a world that is generated: two people standing at level seven
 * have different numbers of figures on the path, because different things happened to them.
 *
 * Deliberately small and far off. They are inhabitants, not characters to be clicked.
 */
function Visitors({ n, baseline }: { n: number; baseline: number }) {
  if (n <= 0) return null;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const x = 250 + i * 58 + jitter(i, 21, 22);
        const y = baseline + 10 + jitter(i, 23, 10);
        const scale = 0.52 + jitter(i, 27, 0.12);
        return (
          <g key={i} transform={`translate(${x} ${y}) scale(${scale})`} opacity={0.85}>
            <circle cx="0" cy="-24" r="6" fill="var(--world-figure)" />
            <path d="M0 -18 L0 -5 M0 -15 L-6 -8 M0 -15 L6 -9 M0 -5 L-5 4 M0 -5 L5 4" stroke="var(--world-figure)" strokeWidth="3.2" strokeLinecap="round" fill="none" />
          </g>
        );
      })}
    </g>
  );
}

/**
 * Landmarks: the things that became visible as the map opened. Kept as silhouettes, because a
 * landmark you can make out completely is scenery, and one you cannot is somewhere to go.
 */
function Landmarks({ n, terrain }: { n: number; terrain: ThemeKey }) {
  if (n <= 0) return null;
  const spots = [
    { x: 92, y: 214 },
    { x: 726, y: 210 },
    { x: 470, y: 206 },
    { x: 186, y: 200 },
    { x: 612, y: 198 },
    { x: 348, y: 196 },
    { x: 780, y: 196 },
    { x: 36, y: 202 },
  ];
  return (
    <g opacity={0.78}>
      {spots.slice(0, n).map((p, i) =>
        terrain === "city" ? (
          <rect key={i} x={p.x - 5} y={p.y - 26} width={10} height={26} rx={1.5} fill="var(--world-island)" />
        ) : terrain === "coast" ? (
          <path key={i} d={`M${p.x - 9} ${p.y} L${p.x} ${p.y - 24} L${p.x + 9} ${p.y} Z`} fill="var(--world-island)" />
        ) : (
          <rect key={i} x={p.x - 4} y={p.y - 22} width={8} height={22} rx={3} fill="var(--world-island)" />
        ),
      )}
    </g>
  );
}

/** The settlement that appears once there is enough here to be a place rather than a camp. */
function Village({ show, terrain }: { show: boolean; terrain: ThemeKey }) {
  if (!show) return null;
  if (terrain === "city") {
    return (
      <g opacity="0.9">
        {[
          { x: 520, h: 96, w: 46 },
          { x: 574, h: 138, w: 40 },
          { x: 620, h: 76, w: 52 },
          { x: 678, h: 118, w: 44 },
          { x: 728, h: 88, w: 48 },
        ].map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={250 - b.h} width={b.w} height={b.h} rx={2} fill="var(--home-wall)" opacity={0.85} />
            {Array.from({ length: Math.floor(b.h / 20) }).map((_, f) => (
              <rect key={f} x={b.x + 8} y={250 - b.h + 8 + f * 20} width={b.w - 16} height={8} rx={1} fill="var(--home-dark)" opacity={0.55} />
            ))}
          </g>
        ))}
      </g>
    );
  }
  const roofed =
    terrain === "coast"
      ? [{ x: 548, s: 0.52 }, { x: 604, s: 0.44 }, { x: 656, s: 0.48 }]
      : [{ x: 560, s: 0.62 }, { x: 618, s: 0.5 }, { x: 672, s: 0.56 }];
  const baseline = terrain === "coast" ? 276 : 248;
  return (
    <g opacity="0.92">
      {roofed.map((b, i) => (
        <g key={i} transform={`translate(${b.x} ${baseline}) scale(${b.s})`}>
          <rect x={0} y={-30} width={46} height={30} rx={2} fill="var(--home-wall)" />
          <path d="M-6 -30 L23 -50 L52 -30 Z" fill="var(--home-roof)" />
          <rect x={16} y={-18} width={12} height={18} rx={1.5} fill="var(--home-dark)" />
        </g>
      ))}
    </g>
  );
}

/**
 * Rest Mode's campfire. It only ever appears when somebody has chosen to stop, and it is the one
 * thing in this drawing that is not earned.
 */
function Campfire() {
  return (
    <g transform="translate(238 276)">
      <ellipse cx="0" cy="4" rx="26" ry="6" fill="var(--world-path)" opacity="0.5" />
      <path d="M-14 2 L12 -6 M-12 -6 L14 2" stroke="var(--tree-trunk)" strokeWidth="4" strokeLinecap="round" />
      <path d="M0 -6 C -9 -18, 7 -20, 0 -34 C 12 -22, 10 -10, 0 -6 Z" fill="var(--world-sun)" className="world-flame" />
      <circle cx="0" cy="-16" r="30" fill="url(#w-sun)" />
    </g>
  );
}

/* --------------------------------- terrain -------------------------------- */

/** The far distance: what is on the horizon, and what opens up as the level rises. */
function Distance({ w, terrain }: { w: WorldState; terrain: ThemeKey }) {
  if (terrain === "coast") {
    return (
      <g>
        {/* The sea meets the sky at a fixed line; islands appear on it as the world grows. */}
        <rect x="-20" y="196" width="840" height="70" fill="url(#w-water)" />
        {w.mountains ? (
          <>
            <path d="M452 197 Q 536 138, 620 197 Z" fill="var(--world-island)" />
            <path d="M508 168 Q 536 150, 564 168 Q 536 158, 508 168 Z" fill="var(--world-snow)" opacity="0.8" />
            <path d="M628 197 Q 686 156, 744 197 Z" fill="var(--world-island)" opacity="0.85" />
          </>
        ) : (
          <path d="M556 197 Q 600 174, 644 197 Z" fill="var(--world-island)" opacity="0.85" />
        )}
        {/* The lighthouse is the level-8 landmark, and it is lit. */}
        {w.falls ? (
          <g transform="translate(690 197)">
            <path d="M-9 0 L-6 -46 L6 -46 L9 0 Z" fill="var(--home-wall)" />
            <rect x={-8} y={-56} width={16} height={11} rx={2} fill="var(--home-lit)" />
            <path d="M-7 -18 L7 -18 M-8 -32 L8 -32" stroke="var(--home-roof)" strokeWidth="4" />
          </g>
        ) : null}
        {/* Swell lines, drawn short so they read as water and not as stripes. */}
        {[206, 218, 230, 242].map((y, i) => (
          <path
            key={y}
            d={`M${40 + i * 30} ${y} q 16 -4 32 0 M${160 + i * 26} ${y} q 16 -4 32 0 M${300 + i * 34} ${y} q 16 -4 32 0 M${470 + i * 22} ${y} q 16 -4 32 0`}
            stroke="var(--world-water-top)"
            strokeWidth="1.6"
            fill="none"
            opacity={0.55}
          />
        ))}
      </g>
    );
  }
  if (terrain === "city") {
    return (
      <g opacity="0.5">
        {[
          { x: 40, h: 70, w: 34 },
          { x: 88, h: 108, w: 28 },
          { x: 128, h: 58, w: 40 },
          { x: 260, h: 92, w: 30 },
          { x: 300, h: 126, w: 36 },
          { x: 350, h: 68, w: 44 },
          { x: 760, h: 84, w: 40 },
        ].map((b, i) => (
          <rect key={i} x={b.x} y={250 - b.h} width={b.w} height={b.h} rx={2} fill="var(--world-far)" />
        ))}
        {w.mountains ? <path d="M400 250 L470 120 L540 250 Z" fill="var(--world-far)" opacity="0.55" /> : null}
      </g>
    );
  }
  return w.mountains ? (
    <g>
      <path d="M-20 250 L150 96 L300 250 Z" fill="var(--world-far)" />
      <path d="M210 250 L392 62 L580 250 Z" fill="var(--world-far)" />
      <path d="M392 62 L440 112 L392 132 L352 108 Z" fill="var(--world-snow)" />
      <path d="M470 250 L640 122 L800 250 Z" fill="var(--world-far)" opacity="0.75" />
    </g>
  ) : (
    <g opacity="0.55">
      <path d="M-20 250 Q120 186 260 250 Z" fill="var(--world-far)" />
      <path d="M240 250 Q420 178 620 250 Z" fill="var(--world-far)" />
      <path d="M560 250 Q700 196 830 250 Z" fill="var(--world-far)" />
    </g>
  );
}

/** The ground the path is walked on, and the water running through it. */
function Ground({ w, terrain }: { w: WorldState; terrain: ThemeKey }) {
  if (terrain === "coast") {
    return (
      <g>
        {/* Beach: a curve of sand with the wet line where the water has just been. */}
        <path d="M-20 262 Q 200 240, 420 258 Q 640 274, 830 252 L830 360 L-20 360 Z" fill="var(--world-path)" />
        <path d="M-20 262 Q 200 240, 420 258 Q 640 274, 830 252" stroke="var(--world-water-top)" strokeWidth="3" fill="none" opacity="0.5" />
        <path d="M-20 300 Q 240 286, 480 298 Q 670 306, 830 292 L830 360 L-20 360 Z" fill="var(--world-ground)" />
      </g>
    );
  }
  if (terrain === "city") {
    return (
      <g>
        <path d="M-20 250 L830 250 L830 360 L-20 360 Z" fill="var(--world-ground)" />
        {/* The road, which is what a city has instead of a valley floor. */}
        <rect x="-20" y="286" width="850" height="30" fill="var(--world-ground-2)" />
        {w.river > 0 ? <rect x="-20" y={300} width="850" height={6 + w.river * 10} fill="url(#w-water)" opacity="0.9" /> : null}
      </g>
    );
  }
  return (
    <g>
      <path d="M-20 250 Q200 232 400 246 Q620 260 830 240 L830 360 L-20 360 Z" fill="var(--world-ground)" />
      <path d="M-20 286 Q220 272 460 284 Q660 294 830 280 L830 360 L-20 360 Z" fill="var(--world-ground-2)" />
      {w.river > 0 ? (
        <path
          d={`M391 250 C 391 276, ${300 - w.river * 40} 292, ${240 - w.river * 60} 340 L${360 + w.river * 90} 340 C 420 292, 410 272, 404 250 Z`}
          fill="url(#w-water)"
        />
      ) : null}
      {w.falls ? (
        <g>
          <path d="M378 128 L404 128 L412 250 L370 250 Z" fill="url(#w-water)" opacity="0.9" />
          <ellipse cx="391" cy="252" rx="34" ry="7" fill="var(--world-water-top)" opacity="0.8" />
        </g>
      ) : null}
    </g>
  );
}

/* --------------------------------- the map -------------------------------- */

export function World({
  w,
  theme = "forest",
  rest = false,
  className = "",
}: {
  w: WorldState;
  theme?: ThemeKey;
  rest?: boolean;
  className?: string;
}) {
  const Canopy = theme === "coast" ? Palm : theme === "city" ? StreetTree : Tree;
  const Undergrowth = theme === "coast" ? Grass : Plant;
  const groundLine = theme === "coast" ? GROUND + 22 : GROUND;

  const trees = Array.from({ length: w.trees }, (_, i) => {
    // Filling outward from the home, alternating sides, so what you planted grows AROUND you
    // rather than marching in from one edge.
    const side = i % 2 === 0 ? 1 : -1;
    const step = Math.floor(i / 2);
    const x = 400 + side * (110 + step * 62) + jitter(i, 3, 26);
    const y = groundLine + 4 + jitter(i, 11, 16);
    return { x: Math.max(40, Math.min(760, x)), y, scale: 0.7 + jitter(i, 7, 0.34) };
  });
  const plants = Array.from({ length: w.plants }, (_, i) => ({
    x: 60 + ((i * 53) % 690) + jitter(i, 5, 16),
    y: groundLine + 14 + ((i * 17) % 52),
    scale: 0.8 + jitter(i, 9, 0.5),
  }));
  // In Rest Mode the stars come out whatever the level, because dusk is the point of the mode.
  const starCount = rest ? Math.max(22, w.stars) : w.stars;
  const stars = Array.from({ length: starCount }, (_, i) => ({
    x: 30 + ((i * 71) % 745),
    y: 16 + ((i * 37) % 96),
    r: 1.1 + Math.abs(jitter(i, 13, 1.6)),
  }));

  const pathEnd = 120 + w.path * 640;
  const walkY = theme === "coast" ? 286 : theme === "city" ? 300 : 262;
  const pathY = theme === "coast" ? 296 : theme === "city" ? 308 : 302;

  return (
    <svg
      viewBox="0 0 800 340"
      className={`world ${rest ? "world-rest" : ""} ${className}`}
      role="img"
      aria-label={`Your world at level ${w.level}: ${w.trees} grown things, ${w.plants} small ones${w.visitors > 0 ? `, ${w.visitors} ${w.visitors === 1 ? "person who arrived and stayed" : "people who arrived and stayed"}` : ""}${w.landmarks > 0 ? `, ${w.landmarks} landmarks` : ""}${w.mountains ? ", high ground on the horizon" : ""}${w.river > 0 ? ", water running through it" : ""}.`}
    >
      <defs>
        <linearGradient id="w-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--world-sky-top)" />
          <stop offset="100%" stopColor="var(--world-sky-bottom)" />
        </linearGradient>
        <linearGradient id="w-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--world-water-top)" />
          <stop offset="100%" stopColor="var(--world-water-bottom)" />
        </linearGradient>
        <radialGradient id="w-sun">
          <stop offset="0%" stopColor="var(--world-sun)" stopOpacity="0.5" />
          <stop offset="45%" stopColor="var(--world-sun)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--world-sun)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="w-ceiling" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#080b14" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#080b14" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="w-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#080b14" stopOpacity="0" />
          <stop offset="60%" stopColor="#080b14" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#080b14" stopOpacity="0.62" />
        </linearGradient>
        <clipPath id="w-frame">
          <rect x="0" y="0" width="800" height="340" rx="18" />
        </clipPath>
      </defs>

      <g clipPath="url(#w-frame)">
        <rect x="0" y="0" width="800" height="340" fill="url(#w-sky)" />
        {/* A scrim for the title, thin enough that the stars still show through it. */}
        <rect x="0" y="0" width="800" height="150" fill="url(#w-ceiling)" />

        {/* The sun, and the only light source in the frame. */}
        <circle cx="646" cy="78" r="120" fill="url(#w-sun)" />
        <circle cx="646" cy="78" r="26" fill="var(--world-sun)" />

        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="var(--world-star)" className="world-star" style={{ animationDelay: `${(i % 7) * 0.5}s` }} />
        ))}

        <Distance w={w} terrain={theme} />
        <Ground w={w} terrain={theme} />

        {/* The path. Its length is how far they have come, and it is the only thing that moves. */}
        <path
          d={`M118 ${pathY} Q ${(118 + pathEnd) / 2} ${pathY - 34 + Math.sin(w.level) * 8}, ${pathEnd} ${walkY}`}
          stroke="var(--world-path)"
          strokeWidth="13"
          strokeLinecap="round"
          fill="none"
          className="world-path"
          opacity={theme === "coast" ? 0.75 : 1}
        />

        {trees.map((t, i) => (
          <Canopy key={i} x={t.x} y={t.y} scale={t.scale} dark={i % 3 === 0} />
        ))}
        {plants.map((p, i) => (
          <Undergrowth key={i} x={p.x} y={p.y} scale={p.scale} />
        ))}

        <Landmarks n={w.landmarks} terrain={theme} />
        <Village show={w.level >= 6} terrain={theme} />
        <Visitors n={w.visitors} baseline={walkY} />
        <Home stage={w.home} terrain={theme} />
        {rest ? <Campfire /> : null}

        {/*
          The floor. A soft darkening across the bottom third so the title at the foot of the stage
          has somewhere to sit. It is part of the scene rather than an overlay on the frame,
          because the alternative is a grey band with a hard edge across a landscape.
        */}
        <rect x="0" y="210" width="800" height="130" fill="url(#w-floor)" />

        {/* Somebody standing at the end of the path they walked. */}
        <g transform={`translate(${Math.min(742, pathEnd)} ${walkY})`} className="world-walker">
          <circle cx="0" cy="-26" r="6.5" fill="var(--world-figure)" />
          <path d="M0 -19 L0 -6 M0 -16 L-7 -9 M0 -16 L7 -10 M0 -6 L-6 4 M0 -6 L6 4" stroke="var(--world-figure)" strokeWidth="3.4" strokeLinecap="round" fill="none" />
        </g>
      </g>
    </svg>
  );
}
