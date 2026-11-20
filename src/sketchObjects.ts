// The things in Claude's drawing of a shot (shot.sketch) as objects the user can pick, move, resize and
// remove: the satellite, the Earth, the car. A stroke may name its object ("object": "satellite");
// strokes without a name are grouped by touching (their boxes overlap or nearly do). Moving or resizing
// rewrites the strokes' SVG paths, so the drawing stays plain data that Claude reads.
// Pure: no DOM, used by the app.
import type { Stroke } from "./storyboard.ts";

export type Box = { x: number; y: number; w: number; h: number };
export type SketchObject = { name?: string; strokes: number[]; box: Box };

/** How many numbers each SVG path command takes per repeat. */
const ARGS: Record<string, number> = { m: 2, l: 2, t: 2, h: 1, v: 1, q: 4, s: 4, c: 6, a: 7, z: 0 };

type Seg = { cmd: string; args: number[] };
function parse(d: string): Seg[] {
  const out: Seg[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  let cur: Seg | null = null;
  while ((m = re.exec(d))) {
    if (m[1]) out.push((cur = { cmd: m[1], args: [] }));
    else if (cur) cur.args.push(Number(m[2]));
  }
  return out;
}
const fmt = (n: number) => String(Math.round(n * 10) / 10);
function stringify(segs: Seg[]): string {
  return segs.map((s) => `${s.cmd}${s.args.length ? ` ${s.args.map(fmt).join(" ")}` : ""}`).join(" ");
}

/**
 * A path moved by (dx, dy) and scaled by k around (ox, oy), in the drawing's units. Absolute
 * coordinates move and scale; relative ones only scale; an arc's radii scale, its flags stay.
 */
export function transformPath(d: string, dx: number, dy: number, k = 1, ox = 0, oy = 0): string {
  const segs = parse(d);
  const X = (x: number) => (x - ox) * k + ox + dx;
  const Y = (y: number) => (y - oy) * k + oy + dy;
  segs.forEach((s, si) => {
    const c = s.cmd.toLowerCase();
    const n = ARGS[c] ?? 0;
    const upper = s.cmd !== c;
    for (let i = 0; n && i + n <= s.args.length; i += n) {
      const a = s.args;
      // A path's first "m" pair is absolute even in lower case; the pairs after it are relative lines.
      const ab = upper || (si === 0 && c === "m" && i === 0);
      if (c === "h") a[i] = ab ? X(a[i]!) : a[i]! * k;
      else if (c === "v") a[i] = ab ? Y(a[i]!) : a[i]! * k;
      else if (c === "a") {
        a[i] = a[i]! * k;
        a[i + 1] = a[i + 1]! * k;
        a[i + 5] = ab ? X(a[i + 5]!) : a[i + 5]! * k;
        a[i + 6] = ab ? Y(a[i + 6]!) : a[i + 6]! * k;
      } else {
        for (let j = 0; j < n; j += 2) {
          a[i + j] = ab ? X(a[i + j]!) : a[i + j]! * k;
          a[i + j + 1] = ab ? Y(a[i + j + 1]!) : a[i + j + 1]! * k;
        }
      }
    }
  });
  return stringify(segs);
}

/** The box around a path (its points and control points; an arc adds its radius around its end). */
export function pathBox(d: string): Box | null {
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (px: number, py: number) => (xs.push(px), ys.push(py));
  for (const s of parse(d)) {
    const c = s.cmd.toLowerCase();
    const rel = s.cmd === c;
    const n = ARGS[c] ?? 0;
    if (c === "z") {
      (x = sx), (y = sy);
      continue;
    }
    for (let i = 0; n && i + n <= s.args.length; i += n) {
      const a = s.args;
      if (c === "h") x = rel ? x + a[i]! : a[i]!;
      else if (c === "v") y = rel ? y + a[i]! : a[i]!;
      else if (c === "a") {
        const ex = rel ? x + a[i + 5]! : a[i + 5]!;
        const ey = rel ? y + a[i + 6]! : a[i + 6]!;
        const r = Math.max(a[i]!, a[i + 1]!);
        add((x + ex) / 2 - r, (y + ey) / 2 - r);
        add((x + ex) / 2 + r, (y + ey) / 2 + r);
        (x = ex), (y = ey);
      } else {
        const P = (j: number) => [rel ? x + a[i + j]! : a[i + j]!, rel ? y + a[i + j + 1]! : a[i + j + 1]!] as const;
        const [ex, ey] = P(n - 2);
        // A curve's box is where the curve goes, not its control points (they bulge far past it).
        if (c === "q" || c === "c") {
          const pts = c === "q" ? [[x, y], P(0), [ex, ey]] : [[x, y], P(0), P(2), [ex, ey]];
          for (let t = 0.1; t < 1; t += 0.1) {
            const u = 1 - t;
            const w = c === "q" ? [u * u, 2 * u * t, t * t] : [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
            add(pts.reduce((sum, p, j) => sum + p[0]! * w[j]!, 0), pts.reduce((sum, p, j) => sum + p[1]! * w[j]!, 0));
          }
        }
        (x = ex), (y = ey);
      }
      if (c === "m" && i === 0) (sx = x), (sy = y);
      add(x, y);
    }
  }
  if (!xs.length) return null;
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const near = (a: Box, b: Box, gap: number) => a.x - gap <= b.x + b.w && b.x - gap <= a.x + a.w && a.y - gap <= b.y + b.h && b.y - gap <= a.y + a.h;

/**
 * The drawing's objects: strokes with the same `object` name together, and the unnamed ones grouped
 * by touching (within `gap` units). Each with its box, in the drawing's units (the frame is 1000 wide).
 */
export function sketchObjects(list: Stroke[], gap = 30): SketchObject[] {
  const boxes = list.map((s) => pathBox(s.d));
  const named = new Map<string, SketchObject>();
  const loose: SketchObject[] = [];
  list.forEach((s, i) => {
    const b = boxes[i];
    if (!b) return;
    if (s.object?.trim()) {
      const key = s.object.trim().toLowerCase();
      const o = named.get(key);
      if (o) (o.strokes.push(i), (o.box = union(o.box, b)));
      else named.set(key, { name: s.object.trim(), strokes: [i], box: b });
    } else loose.push({ strokes: [i], box: b });
  });
  // Merge touching loose strokes until nothing more joins.
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < loose.length && !merged; i++) {
      for (let j = i + 1; j < loose.length; j++) {
        if (!near(loose[i]!.box, loose[j]!.box, gap)) continue;
        loose[i] = { strokes: [...loose[i]!.strokes, ...loose[j]!.strokes], box: union(loose[i]!.box, loose[j]!.box) };
        loose.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return [...named.values(), ...loose];
}

/** The strokes of one object moved by (dx, dy) and scaled by k around its top left corner. */
export function moveObject(list: Stroke[], o: SketchObject, dx: number, dy: number, k = 1): Stroke[] {
  const ids = new Set(o.strokes);
  return list.map((s, i) => (ids.has(i) ? { ...s, d: transformPath(s.d, dx, dy, k, o.box.x, o.box.y) } : s));
}
