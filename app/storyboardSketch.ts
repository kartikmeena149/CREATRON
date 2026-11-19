// A storyboard shot drawn the way a storyboard artist draws a panel: the real footage traced in
// pencil (contour strokes where the picture has edges, hatching for its shadows), the layout (titles,
// captions, cards) in marker on top, and every movement in red: the camera's move with the frame it
// ends on, how each title or picture comes in, where it travels. Without a picture (audio only, B-roll
// not found yet) the same pencil draws what the shot will be: the speaker, a landscape, a title card's
// guides. Same input, same drawing (seeded), so the board, the animatic and the PDF always match.
import type { Layer, Mark, Shot, Storyboard, Stroke } from "../src/storyboard.ts";

export const PAPER = "#f3efe6";
export const INK = "#1c1b1f";
const PENCIL = "#e5231b"; // Creatro's red: the recording light. On a storyboard, red is movement.

/**
 * Two ways to draw the same shot. "dark", in the app: white pencil on black paper, so the board sits
 * in Creatro's own dark interface. "paper", for the PDF: graphite on paper.
 */
const THEMES = {
  dark: {
    bg: "#0f0f0f", grain: "rgba(255,255,255,0.035)", lead: "#e4e4e4", line: "#9a9a9a", plate: "rgba(0,0,0,0.8)", plateText: "#f2f2f2",
    fade: "rgba(15,15,15,0.72)", red: "#ff4136", halo: "rgba(15,15,15,0.85)", light: true,
  },
  paper: {
    bg: PAPER, grain: "rgba(60,50,30,0.06)", lead: "#2a292e", line: INK, plate: "rgba(28,27,31,0.88)", plateText: PAPER,
    fade: "rgba(243,239,230,0.72)", red: PENCIL, halo: "rgba(243,239,230,0.9)", light: false,
  },
};
export type SketchTheme = keyof typeof THEMES;
let T = THEMES.dark;

