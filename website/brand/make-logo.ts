// Draws Creatron's logo from numbers, so every file comes from one source: node website/brand/make-logo.ts
// Writes website/public/brand/: the mark, the wordmark lockups, the app icon and the favicon.
// Design notes: docs/DESIGN.md, "The logo".
//
// The mark, "the reel": twelve frames in a ring. Two are missing on the right, so the ring is a C and
// the opening is the cut. In the cut sits one red dot: the recording light, the playhead, the AI at work.
// The wordmark is drawn dot by dot on a 5 x 7 grid, from the same dots as the mark. No font is involved.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const n2 = (v: number) => Math.round(v * 100) / 100;

const INK = "#0A0A0A";
const WHITE = "#FFFFFF";
const RED = "#E5231B";

// The letters, one row per string, "#" is a dot. Drawn for Creatron; corners are left open so the
// round letters read round.
const GLYPHS: Record<string, string[]> = {
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
};

/** The measurements, in units of one dot pitch (the distance between two dot centres in a letter). */
const S = {
  dot: 0.84, // a dot's diameter
  ringDot: 0.98, // the ring's dots are a touch bigger: they are frames, the letters are pixels
  frames: 12, // dots in the full ring
  gap: 2, // frames left out on the right: the cut
  ringRadius: 3.4, // ring size, so the ring stands a little taller than the 6-pitch letters
  wordGap: 1, // empty columns between letters
  markGap: 3.2, // space between mark and word
};

type Dot = { x: number; y: number; r: number; red?: boolean };
type Ring = { frames: number; gap: number; red: "cut" | "centre"; dot: number };
export const RING: Ring = { frames: S.frames, gap: S.gap, red: "centre", dot: S.ringDot };
// Below 48 px the twelve frames blur together: the small mark keeps the shape with fewer, bigger dots.
export const SMALL_RING: Ring = { frames: 8, gap: 2, red: "centre", dot: 1.5 };

/** The mark's dots around 0, 0. */
function markDots(ring: Ring = RING): Dot[] {
  const dots: Dot[] = [];
  const step = (Math.PI * 2) / ring.frames;
  // An even gap sits half a step off the horizontal, so the frames left out flank the cut symmetrically.
  const offset = ring.gap % 2 ? 0 : step / 2;
  for (let i = 0; i < ring.frames; i++) {
    const a = offset + i * step; // 0 = right
    const along = ((a + Math.PI) % (Math.PI * 2)) - Math.PI; // -pi..pi, 0 = right
    if (Math.abs(along) < (ring.gap / 2) * step - 1e-6) continue;
    dots.push({ x: S.ringRadius * Math.cos(a), y: S.ringRadius * Math.sin(a), r: ring.dot / 2 });
  }
  dots.push(ring.red === "cut" ? { x: S.ringRadius, y: 0, r: ring.dot / 2, red: true } : { x: 0, y: 0, r: ring.dot / 2, red: true });
  return dots;
}

/** The word's dots, top-left at 0, 0 (the first letter's top-left dot centre). */
function wordDots(text = "CREATRON"): { dots: Dot[]; width: number } {
  const dots: Dot[] = [];
  let x = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    g.forEach((row, ry) => [...row].forEach((c, rx) => c === "#" && dots.push({ x: x + rx, y: ry, r: S.dot / 2 })));
    x += g[0].length + S.wordGap;
  }
  return { dots, width: x - S.wordGap - 1 };
}

const circles = (dots: Dot[], ink: string, red: string, k: number, dx: number, dy: number) =>
  dots.map((d) => `<circle cx="${n2(dx + d.x * k)}" cy="${n2(dy + d.y * k)}" r="${n2(d.r * k)}" fill="${d.red ? red : ink}"/>`).join("");

const svg = (w: number, h: number, inner: string, bg?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n2(w)} ${n2(h)}" width="${n2(w)}" height="${n2(h)}" role="img" aria-label="Creatron">${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ""}${inner}</svg>\n`;

/** The mark alone, edge to edge, `size` across. */
function markFile(ink: string, red: string, size = 100, ring: Ring = RING): string {
  const extent = S.ringRadius + ring.dot / 2;
  const k = size / (extent * 2);
  return svg(size, size, circles(markDots(ring), ink, red, k, size / 2, size / 2));
}

/** Mark and word on one line, sharing a pitch. Clear space: three ring gaps all round. */
function lockup(ink: string, red: string, ring: Ring = RING, pitch = 10): string {
  const word = wordDots();
  const extent = S.ringRadius + S.ringDot / 2;
  const pad = 3 * 1.6;
  const height = (extent * 2 + pad * 2) * pitch;
  const markX = (pad + extent) * pitch;
  const wordX = markX + (extent + S.markGap + S.dot / 2) * pitch;
  const wordY = height / 2 - 3 * pitch; // the letters' middle row on the ring's centre line
  const width = wordX + word.width * pitch + (S.dot / 2 + pad) * pitch;
  return svg(width, height, circles(markDots(ring), ink, red, pitch, markX, height / 2) + circles(word.dots, ink, red, pitch, wordX, wordY));
}

