// The "ransom note" caption look: every letter cut from a different magazine, on its own torn
// paper scrap with its own colours, font and tilt. The choices come from the caption's text, so
// the preview, the animated layer and the export cut the same scraps. No Node or browser APIs
// here: the app, Remotion and the export all import it.

export type Tile = {
  ch: string;
  font: string;
  weight: number;
  paper: string;
  ink: string;
  /** Squared exercise-book paper. */
  grid: boolean;
  /** Degrees, clockwise. */
  rotate: number;
  /** Letter size against the caption's size. */
  scale: number;
  /** Shift up (negative) or down, in caption font sizes. */
  lift: number;
  /** The torn outline, as points from 0 to 1 across and down the scrap. */
  shape: [number, number][];
};

/** Fonts the letters are cut from (all ship with Creatro, so every side draws them alike). */
const FONTS: [family: string, weight: number][] = [
  ["DM Serif Display", 400],
  ["Archivo Black", 400],
  ["Poppins", 800],
  ["Anton", 400],
  ["Titan One", 400],
  ["Fjalla One", 400],
  ["Barlow Condensed Black Italic", 400],
];

/** Paper and ink pairs, like the cut-outs in a real ransom note. */
const PAPERS: [paper: string, ink: string, grid?: boolean][] = [
  ["#efe5cf", "#141414"],
  ["#f7f5ef", "#141414"],
  ["#1e2b52", "#f4f1ea"],
  ["#c62b2f", "#ffffff"],
  ["#f4b6c8", "#141414"],
  ["#f4b6c8", "#ffffff"],
  ["#dcc9a3", "#1b1b1b"],
  ["#efe5cf", "#1f4fbf"],
  ["#f7f5ef", "#2747a8"],
  ["#1a1a1a", "#f7f5ef"],
  ["#f7f6f1", "#141414", true],
];

/** Scrap size, in the letter's own font size. */
export const TILE = { height: 1.25, padX: 0.17, minWidth: 0.75 };
/** Spacing, in caption font sizes. */
export const GAP = { letter: 0.05, word: 0.4, line: 0.14 };
export const GRID_COLOR = "rgba(70, 110, 190, 0.35)";

/** The caption's words, each as its letters' scraps. */
export function ransomWords(text: string): Tile[][] {
  const rand = random(hash(text));
  let lastPaper = -1;
  let lastFont = -1;
  return text.split(/\s+/).filter(Boolean).map((word) =>
    [...word].map((ch) => {
      // Never the same paper or font twice in a row: that's what sells the cut-out look.
      const paper = pickOther(rand, PAPERS.length, lastPaper);
      const font = pickOther(rand, FONTS.length, lastFont);
      lastPaper = paper;
      lastFont = font;
      return {
        ch,
        font: FONTS[font][0],
        weight: FONTS[font][1],
        paper: PAPERS[paper][0],
        ink: PAPERS[paper][1],
        grid: Boolean(PAPERS[paper][2]),
        rotate: (rand() * 2 - 1) * 6,
        scale: 0.9 + rand() * 0.28,
        lift: (rand() * 2 - 1) * 0.06,
        shape: torn(rand),
      };
    }),
  );
}

/** A paper scrap's ragged edge: points along each side, nudged inwards at random. */
function torn(rand: () => number): [number, number][] {
  // Mostly straight scissor cuts, with now and then a torn bite.
  const n = 5;
  const bite = () => (rand() < 0.2 ? 0.02 + rand() * 0.035 : rand() * 0.012);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([i / n, bite()]);
  for (let i = 0; i < n; i++) pts.push([1 - bite(), i / n]);
  for (let i = 0; i < n; i++) pts.push([1 - i / n, 1 - bite()]);
  for (let i = 0; i < n; i++) pts.push([bite(), 1 - i / n]);
  return pts;
}

/** The scrap's outline as a CSS clip-path. */
export const clipPath = (shape: Tile["shape"]) => `polygon(${shape.map(([x, y]) => `${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`).join(",")})`;

const pickOther = (rand: () => number, n: number, not: number) => {
  const i = Math.floor(rand() * (n - 1));
  return not >= 0 && i >= not ? i + 1 : i;
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Seeded random numbers (mulberry32), so the same text always gets the same scraps. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