/** Width / height of a frame in this format. */
export const aspect = (format: Storyboard["format"]) => ({ "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1, "4:5": 4 / 5 })[format];

/** The board's accent: its brightest, most saturated palette colour (a red pencil without one). */
export function accentOf(b: Storyboard): string {
  let best = PENCIL;
  let score = -1;
  for (const c of b.look.palette) {
    const [r, g, bl] = rgb(c);
    const max = Math.max(r, g, bl);
    const s = max ? (max - Math.min(r, g, bl)) / max : 0;
    if (s * (max / 255) > score) (score = s * (max / 255)), (best = c);
  }
  return score > 0.25 ? best : PENCIL;
}

/** The outline that keeps a colour readable on paper: dark ink around light colours, paper around dark ones. */
function edge(c: string): string {
  const [r, g, b] = rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? INK : PAPER;
}

function rgb(c: string): [number, number, number] {
  let h = c.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A small seeded random, so a shot always draws the same way. */
function rand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

type Box = { x: number; y: number; w: number; h: number };
/** What's already on the frame that a label mustn't cover: titles, captions, stickers, cards, charts, other labels. */
let taken: Box[] = [];
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** How much a drawing this size can say: a thumbnail draws the picture only, a card adds the movement, a big view adds notes. */
const sizeOf = (w: number, h: number) => {
  const m = Math.min(w, h);
  return { motion: m >= 50, labels: m >= 110, notes: m >= 230 };
};

/**
 * Draws one shot into the canvas (sized w x h in CSS pixels, drawn at `scale` for sharpness).
 * `picture` is the frame the shot is made from, if there is one.
 */
export function drawShot(canvas: HTMLCanvasElement, w: number, h: number, scale: number, shot: Shot, board: Storyboard, picture: HTMLImageElement | null, theme: SketchTheme = "dark") {
  T = THEMES[theme];
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const r = rand(shot.id + shot.kind);
  const accent = accentOf(board);
  const size = sizeOf(w, h);
  taken = shot.layers
    .filter((l) => l.kind !== "box" && l.kind !== "arrow")
    .map((l) => ({ x: l.x * w, y: l.y * h, w: l.w * w, h: l.h * h }));

  // Paper: a little grain and a few fibres.
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = T.grain;
  for (let i = 0; i < (w * h) / 70; i++) ctx.fillRect(r() * w, r() * h, 1, 1);

  // The picture: a frame of the footage traced in pencil; without one, Claude's own drawing of the
  // shot (shot.sketch); without that either (older storyboards), a drawn stand-in, never a blob.
  const kind = shot.kind;
  const drawn = shot.sketch?.length ? shot.sketch : null;
  if (picture && kind === "split") {
    pencil(ctx, 0, 0, w, h / 2, shot.source?.file !== "main" ? sampler(picture, w, h / 2) : () => 0, r);
    if (shot.source?.file === "main") pencil(ctx, 0, h / 2, w, h / 2, sampler(picture, w, h / 2), r);
    else if (!drawn) strokes(ctx, 0, h / 2, w, h / 2, bust(w, h / 2), r);
    if (drawn) strokes(ctx, 0, 0, w, h, drawn, r);
    wobblyLine(ctx, 0, h / 2, w, h / 2, r, T.lead, 1.4);
  } else if (kind === "cutout") {
    // The speaker cut out over a designed background: an accent wash, then them.
    wash(ctx, w, h, accent, r);
    if (picture) pencil(ctx, 0, 0, w, h, masked(sampler(picture, w, h), silhouette(0.5, 0.5)), r);
    else strokes(ctx, 0, 0, w, h, drawn ?? bust(w, h), r);
  } else if (picture && kind !== "text" && kind !== "graphic") {
    pencil(ctx, 0, 0, w, h, sampler(picture, w, h), r);
  } else if (drawn) {
    if (kind === "text" || kind === "graphic") guides(ctx, w, h, r);
    strokes(ctx, 0, 0, w, h, drawn, r);
  } else if (kind === "text" || kind === "graphic") {
    guides(ctx, w, h, r);
  } else if (kind === "talking") {
    strokes(ctx, 0, 0, w, h, bust(w, h), r);
  } else if (kind === "split") {
    insert(ctx, 0, 0, w, h / 2, r);
    strokes(ctx, 0, h / 2, w, h / 2, bust(w, h / 2), r);
    wobblyLine(ctx, 0, h / 2, w, h / 2, r, T.lead, 1.4);
  } else {
    insert(ctx, 0, 0, w, h, r); // B-roll still to find: the storyboard's "picture goes here"
  }

  // B-roll not found yet: say what it must show.
  // Low in the frame, else at the top, wherever no title or caption is; left out when neither is
  // free (the card says it's B-roll, and the shot's view says what it must show).
  if ((kind === "broll" || kind === "image") && !picture && shot.query) {
    const th = Math.max(7, Math.min(11, (w * 0.92) / 14)) + 8;
    const spot = [h * 0.9, h * 0.035].find((y) => !taken.some((t) => overlaps(t, { x: w * 0.04, y, w: w * 0.92, h: th })));
    if (spot !== undefined) {
      tagAt(ctx, w * 0.04, spot, w * 0.92, `${kind === "broll" ? "B-ROLL" : "IMAGE"} · ${shot.query}`);
      taken.push({ x: w * 0.04, y: spot, w: w * 0.92, h: th });
    }
  }

  for (const l of shot.layers) layer(ctx, w, h, l, board, accent, r, picture);
  if (size.motion) {
    for (const l of shot.layers) motion(ctx, w, h, l, r, size.labels);
    camera(ctx, w, h, shot, r, size.notes); // a card names its camera move under the picture already
  }
  if (size.notes) for (const l of shot.layers) if (l.note?.trim()) note(ctx, w, h, l, r);

  // What the user drew on it, over everything.
  if (shot.marks?.length) drawMarks(ctx, w, h, scale, shot.marks, theme);

  // The panel's own pencil border.
  ctx.globalAlpha = 0.5;
  roughRect(ctx, 1.5, 1.5, w - 3, h - 3, r, T.lead, 0.9);
  ctx.globalAlpha = 1;

  if (shot.dropped) {
    ctx.fillStyle = T.fade;
    ctx.fillRect(0, 0, w, h);
    wobblyLine(ctx, w * 0.12, h * 0.12, w * 0.88, h * 0.88, r, T.red, 3);
    wobblyLine(ctx, w * 0.88, h * 0.12, w * 0.12, h * 0.88, r, T.red, 3);
  }
}

// ---- pencil ----

type Field = (x: number, y: number) => number; // 0 = bare paper, 1 = full pencil; x and y in 0..1

/**
 * A picture in pencil. Its tones become hatching (one set of lines, then crossed, then dense, the
 * darker it gets) and its edges become contour strokes along them, darker where the edge is
 * stronger, the way an artist traces a frame.
 */
function pencil(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, field: Field, r: () => number) {
  const m = Math.min(w, h);
  const step = Math.max(1.4, m / 110); // pixels per sample
  const gw = Math.max(16, Math.round(w / step));
  const gh = Math.max(16, Math.round(h / step));
  const g = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) g[j * gw + i] = Math.min(1, Math.max(0, field((i + 0.5) / gw, (j + 0.5) / gh)));
  const at = (px: number, py: number) => g[Math.min(gh - 1, Math.max(0, Math.floor(py / step))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(px / step)))]!;
  const thin = Math.max(0.45, m / 300);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.strokeStyle = T.lead;
  ctx.lineCap = "round";

  // Hatching: each tone level is a set of parallel lines, lifted where the picture is lighter.
  const gap = Math.max(2.2, m / 62);
  const levels = [
    { over: 0.42, angle: Math.PI * 0.27, alpha: 0.26, gap: gap * 1.15 },
    { over: 0.66, angle: -Math.PI * 0.22, alpha: 0.24, gap: gap * 1.25 },
    { over: 0.86, angle: Math.PI * 0.03, alpha: 0.3, gap: gap * 0.9 },
  ];
  const diag = Math.hypot(w, h);
  for (const L of levels) {
    const dx = Math.cos(L.angle);
    const dy = Math.sin(L.angle);
    ctx.beginPath();
    for (let k = -diag / 2; k <= diag / 2; k += L.gap) {
      const ox = w / 2 - dy * k + (r() - 0.5) * L.gap * 0.35;
      const oy = h / 2 + dx * k + (r() - 0.5) * L.gap * 0.35;
      const sway = (r() - 0.5) * 0.02; // a hand's lines are never quite parallel
      let on = false;
      let lx = 0;
      let ly = 0;
      for (let s = -diag / 2; s <= diag / 2; s += 1.6) {
        const px = ox + (dx + sway * dy) * s;
        const py = oy + (dy - sway * dx) * s;
        const inside = px >= 0 && py >= 0 && px < w && py < h;
        const ink = inside && at(px, py) > L.over + (r() - 0.5) * 0.08;
        if (ink && !on) ctx.moveTo(x0 + px, y0 + py), (on = true);
        else if (!ink && on) ctx.lineTo(x0 + lx, y0 + ly), (on = false);
        lx = px;
        ly = py;
      }
      if (on) ctx.lineTo(x0 + lx, y0 + ly);
    }
    ctx.globalAlpha = L.alpha;
    ctx.lineWidth = thin;
    ctx.stroke();
  }

  // Contours: short strokes along the edges (Sobel), only the strongest ones, in two weights.
  const mag = new Float32Array(gw * gh);
  const dir = new Float32Array(gw * gh);
  for (let j = 1; j < gh - 1; j++) {
    for (let i = 1; i < gw - 1; i++) {
      const v = (a: number, b: number) => g[(j + b) * gw + (i + a)]!;
      const gx = v(1, -1) + 2 * v(1, 0) + v(1, 1) - v(-1, -1) - 2 * v(-1, 0) - v(-1, 1);
      const gy = v(-1, 1) + 2 * v(0, 1) + v(1, 1) - v(-1, -1) - 2 * v(0, -1) - v(1, -1);
      mag[j * gw + i] = Math.hypot(gx, gy);
      dir[j * gw + i] = Math.atan2(gy, gx) + Math.PI / 2; // along the edge, not across it
    }
  }
  const sorted = Float32Array.from(mag).sort();
  const firm = Math.max(0.3, sorted[Math.floor(sorted.length * 0.8)]!);
  const bold = Math.max(0.75, sorted[Math.floor(sorted.length * 0.94)]!);
  for (const [lo, hi, alpha, width] of [[firm, bold, 0.55, thin * 1.3], [bold, Infinity, 0.9, thin * 1.8]] as const) {
    ctx.beginPath();
    for (let j = 1; j < gh - 1; j++) {
      for (let i = 1; i < gw - 1; i++) {
        const k = j * gw + i;
        if (mag[k]! < lo || mag[k]! >= hi || r() > 0.8) continue;
        const a = dir[k]! + (r() - 0.5) * 0.25;
        const len = step * (1.1 + r() * 0.9);
        const cx = x0 + (i + 0.5) * step + (r() - 0.5) * step * 0.4;
        const cy = y0 + (j + 0.5) * step + (r() - 0.5) * step * 0.4;
        ctx.moveTo(cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2);
        ctx.lineTo(cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2);
      }
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Brightness (dark theme: white pencil draws the light) or darkness (paper) of a picture, fitted to cover a w x h frame. */
function sampler(img: HTMLImageElement, w: number, h: number): Field {
  const cols = 160;
  const rows = Math.max(1, Math.round((cols * h) / w));
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const s = Math.max(cols / img.naturalWidth, rows / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  g.drawImage(img, (cols - dw) / 2, (rows - dh) / 2, dw, dh);
  const data = g.getImageData(0, 0, cols, rows).data;
  // Stretch the contrast (ignoring the extreme 2% each side) so dark footage still draws.
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  const sorted = Float32Array.from(lum).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)]!;
  const hi = sorted[Math.floor(sorted.length * 0.98)]!;
  const span = Math.max(40, hi - lo);
  return (x, y) => {
    const fx = Math.min(cols - 1.001, Math.max(0, x * cols - 0.5));
    const fy = Math.min(rows - 1.001, Math.max(0, y * rows - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const p = (a: number, b: number) => lum[(j + b) * cols + (i + a)] ?? lum[j * cols + i]!;
    const v = ((p(0, 0) * (1 - tx) + p(1, 0) * tx) * (1 - ty) + (p(0, 1) * (1 - tx) + p(1, 1) * tx) * ty - lo) / span;
    const t = Math.min(1, Math.max(0, v));
    return T.light ? t : 1 - t;
  };
}

/** Whether (x, y) is inside a chest-up silhouette centred at (cx, cy). */
const silhouette = (cx: number, cy: number) => (x: number, y: number) => {
  const head = ((x - cx) / 0.17) ** 2 + ((y - (cy - 0.13)) / 0.115) ** 2;
  const neck = Math.abs(x - cx) < 0.06 && y > cy - 0.04 && y < cy + 0.06 ? 0 : 2;
  const body = ((x - cx) / 0.4) ** 2 + ((y - (cy + 0.3)) / 0.26) ** 2;
  return Math.min(head, neck, body) < 1;
};

/** The picture only inside `inside` (the speaker over a designed background). */
const masked = (picture: Field, inside: (x: number, y: number) => boolean): Field => (x, y) => (inside(x, y) ? Math.max(0.2, picture(x, y)) : 0);

/** A designed background: soft diagonal strokes in the accent. */
function wash(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, r: () => number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = Math.max(3, Math.min(w, h) / 30);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let k = -h; k < w; k += ctx.lineWidth * 1.6) {
    ctx.moveTo(k + r() * 4, h + 4);
    ctx.lineTo(k + h * 0.9 + r() * 4, -4);
  }
  ctx.stroke();
  ctx.restore();
}

/** A title card's page: the artist's construction lines (thirds, a centre line), barely there. */
function guides(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number) {
  ctx.globalAlpha = 0.18;
  for (const f of [1 / 3, 2 / 3]) {
    wobblyLine(ctx, w * f, h * 0.04, w * f, h * 0.96, r, T.lead, 0.7);
    wobblyLine(ctx, w * 0.04, h * f, w * 0.96, h * f, r, T.lead, 0.7);
  }
  ctx.globalAlpha = 1;
}

// ---- drawn strokes ----

/**
 * Strokes in units where the box (x0, y0, w, h) is 1000 wide (see Stroke), drawn the way a pencil
 * does: the line, then a lighter second pass a hair beside it; closed shapes with a `shade` hatched
 * inside (crossed when dark). Kept inside the box.
 */
function strokes(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, list: Stroke[], r: () => number) {
  const k = w / 1000;
  const m = Math.min(w, h);
  const line = Math.max(0.9, m / 200);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.translate(x0, y0);
  ctx.scale(k, k);
  ctx.strokeStyle = T.lead;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of list) {
    let p: Path2D;
    try {
      p = new Path2D(s.d);
    } catch {
      continue; // not a path: skip it, keep the drawing
    }
    if (s.shade) {
      ctx.save();
      ctx.clip(p);
      const gap = Math.max(2.2, m / 55) * (1.55 - s.shade) / k;
      const tall = (h / k) * 1.5 + 1000;
      ctx.beginPath();
      for (let t = -tall; t < tall; t += gap) ctx.moveTo(t, 0), ctx.lineTo(t + tall, tall);
      if (s.shade > 0.6) for (let t = -tall; t < tall * 2; t += gap * 1.3) ctx.moveTo(t, 0), ctx.lineTo(t - tall, tall);
      ctx.lineWidth = (line * 0.55) / k;
      ctx.globalAlpha = 0.28 + s.shade * 0.3;
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = line / k;
    ctx.globalAlpha = 0.95;
    ctx.stroke(p);
    // Over it again, a little off: a hand never retraces exactly.
    ctx.save();
    ctx.translate(((r() - 0.5) * 2.2) / k, ((r() - 0.5) * 2.2) / k);
    ctx.lineWidth = (line * 0.6) / k;
    ctx.globalAlpha = 0.38;
    ctx.stroke(p);
    ctx.restore();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * A person from the chest up, as a storyboard artist sketches one: head and jaw, hair, ears, eyes,
 * brows, nose, mouth, neck, collar and shoulders, sized to stand at the bottom of a w x h box.
 */
function bust(w: number, h: number): Stroke[] {
  // Drawn in a 1000 x 1000 box, then placed: as wide as fits, feet of the box on the frame's bottom.
  const H = (1000 * h) / w;
  const s = Math.min(0.95, (H * 0.92) / 1000);
  const dx = 500 - 500 * s;
  const dy = H - 1000 * s;
  const at = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${round1(dx + Number(x) * s)} ${round1(dy + Number(y) * s)}`);
  return [
    { d: at("M120 1000 C130 760 230 655 452 588 L500 645 L550 588 C770 655 870 760 880 1000"), shade: 0.3 },
    { d: at("M452 588 L500 700 L550 588") },
    { d: at("M455 498 L452 590 M545 498 L550 590") },
    { d: at("M378 322 C374 175 440 142 500 142 C570 142 628 178 624 322 C620 425 584 498 500 507 C416 498 381 425 378 322 Z") },
    { d: at("M370 305 C360 150 440 105 505 108 C592 110 648 168 633 305 C612 228 560 200 505 206 C455 210 410 238 370 305 Z"), shade: 0.75 },
    { d: at("M380 305 C352 300 347 358 384 372 M620 305 C648 300 653 358 616 372") },
    { d: at("M432 292 C450 282 468 282 482 290 M520 290 C534 282 552 282 570 292") },
    { d: at("M442 322 C452 316 466 316 476 322 M526 322 C536 316 550 316 560 322") },
    { d: at("M501 335 L492 398 C498 404 508 405 514 400") },
    { d: at("M466 442 C482 452 518 452 536 442") },
  ];
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A frame still to fill (B-roll not found yet): the storyboard's crossed box, in faint pencil. */
function insert(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number) {
  const p = Math.min(w, h) * 0.12;
  ctx.globalAlpha = 0.35;
  roughRect(ctx, x + p, y + p, w - 2 * p, h - 2 * p, r, T.lead, 1);
  wobblyLine(ctx, x + p, y + p, x + w - p, y + h - p, r, T.lead, 0.9);
  wobblyLine(ctx, x + w - p, y + p, x + p, y + h - p, r, T.lead, 0.9);
  ctx.globalAlpha = 1;
}

// ---- marker ----

function wobblyLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: () => number, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  const base = ctx.globalAlpha;
  for (let pass = 0; pass < 2; pass++) {
    const j = () => (r() - 0.5) * 1.4;
    ctx.beginPath();
    ctx.moveTo(x1 + j(), y1 + j());
    ctx.quadraticCurveTo((x1 + x2) / 2 + j() * 1.5, (y1 + y2) / 2 + j() * 1.5, x2 + j(), y2 + j());
    ctx.globalAlpha = base * (pass ? 0.4 : 1);
    ctx.stroke();
  }
  ctx.globalAlpha = base;
}

function roughRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number, color: string, width = 1.6) {
  wobblyLine(ctx, x, y, x + w, y, r, color, width);
  wobblyLine(ctx, x + w, y, x + w, y + h, r, color, width);
  wobblyLine(ctx, x + w, y + h, x, y + h, r, color, width);
  wobblyLine(ctx, x, y + h, x, y, r, color, width);
}

function dashedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number, color: string, width: number, dash = [5, 4]) {
  ctx.setLineDash(dash);
  roughRect(ctx, x, y, w, h, r, color, width);
  ctx.setLineDash([]);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(rad, w / 2, h / 2));
}

/** Text fitted into a box: as big as fits, on up to three lines. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, weight: number, family: string, fill: string, stroke?: string, align: CanvasTextAlign = "center") {
  const words = text.trim().split(/\s+/);
  for (let size = Math.min(h * 0.9, w * 0.35); size >= 6; size *= 0.9) {
    ctx.font = `${weight} ${size}px ${family}`;
    const lines: string[] = [];
    let line = "";
    for (const wd of words) {
      const next = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(next).width > w && line) lines.push(line), (line = wd);
      else line = next;
    }
    if (line) lines.push(line);
    const lh = size * 1.05;
    if (lines.length * lh > h || lines.some((l) => ctx.measureText(l).width > w) || lines.length > 3) continue;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    const top = y + (h - lines.length * lh) / 2 + lh / 2;
    const ax = align === "center" ? x + w / 2 : x;
    lines.forEach((l, i) => {
      if (stroke) {
        ctx.lineWidth = Math.max(2, size * 0.16);
        ctx.lineJoin = "round";
        ctx.strokeStyle = stroke;
        ctx.strokeText(l, ax, top + i * lh);
      }
      ctx.fillStyle = fill;
      ctx.fillText(l, ax, top + i * lh);
    });
    return;
  }
}

const SANS = '"SF Pro Display", "Helvetica Neue", system-ui, sans-serif';
/** A storyboard artist's capitals, for the notes and the movement labels. */
const HAND = '"Marker Felt", "Chalkboard SE", "Bradley Hand", "Comic Sans MS", cursive';
const fontOf = (b: Storyboard) => `"${b.look.font.replace(/"/g, "")}", ${SANS}`;

function layer(ctx: CanvasRenderingContext2D, w: number, h: number, l: Layer, b: Storyboard, accent: string, r: () => number, picture: HTMLImageElement | null) {
  const x = l.x * w;
  const y = l.y * h;
  const lw = Math.max(l.w * w, 8);
  const lh = Math.max(l.h * h, 8);
  const color = l.color && /^#/.test(l.color) ? l.color : accent;
  switch (l.kind) {
    case "text":
      fitText(ctx, (l.text || "TITLE").toUpperCase(), x, y, lw, lh, 900, fontOf(b), color, edge(color));
      break;
    case "caption": {
      roundRect(ctx, x, y, lw, lh, lh * 0.35);
      ctx.fillStyle = T.plate;
      ctx.fill();
      fitText(ctx, l.text || "caption", x + lh * 0.3, y + lh * 0.12, lw - lh * 0.6, lh * 0.76, 800, SANS, T.plateText);
      break;
    }
    case "image":
    case "footage": {
      ctx.save();
      roundRect(ctx, x, y, lw, lh, 6);
      ctx.fillStyle = T.bg;
      ctx.fill();
      ctx.restore();
      // A card of the speaker shows them; any other card without a picture is a frame to fill.
      const speaker = l.kind === "footage" && /speaker|camera|face|host|presenter|\b(me|you|him|her)\b/i.test(l.text ?? "");
      if (l.kind === "footage" && picture && speaker) pencil(ctx, x, y, lw, lh, sampler(picture, lw, lh), r);
      else if (speaker) strokes(ctx, x, y, lw, lh, bust(lw, lh), r);
      else insert(ctx, x, y, lw, lh, r);
      ctx.setLineDash(l.kind === "image" ? [5, 4] : []);
      roughRect(ctx, x, y, lw, lh, r, T.line, 1.4);
      ctx.setLineDash([]);
      if (l.text) tagAt(ctx, x + 4, y + 4, lw - 8, l.text);
      break;
    }
    case "box":
      roughRect(ctx, x, y, lw, lh, r, color, 2.4);
      if (l.text) fitText(ctx, l.text, x, y + lh + 2, lw, Math.min(18, h * 0.05), 700, SANS, color, edge(color));
      break;
    case "arrow": {
      arrow(ctx, x, y, x + lw, y + lh, r, color, 3, 0.12);
      if (l.text) fitText(ctx, l.text, x - lw * 0.2, y - 18, lw * 0.9, 16, 800, SANS, color, edge(color), "left");
      break;
    }
    case "sticker": {
      const rad = Math.min(lw, lh) / 2;
      ctx.beginPath();
      ctx.arc(x + lw / 2, y + lh / 2, rad, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = T.bg;
      ctx.stroke();
      fitText(ctx, l.text || "★", x + rad * 0.3, y + rad * 0.3, lw - rad * 0.6, lh - rad * 0.6, 900, SANS, "#ffffff");
      break;
    }
    case "chart": {
      roughRect(ctx, x, y, lw, lh, r, T.lead, 1.2);
      const bars = 4;
      for (let i = 0; i < bars; i++) {
        const bh = lh * (0.25 + (0.65 * (i + 1)) / bars) * (0.85 + r() * 0.15);
        const bw = (lw / bars) * 0.55;
        const bx = x + (lw / bars) * i + bw * 0.4;
        if (i === bars - 1) {
          ctx.fillStyle = color;
          ctx.fillRect(bx, y + lh - bh - 2, bw, bh);
        } else {
          roughRect(ctx, bx, y + lh - bh - 2, bw, bh, r, T.lead, 1);
          hatch(ctx, bx, y + lh - bh - 2, bw, bh, T.lead, r);
        }
      }
      if (l.text) fitText(ctx, l.text, x, y - 18, lw, 16, 800, SANS, T.lead, T.bg);
      break;
    }
  }
}

/** Quick diagonal shading inside a small box (chart bars). */
function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, r: () => number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let k = -h; k < w; k += 3) ctx.moveTo(x + k + r(), y + h), ctx.lineTo(x + k + h + r(), y);
  ctx.stroke();
  ctx.restore();
}

/** A label stuck on the frame (B-roll still to be found). */
function tagAt(ctx: CanvasRenderingContext2D, x: number, y: number, maxW: number, text: string) {
  const size = Math.max(7, Math.min(11, maxW / 14));
  ctx.font = `600 ${size}px "SF Mono", Menlo, monospace`;
  let t = text.toUpperCase();
  while (t.length > 4 && ctx.measureText(t).width > maxW - 10) t = `${t.slice(0, -2)}…`;
  const tw = ctx.measureText(t).width;
  ctx.fillStyle = T.plate;
  ctx.fillRect(x, y, tw + 10, size + 8);
  ctx.fillStyle = T.plateText;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(t, x + 5, y + (size + 8) / 2 + 0.5);
}

// ---- movement (red) ----

/**
 * A hand-drawn arrow from (x1, y1) to (x2, y2), bowed sideways by `bend` (a fraction of its length),
 * with an open head along its last direction.
 */
function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: () => number, color: string, width: number, bend = 0) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 3) return;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const cx = (x1 + x2) / 2 + nx * len * bend;
  const cy = (y1 + y2) / 2 + ny * len * bend;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let pass = 0; pass < 2; pass++) {
    const j = () => (r() - 0.5) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x1 + j(), y1 + j());
    ctx.quadraticCurveTo(cx + j(), cy + j(), x2, y2);
    ctx.globalAlpha = pass ? 0.4 : 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const a = Math.atan2(y2 - cy, x2 - cx);
  const s = Math.max(4, Math.min(len * 0.35, width * 3.6));
  ctx.beginPath();
  ctx.moveTo(x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45));
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45));
  ctx.stroke();
}

