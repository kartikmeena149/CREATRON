// A storyboard shot drawn like a director's sketch: the real footage as halftone ink dots on paper,
// the layout (titles, captions, cards, arrows) in marker on top, camera moves pencilled in the margin.
// Without a picture (audio only, B-roll not found yet) the dots draw what the shot will be instead:
// the speaker's silhouette, a landscape, a title card. Same input, same drawing (seeded), so the board,
// the animatic and the PDF always match.
import type { Layer, Shot, Storyboard } from "../src/storyboard.ts";

export const PAPER = "#f3efe6";
export const INK = "#1c1b1f";
const PENCIL = "#e5231b"; // Creatro's red: the recording light

/**
 * Two ways to draw the same shot. "dark", in the app: light dots on black, like a picture made of
 * LEDs, so the board sits in Creatro's own dark interface. "paper", for the PDF: ink on paper.
 */
const THEMES = {
  dark: { bg: "#0b0b0b", grain: "rgba(255,255,255,0.035)", ink: "#e6e6e6", inner: "#7a7a7a", line: "#8a8a8a", plate: "rgba(0,0,0,0.78)", plateText: "#f2f2f2", fade: "rgba(11,11,11,0.7)", light: true },
  paper: { bg: PAPER, grain: "rgba(60,50,30,0.05)", ink: INK, inner: INK, line: INK, plate: "rgba(28,27,31,0.88)", plateText: PAPER, fade: "rgba(243,239,230,0.72)", light: false },
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

  // Paper, with a little grain.
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = T.grain;
  for (let i = 0; i < (w * h) / 90; i++) ctx.fillRect(r() * w, r() * h, 1, 1);

  // The picture, in dots.
  const cell = Math.max(3.2, w / 44);
  const kind = shot.kind;
  if (kind === "split") {
    halftone(ctx, 0, 0, w, h / 2, cell, picture && shot.source?.file !== "main" ? sampler(picture, w, h / 2) : scenery(r), T.ink);
    halftone(ctx, 0, h / 2, w, h / 2, cell, picture && shot.source?.file === "main" ? sampler(picture, w, h / 2) : person(0.5, 0.42), T.ink);
    wobblyLine(ctx, 0, h / 2, w, h / 2, r, T.ink, 1.4);
  } else if (kind === "cutout") {
    // A designed background behind the speaker: a light accent field and the silhouette (or them).
    halftone(ctx, 0, 0, w, h, cell * 1.25, (x, y) => 0.12 + 0.1 * Math.sin(x * 9 + y * 4), accent);
    halftone(ctx, 0, 0, w, h, cell, picture ? masked(sampler(picture, w, h), person(0.5, 0.5)) : person(0.5, 0.5), T.ink);
  } else if (kind === "text" || kind === "graphic") {
    halftone(ctx, 0, 0, w, h, cell * 1.4, (x, y) => 0.06 + 0.06 * Math.sin((x + y) * 6), T.ink);
  } else if (picture) {
    halftone(ctx, 0, 0, w, h, cell, sampler(picture, w, h), T.ink);
  } else if (kind === "talking") {
    halftone(ctx, 0, 0, w, h, cell, person(0.5, 0.5), T.ink);
  } else {
    halftone(ctx, 0, 0, w, h, cell, scenery(r), T.ink);
  }

  // B-roll not found yet: say what it must show.
  if ((kind === "broll" || kind === "image") && !picture && shot.query) tag(ctx, w, h, `${kind === "broll" ? "B-ROLL" : "IMAGE"} · ${shot.query}`);

  for (const l of shot.layers) layer(ctx, w, h, l, board, accent, r, picture);
  camera(ctx, w, h, shot.camera, r);

  if (shot.dropped) {
    ctx.fillStyle = T.fade;
    ctx.fillRect(0, 0, w, h);
    wobblyLine(ctx, w * 0.12, h * 0.12, w * 0.88, h * 0.88, r, PENCIL, 3);
    wobblyLine(ctx, w * 0.88, h * 0.12, w * 0.12, h * 0.88, r, PENCIL, 3);
  }
}

// ---- dots ----

type Field = (x: number, y: number) => number; // 0 = paper, 1 = full ink, x and y in 0..1