/** The word alone. */
function wordFile(ink: string, pitch = 10): string {
  const word = wordDots();
  const pad = S.dot;
  return svg((word.width + pad * 2) * pitch, (6 + pad * 2) * pitch, circles(word.dots, ink, ink, pitch, pad * pitch, pad * pitch));
}

/** A rounded square whose corners ease in like a Mac app icon's (a superellipse). */
function squircle(size: number): string {
  const r = size / 2;
  let d = "";
  for (let i = 0; i < 360; i += 2) {
    const t = (i * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    d += `${i ? "L" : "M"}${n2(r + r * Math.sign(c) * Math.abs(c) ** 0.4)} ${n2(r + r * Math.sign(s) * Math.abs(s) ** 0.4)}`;
  }
  return `${d}Z`;
}

/** The app icon: the white reel on ink, a faint frame grid behind it. */
function appIcon(size = 1024, ring: Ring = RING): string {
  const extent = S.ringRadius + ring.dot / 2;
  const k = (size * 0.56) / (extent * 2);
  const grid: string[] = [];
  const pitch = k * 1.6;
  if (size >= 128)
    for (let y = pitch / 2; y < size; y += pitch) for (let x = pitch / 2; x < size; x += pitch) grid.push(`<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(size / 400)}"/>`);
  const inner = `<clipPath id="sq"><path d="${squircle(size)}"/></clipPath><path d="${squircle(size)}" fill="${INK}"/><g clip-path="url(#sq)" fill="#ffffff" opacity="0.09">${grid.join("")}</g>${circles(markDots(ring), WHITE, RED, k, size / 2, size / 2)}`;
  return svg(size, size, inner);
}

const files: Record<string, string> = {
  "mark.svg": markFile(INK, RED),
  "mark-white.svg": markFile(WHITE, RED),
  "mark-black.svg": markFile(INK, INK),
  "mark-white-only.svg": markFile(WHITE, WHITE),
  "logo.svg": lockup(INK, RED),
  "logo-white.svg": lockup(WHITE, RED),
  "logo-black.svg": lockup(INK, INK),
  "logo-white-only.svg": lockup(WHITE, WHITE),
  "wordmark.svg": wordFile(INK),
  "wordmark-white.svg": wordFile(WHITE),
  "app-icon.svg": appIcon(),
  "favicon.svg": appIcon(64, SMALL_RING),
  "mark-small.svg": markFile(INK, RED, 100, SMALL_RING),
  "mark-small-white.svg": markFile(WHITE, RED, 100, SMALL_RING),
};

async function png(source: string, w: number, h = w): Promise<Buffer> {
  const c = createCanvas(w, h);
  c.getContext("2d").drawImage(await loadImage(Buffer.from(source)), 0, 0, w, h);
  return c.toBuffer("image/png");
}

/** Everything on one sheet, to judge it by eye: sizes, both backgrounds and the ring options. */
async function sheet(file: string) {
  const W = 1600;
  const H = 1060;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  const put = async (source: string, x: number, y: number, h: number) => {
    const img = await loadImage(Buffer.from(source));
    ctx.drawImage(img, x, y, (h * img.width) / img.height, h);
    return (h * img.width) / img.height;
  };
  ctx.fillStyle = "#F2F2F2";
  ctx.fillRect(0, 0, W / 2, H);
  ctx.fillStyle = INK;
  ctx.fillRect(W / 2, 0, W / 2, H);
  for (const [side, ink] of [[0, INK], [1, WHITE]] as const) {
    const ox = side * (W / 2) + 30;
    const rings: Ring[] = [RING, { ...RING, gap: 3 }, { frames: 10, gap: 2, red: "centre", dot: 1.1 }];
    for (const [row, ring] of rings.entries()) {
      let x = ox;
      for (const s of [150, 80, 48]) x += (await put(markFile(ink, RED, 100, ring), x, 30 + row * 160, s)) + 26;
      for (const s of [32, 24, 16]) x += (await put(markFile(ink, RED, 100, SMALL_RING), x, 30 + row * 160, s)) + 26;
    }
    let x = ox;
    for (const s of [180, 96, 48]) x += (await put(appIcon(1024), x, 520, s)) + 22;
    for (const s of [32, 16]) x += (await put(appIcon(64, SMALL_RING), x, 520, s)) + 22;
    await put(lockup(ink, RED), ox, 740, 110);
    await put(lockup(ink, RED, { ...RING, gap: 3 }), ox, 860, 80);
    await put(lockup(ink, RED), ox, 980, 40);
    await put(lockup(ink, RED), ox + 300, 990, 24);
  }
  writeFileSync(file, c.toBuffer("image/png"));
}

const at = process.argv.indexOf("--sheet");
if (at > 0) {
  await sheet(process.argv[at + 1]);
  console.log(`Sheet: ${process.argv[at + 1]}`);
} else {
  const out = join(import.meta.dirname, "../public/brand");
  mkdirSync(out, { recursive: true });
  for (const [name, source] of Object.entries(files)) writeFileSync(join(out, name), source);
  for (const size of [1024, 512, 180, 32]) writeFileSync(join(out, `app-icon-${size}.png`), await png(files["app-icon.svg"], size));
  console.log(`Logo files: ${out}`);
}