/**
 * A hand-lettered label with a halo, so it reads over the drawing. Kept inside the frame and off
 * titles, captions and other labels: it tries a few spots near where it's asked for, and is left out
 * when none is free (a clear panel beats a complete one).
 */
function label(ctx: CanvasRenderingContext2D, w: number, h: number, text: string, x: number, y: number, color: string, size: number, align: CanvasTextAlign = "left") {
  ctx.font = `${size}px ${HAND}`;
  const tw = ctx.measureText(text).width;
  const left = align === "center" ? x - tw / 2 : align === "right" ? x - tw : x;
  const spot = (dx: number, dy: number) => {
    const lx = Math.min(w - tw - 3, Math.max(3, left + dx));
    const ly = Math.min(h - size * 0.7, Math.max(size * 0.7, y + dy));
    return { lx, ly, box: { x: lx - 2, y: ly - size * 0.6, w: tw + 4, h: size * 1.2 } };
  };
  const tries = [[0, 0], [0, size * 1.3], [0, -size * 1.3], [0, size * 2.6], [0, -size * 2.6], [-tw * 0.6, 0], [tw * 0.6, 0]];
  const free = tries.map(([dx, dy]) => spot(dx!, dy!)).find((p) => !taken.some((t) => overlaps(t, p.box)));
  if (!free) return;
  taken.push(free.box);
  const { lx, ly } = free;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2.5, size * 0.35);
  ctx.strokeStyle = T.halo;
  ctx.strokeText(text, lx, ly);
  ctx.fillStyle = color;
  ctx.fillText(text, lx, ly);
}