function halftone(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, cell: number, field: Field, color: string) {
  ctx.fillStyle = color;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  ctx.beginPath();
  for (let j = 0; j < rows; j++) {
    // Every other row shifted half a cell: the classic halftone screen.
    const shift = j % 2 ? cell / 2 : 0;
    for (let i = 0; i < cols; i++) {
      const cx = i * cell + shift + cell / 2;
      const cy = j * cell + cell / 2;
      if (cx > w) continue;
      const v = Math.min(1, Math.max(0, field(cx / w, cy / h)));
      const rad = Math.pow(v, 0.85) * cell * 0.56;
      if (rad < 0.35) continue;
      ctx.moveTo(x0 + cx + rad, y0 + cy);
      ctx.arc(x0 + cx, y0 + cy, rad, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

/** Darkness of a picture, fitted to cover a w x h frame (like object-fit: cover). */
function sampler(img: HTMLImageElement, w: number, h: number): Field {
  const cols = 120;
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
  // Stretch the contrast so dark footage still reads.
  let lo = 255;
  let hi = 0;
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < lum.length; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    lum[i] = v;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = Math.max(40, hi - lo);
  return (x, y) => {
    const i = Math.min(rows - 1, Math.floor(y * rows)) * cols + Math.min(cols - 1, Math.floor(x * cols));
    const v = (lum[i] - lo) / span;
    return T.light ? v * 0.92 + 0.04 : 1 - v; // big dots where the picture is bright (dark) or dark (paper)
  };
}

/** A person from the chest up, centred at (cx, cy) of the frame. */
function person(cx: number, cy: number): Field {
  return (x, y) => {
    const head = ((x - cx) / 0.17) ** 2 + ((y - (cy - 0.13)) / 0.115) ** 2;
    const neck = Math.abs(x - cx) < 0.06 && y > cy - 0.04 && y < cy + 0.06 ? 0 : 2;
    const body = ((x - cx) / 0.4) ** 2 + ((y - (cy + 0.3)) / 0.26) ** 2;
    const inside = Math.min(head, neck, body);
    const shade = 0.55 + 0.35 * (x - cx + 0.3); // light from the left
    return inside < 1 ? shade : 0.08 * (1 - y) + 0.04;
  };
}

/** Somewhere outside: a sky, a sun and layered hills, different for every shot. */
function scenery(r: () => number): Field {
  const sun = { x: 0.2 + r() * 0.6, y: 0.18 + r() * 0.15, s: 0.07 + r() * 0.05 };
  const hills = [0, 1, 2].map((k) => ({ base: 0.55 + k * 0.12 + r() * 0.05, a: 0.03 + r() * 0.05, f: 4 + r() * 8, p: r() * 6, v: 0.3 + k * 0.22 }));
  return (x, y) => {
    let v = 0.04 + y * 0.12;
    if ((x - sun.x) ** 2 + (y - sun.y) ** 2 < sun.s ** 2) v = 0.85;
    for (const hl of hills) if (y > hl.base + hl.a * Math.sin(x * hl.f + hl.p)) v = hl.v;
    return v;
  };
}

/** Only where `mask` is inked (the speaker over a designed background). */
const masked = (picture: Field, mask: Field): Field => (x, y) => (mask(x, y) > 0.4 ? Math.max(0.25, picture(x, y)) : 0);

// ---- marker ----

function wobblyLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: () => number, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    const j = () => (r() - 0.5) * 1.6;
    ctx.beginPath();
    ctx.moveTo(x1 + j(), y1 + j());
    const mx = (x1 + x2) / 2 + j() * 1.5;
    const my = (y1 + y2) / 2 + j() * 1.5;
    ctx.quadraticCurveTo(mx, my, x2 + j(), y2 + j());
    ctx.globalAlpha = pass ? 0.45 : 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function roughRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number, color: string, width = 1.6) {
  wobblyLine(ctx, x, y, x + w, y, r, color, width);
  wobblyLine(ctx, x + w, y, x + w, y + h, r, color, width);
  wobblyLine(ctx, x + w, y + h, x, y + h, r, color, width);
  wobblyLine(ctx, x, y + h, x, y, r, color, width);
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
      ctx.clip();
      const cell = Math.max(2.6, lw / 18);
      halftone(ctx, x, y, lw, lh, cell, l.kind === "footage" && picture ? sampler(picture, lw, lh) : l.kind === "footage" ? person(0.5, 0.55) : scenery(r), T.inner);
      ctx.restore();
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
      const x2 = x + lw;
      const y2 = y + lh;
      wobblyLine(ctx, x, y, x2, y2, r, color, 3);
      const a = Math.atan2(y2 - y, x2 - x);
      const s = Math.max(8, Math.min(w, h) * 0.05);
      wobblyLine(ctx, x2, y2, x2 - s * Math.cos(a - 0.5), y2 - s * Math.sin(a - 0.5), r, color, 3);
      wobblyLine(ctx, x2, y2, x2 - s * Math.cos(a + 0.5), y2 - s * Math.sin(a + 0.5), r, color, 3);
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
      roughRect(ctx, x, y, lw, lh, r, T.ink, 1.2);
      const bars = 4;
      for (let i = 0; i < bars; i++) {
        const bh = lh * (0.25 + (0.65 * (i + 1)) / bars) * (0.85 + r() * 0.15);
        const bw = (lw / bars) * 0.55;
        ctx.fillStyle = i === bars - 1 ? color : T.ink;
        ctx.fillRect(x + (lw / bars) * i + bw * 0.4, y + lh - bh - 2, bw, bh);
      }
      if (l.text) fitText(ctx, l.text, x, y - 18, lw, 16, 800, SANS, T.ink, T.bg);
      break;
    }
  }
}

/** A label stuck on the frame (B-roll still to be found). */
function tag(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  // Low in the frame, under where titles go and below most captions.
  tagAt(ctx, w * 0.06, h * 0.9, w * 0.88, text);
}

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

/** The camera move, pencilled on the frame like a storyboard artist would. */
function camera(ctx: CanvasRenderingContext2D, w: number, h: number, move: Shot["camera"], r: () => number) {
  if (move === "still") return;
  const c = PENCIL;
  const m = Math.min(w, h);
  const corner = (inward: boolean) => {
    const ins = m * 0.07;
    const len = m * 0.09;
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const cx = sx ? w - ins : ins;
      const cy = sy ? h - ins : ins;
      const dx = sx ? -1 : 1;
      const dy = sy ? -1 : 1;
      wobblyLine(ctx, cx, cy, cx + dx * len, cy, r, c, 2.2);
      wobblyLine(ctx, cx, cy, cx, cy + dy * len, r, c, 2.2);
      const [ax, ay] = inward ? [cx + dx * len * 0.9, cy + dy * len * 0.9] : [cx, cy];
      const [bx, by] = inward ? [cx + dx * len * 0.35, cy + dy * len * 0.35] : [cx - dx * len * 0.45, cy - dy * len * 0.45];
      wobblyLine(ctx, bx, by, ax, ay, r, c, 1.6);
    }
  };
  if (move === "zoom-in") corner(true);
  else if (move === "zoom-out") corner(false);
  else if (move === "punch-in") {
    ctx.setLineDash([6, 5]);
    roughRect(ctx, w * 0.16, h * 0.16, w * 0.68, h * 0.68, r, c, 2);
    ctx.setLineDash([]);
  } else if (move === "pan-left" || move === "pan-right") {
    const y = h * 0.93;
    const [a, b] = move === "pan-left" ? [w * 0.8, w * 0.2] : [w * 0.2, w * 0.8];
    wobblyLine(ctx, a, y, b, y, r, c, 2.6);
    const d = move === "pan-left" ? 1 : -1;
    wobblyLine(ctx, b, y, b + d * m * 0.05, y - m * 0.035, r, c, 2.6);
    wobblyLine(ctx, b, y, b + d * m * 0.05, y + m * 0.035, r, c, 2.6);
  } else if (move === "shake") {
    for (const sx of [0.05, 0.95]) {
      ctx.beginPath();
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      for (let i = 0; i <= 6; i++) ctx.lineTo(w * sx + (i % 2 ? 5 : -5), h * (0.4 + i * 0.035));
      ctx.stroke();
    }
  }
}