/** How a layer comes in, or where it goes: a ghost of where it starts or ends, and the arrow between. */
function motion(ctx: CanvasRenderingContext2D, w: number, h: number, l: Layer, r: () => number, labels: boolean) {
  const x = l.x * w;
  const y = l.y * h;
  const lw = Math.max(l.w * w, 8);
  const lh = Math.max(l.h * h, 8);
  const m = Math.min(w, h);
  const red = T.red;
  const stroke = Math.max(1.3, m / 110);
  const fs = Math.max(8, Math.min(13, m / 14));
  const under = y + lh + fs * 0.9 < h ? y + lh + fs * 0.8 : y - fs * 0.7; // where its label goes
  const cx = x + lw / 2;
  const cy = y + lh / 2;

  if (l.to) {
    // It travels: dashed where it ends, a bowed arrow from here to there.
    const tx = l.to.x * w;
    const ty = l.to.y * h;
    dashedRect(ctx, tx, ty, lw, lh, r, red, stroke * 0.8, [4, 4]);
    arrow(ctx, cx, cy, tx + lw / 2, ty + lh / 2, r, red, stroke, 0.18);
    if (labels) label(ctx, w, h, "MOVES", (cx + tx + lw / 2) / 2, (cy + ty + lh / 2) / 2 - fs, red, fs, "center");
  }

  switch (l.enter) {
    case "from-left":
    case "from-right":
    case "from-top":
    case "from-bottom": {
      // Speed lines trailing on the side it comes from, and an arrow beside it (never through it).
      // A dashed ghost of where it starts, when enough of that would be on the frame to read.
      const [dx, dy] = l.enter === "from-left" ? [-1, 0] : l.enter === "from-right" ? [1, 0] : l.enter === "from-top" ? [0, -1] : [0, 1];
      const gx = x + dx * lw * 0.75;
      const gy = y + dy * lh * 1.15;
      const seen = (Math.max(0, Math.min(w, gx + lw) - Math.max(0, gx)) * Math.max(0, Math.min(h, gy + lh) - Math.max(0, gy))) / (lw * lh);
      if (seen > 0.45) {
        ctx.globalAlpha = 0.7;
        dashedRect(ctx, gx, gy, lw, lh, r, red, stroke * 0.7, [3, 4]);
        ctx.globalAlpha = 1;
      }
      const gapPx = m * 0.025;
      for (let i = 0; i < 3; i++) {
        const t = 0.25 + i * 0.25;
        const len = m * (0.05 + r() * 0.035);
        // At the trailing edge, outside the layer (inside the frame).
        const sx = dx ? (dx < 0 ? Math.max(len + 2, x - gapPx) : Math.min(w - len - 2, x + lw + gapPx)) : x + lw * t;
        const sy = dy ? (dy < 0 ? Math.max(len + 2, y - gapPx) : Math.min(h - len - 2, y + lh + gapPx)) : y + lh * t;
        wobblyLine(ctx, sx, sy, sx + dx * len, sy + dy * len, r, red, stroke * 0.8);
      }
      if (dx) {
        // Under the layer (over it when it sits at the bottom): from its trailing side, in the direction it travels.
        const ay = y + lh + m * 0.035 < h - 4 ? y + lh + m * 0.035 : y - m * 0.035;
        const from = dx < 0 ? x + lw * 0.2 : x + lw * 0.8;
        arrow(ctx, from, ay, from - dx * lw * 0.45, ay, r, red, stroke * 1.2, 0);
        taken.push({ x: Math.min(from, from - dx * lw * 0.45) - 4, y: ay - 6, w: lw * 0.45 + 8, h: 12 });
      } else {
        const ax = x + lw + m * 0.035 < w - 4 ? x + lw + m * 0.035 : x - m * 0.035;
        const from = dy < 0 ? y + lh * 0.1 : y + lh * 0.9;
        arrow(ctx, ax, from, ax, from - dy * Math.max(lh * 0.8, m * 0.08), r, red, stroke * 1.2, 0);
      }
      break;
    }
    case "pop": {
      // Burst marks around it.
      const rx = lw / 2 + m * 0.03;
      const ry = lh / 2 + m * 0.03;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.3;
        const k = 1 + r() * 0.12;
        wobblyLine(ctx, cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, cx + Math.cos(a) * (rx * k + m * 0.045), cy + Math.sin(a) * (ry * k + m * 0.045), r, red, stroke);
      }
      if (labels) label(ctx, w, h, "POP!", x + lw + 2, y - fs * 0.2, red, fs);
      break;
    }
    case "zoom": {
      // It grows from small: arrows out of its corners, outside it (never across its words).
      const k = m * 0.06;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const ox = sx < 0 ? x - 2 : x + lw + 2;
        const oy = sy < 0 ? y - 2 : y + lh + 2;
        arrow(ctx, ox, oy, ox + sx * k, oy + sy * k * 0.8, r, red, stroke, 0);
      }
      if (labels) label(ctx, w, h, "GROWS IN", cx, under + fs * 0.4, red, fs, "center");
      break;
    }
    case "fade":
      dashedRect(ctx, x - 3, y - 3, lw + 6, lh + 6, r, red, stroke * 0.7, [1.2, 3.5]);
      if (labels) label(ctx, w, h, "FADES IN", cx, under, red, fs, "center");
      break;
    case "type": {
      // A cursor at the end of the line.
      const tx = Math.min(w - 4, x + lw + 2);
      wobblyLine(ctx, tx, y + lh * 0.15, tx, y + lh * 0.85, r, red, stroke * 1.4);
      if (labels) label(ctx, w, h, "TYPES ON", cx, under, red, fs, "center");
      break;
    }
    case "draw":
      if (labels) label(ctx, w, h, "DRAWS ON", cx, under, red, fs, "center");
      break;
  }
}

/** The camera's move: the frame it ends on (aimed at the shot's focus) and how it gets there. */
function camera(ctx: CanvasRenderingContext2D, w: number, h: number, shot: Shot, r: () => number, labels: boolean) {
  const move = shot.camera;
  if (move === "still") return;
  const red = T.red;
  const m = Math.min(w, h);
  const stroke = Math.max(1.4, m / 100);
  const fs = Math.max(8, Math.min(14, m / 13));
  const fx = (shot.focus?.x ?? 0.5) * w;
  const fy = (shot.focus?.y ?? 0.5) * h;
  /** A frame of `k` the size, centred on the focus, kept inside the picture. */
  const inner = (k: number) => {
    const iw = w * k;
    const ih = h * k;
    return { x: Math.min(w - iw - 2, Math.max(2, fx - iw / 2)), y: Math.min(h - ih - 2, Math.max(2, fy - ih / 2)), w: iw, h: ih };
  };
  const corners = (b: { x: number; y: number; w: number; h: number }) =>
    [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as const;
  const outer = corners({ x: m * 0.05, y: m * 0.05, w: w - m * 0.1, h: h - m * 0.1 });

  if (move === "zoom-in" || move === "zoom-out" || move === "punch-in") {
    const box = inner(move === "punch-in" ? 0.58 : 0.68);
    dashedRect(ctx, box.x, box.y, box.w, box.h, r, red, stroke * (move === "punch-in" ? 1.2 : 0.9), move === "punch-in" ? [7, 4] : [5, 4]);
    corners(box).forEach(([ix, iy], i) => {
      const [ox, oy] = outer[i]!;
      const [ax, ay, bx, by] = move === "zoom-out" ? [ix, iy, ox, oy] : [ox, oy, ix, iy];
      // The middle stretch only: short, and the heads stop just short of the frame they point at.
      arrow(ctx, ax + (bx - ax) * 0.3, ay + (by - ay) * 0.3, ax + (bx - ax) * 0.85, ay + (by - ay) * 0.85, r, red, stroke, 0);
    });
    if (move === "punch-in") {
      // Impact ticks at its corners: it's a cut-in, not a drift.
      for (const [ix, iy] of corners(box)) {
        for (const a of [0, Math.PI / 2]) wobblyLine(ctx, ix - Math.cos(a) * m * 0.03, iy - Math.sin(a) * m * 0.03, ix + Math.cos(a) * m * 0.03, iy + Math.sin(a) * m * 0.03, r, red, stroke * 0.8);
      }
    }
    if (labels) label(ctx, w, h, move === "zoom-in" ? "SLOW ZOOM IN" : move === "zoom-out" ? "ZOOM OUT" : "PUNCH IN", box.x + 3, box.y - fs * 0.75, red, fs);
  } else if (move === "pan-left" || move === "pan-right") {
    // The frame slides across: a long arrow over the top.
    const d = move === "pan-left" ? -1 : 1;
    const y = h * 0.07;
    arrow(ctx, w / 2 - d * w * 0.3, y, w / 2 + d * w * 0.3, y, r, red, stroke * 1.3, -0.06);
    if (labels) label(ctx, w, h, move === "pan-left" ? "PAN LEFT" : "PAN RIGHT", w / 2, y + fs * 1.1, red, fs, "center");
  } else if (move === "shake") {
    for (const sx of [0.05, 0.95]) {
      ctx.beginPath();
      ctx.strokeStyle = red;
      ctx.lineWidth = stroke;
      for (let i = 0; i <= 6; i++) ctx.lineTo(w * sx + (i % 2 ? 1 : -1) * m * 0.025, h * (0.4 + i * 0.035));
      ctx.stroke();
    }
    if (labels) label(ctx, w, h, "SHAKE", w / 2, h * 0.36, red, fs, "center");
  }
}

/** The layer's note, hand-written next to it with a leader line (big views only). */
function note(ctx: CanvasRenderingContext2D, w: number, h: number, l: Layer, r: () => number) {
  const fs = Math.max(9, Math.min(13, Math.min(w, h) / 22));
  const x = l.x * w;
  const y = l.y * h;
  const lw = l.w * w;
  const lh = l.h * h;
  const right = x + lw / 2 < w / 2; // write on the emptier side
  const ny = Math.min(h - fs * 2, Math.max(fs * 2, y + lh + fs * 1.6));
  const text = l.note!.trim().slice(0, 60);
  label(ctx, w, h, text, right ? x + lw * 0.3 : x + lw * 0.7, ny, T.lead, fs, right ? "left" : "right");
  ctx.globalAlpha = 0.7;
  wobblyLine(ctx, right ? x + lw * 0.3 : x + lw * 0.7, ny - fs * 0.6, x + lw / 2, y + lh, r, T.lead, 0.9);
  ctx.globalAlpha = 1;
}

// ---- the user's own drawing ----

/**
 * The user's strokes on a w x h frame. They're drawn on their own layer first, so the eraser rubs out
 * only their lines, never the sketch under them. On paper, white pencil turns to ink (or it would vanish).
 */
export function drawMarks(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number, marks: Mark[], theme: SketchTheme = "dark") {
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(w * scale));
  layer.height = Math.max(1, Math.round(h * scale));
  const g = layer.getContext("2d")!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  strokeMarks(g, w, h, marks, theme);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/** The strokes themselves, onto a layer of their own (so the eraser only reaches them). */
export function strokeMarks(g: CanvasRenderingContext2D, w: number, h: number, marks: Mark[], theme: SketchTheme = "dark") {
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  const m = Math.min(w, h);
  for (const k of marks) {
    const p = k.points;
    if (p.length < 2) continue;
    g.globalCompositeOperation = k.tool === "eraser" ? "destination-out" : "source-over";
    const color = theme === "paper" && /^#f/i.test(k.color) ? INK : k.color;
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = Math.max(1, k.size * m);
    if (k.tool === "arrow") {
      if (p.length >= 4) arrowMark(g, w, h, k, color, theme);
      continue;
    }
    if (p.length < 4) {
      // A dot.
      g.beginPath();
      g.arc(p[0]! * w, p[1]! * h, g.lineWidth / 2, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    // Smoothed through the midpoints, the way a pencil line looks.
    g.beginPath();
    g.moveTo(p[0]! * w, p[1]! * h);
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = ((p[i]! + p[i + 2]!) / 2) * w;
      const my = ((p[i + 1]! + p[i + 3]!) / 2) * h;
      g.quadraticCurveTo(p[i]! * w, p[i + 1]! * h, mx, my);
    }
    g.lineTo(p[p.length - 2]! * w, p[p.length - 1]! * h);
    g.stroke();
  }
  g.restore();
}

/** Where an arrow's note box sits: centred on the arrow's tail, sized to its words. Null without words. */
export function noteBox(g: CanvasRenderingContext2D, w: number, h: number, k: Mark): { x: number; y: number; w: number; h: number; fs: number } | null {
  const text = k.text?.trim();
  if (!text) return null;
  const m = Math.min(w, h);
  const fs = Math.max(11, Math.min(22, m * 0.045));
  g.save();
  g.font = `600 ${fs}px ${NOTE_FONT}`;
  const tw = Math.min(w * 0.6, g.measureText(text).width);
  g.restore();
  const bw = tw + fs * 1.3;
  const bh = fs * 1.9;
  const cx = Math.min(w - bw / 2 - 2, Math.max(bw / 2 + 2, k.points[0]! * w));
  const cy = Math.min(h - bh / 2 - 2, Math.max(bh / 2 + 2, k.points[1]! * h));
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, fs };
}
const NOTE_FONT = '"SF Pro Text", "Helvetica Neue", system-ui, sans-serif';

/**
 * The user's arrow: from its note (tail) to what the note is about (tip), with an open head. The
 * note sits in a box at the tail in the arrow's colour, the line starting at the box's edge.
 */
function arrowMark(g: CanvasRenderingContext2D, w: number, h: number, k: Mark, color: string, theme: SketchTheme) {
  const p = k.points;
  let x1 = p[0]! * w;
  let y1 = p[1]! * h;
  const x2 = p[p.length - 2]! * w;
  const y2 = p[p.length - 1]! * h;
  const box = noteBox(g, w, h, k);
  if (box) {
    // Start the line where it leaves the box, toward the tip.
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = x2 - cx;
    const dy = y2 - cy;
    const t = Math.min(Math.abs(dx) > 0 ? box.w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? box.h / 2 / Math.abs(dy) : Infinity);
    if (t < 1) (x1 = cx + dx * t), (y1 = cy + dy * t);
  }
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len > 4) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(8, g.lineWidth * 3.2);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.moveTo(x2 - head * Math.cos(a - 0.5), y2 - head * Math.sin(a - 0.5));
    g.lineTo(x2, y2);
    g.lineTo(x2 - head * Math.cos(a + 0.5), y2 - head * Math.sin(a + 0.5));
    g.stroke();
  }
  if (box) {
    g.save();
    g.beginPath();
    g.roundRect(box.x, box.y, box.w, box.h, box.fs * 0.45);
    g.fillStyle = theme === "paper" ? "rgba(255, 253, 248, 0.95)" : "rgba(10, 10, 10, 0.88)";
    g.fill();
    g.lineWidth = Math.max(1.5, box.fs * 0.12);
    g.strokeStyle = color;
    g.stroke();
    g.font = `600 ${box.fs}px ${NOTE_FONT}`;
    g.fillStyle = theme === "paper" ? INK : "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    let text = k.text!.trim();
    while (text.length > 3 && g.measureText(text).width > box.w - box.fs * 1.1) text = `${text.slice(0, -2)}…`;
    g.fillText(text, box.x + box.w / 2, box.y + box.h / 2 + 0.5);
    g.restore();
  }
}
