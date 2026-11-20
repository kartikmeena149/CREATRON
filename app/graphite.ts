// A drawn thing rendered the way an artist renders it in graphite: not flat shapes but form. Each
// closed shape becomes a rounded volume (a distance field from its outline gives it a dome), lit
// from the top left: the lit side left as paper, a core shadow, reflected light at the dark edge.
// The tone is laid down with a smudged under-layer and thousands of short pencil strokes that wrap
// around the form (contour hatching), crossed in the darkest places, with the paper's tooth showing
// through. A standing thing casts its real silhouette as a shadow on the ground. Deterministic
// (seeded), and cached by shape, so a thing that is only moved isn't rendered again.
import type { Stroke } from "../src/storyboard.ts";
import { pathBox, transformPath } from "../src/sketchObjects.ts";

export type Look = "paper" | "dark";
type Box = { x: number; y: number; w: number; h: number };
/** A rendered thing: its picture and its cast shadow, placed in the drawing's units. */
export type Rendered = { body: HTMLCanvasElement; bodyBox: Box; shadow?: HTMLCanvasElement; shadowBox?: Box };

const cache = new Map<string, Rendered>();
const LIGHT = (() => {
  const v = [-0.55, -0.75, 0.62];
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return v.map((x) => x / l) as [number, number, number];
})();

function rand(seed: number) {
  let s = Math.floor(Math.abs(seed) * 9973) % 2147483646 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
/** A filled shape that encloses something (shaded or coloured, and ending where it began): only those get a form. */
function closedShape(s: Stroke): boolean {
  if (!s.shade && !s.color) return false; // a plain line, even a closed one, is drawn detail (a meridian, a window)
  if (/z\s*$/i.test(s.d.trim())) return true;
  try {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", s.d);
    const total = el.getTotalLength();
    const a = el.getPointAtLength(0);
    const b = el.getPointAtLength(total);
    return total > 0 && Math.hypot(a.x - b.x, a.y - b.y) < Math.max(3, total * 0.02);
  } catch {
    return false;
  }
}
const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] as const;

/**
 * Renders one thing (its strokes, in the drawing's units) at `pxPerUnit` device pixels per unit.
 * `stands`: it rests on something, so it casts a shadow. Returns null when it has no closed shape
 * (only lines: those are drawn with the brush alone).
 */
export function graphite(strokes: Stroke[], pxPerUnit: number, look: Look, stands: boolean): Rendered | null {
  const shapes = strokes.filter(closedShape);
  if (!shapes.length) return null;
  const boxes = shapes.map((s) => pathBox(s.d)).filter((b): b is Box => Boolean(b));
  if (!boxes.length) return null;
  const box = boxes.reduce((a, b) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  });
  // Shape and size decide the picture; where it sits doesn't (moving a thing reuses it).
  const S0 = Math.min(pxPerUnit, 720 / Math.max(box.w, box.h, 1));
  const S = Math.round(S0 * 20) / 20 || 0.05;
  const key = `${look}|${S}|${stands}|${shapes.map((s) => `${transformPath(s.d, -box.x, -box.y)}~${s.shade ?? ""}~${s.color ?? ""}`).join("|")}`;
  const hit = cache.get(key);
  if (hit) return place(hit, box);

  const pad = Math.max(box.w, box.h) * 0.04 + 4;
  const W = Math.max(8, Math.ceil((box.w + pad * 2) * S));
  const H = Math.max(8, Math.ceil((box.h + pad * 2) * S));
  const n = W * H;
  const toPx = (c: CanvasRenderingContext2D) => c.setTransform(S, 0, 0, S, (pad - box.x) * S, (pad - box.y) * S);

  // Which shape each pixel belongs to (later shapes in front), and each shape's own value.
  const id = new Int16Array(n);
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const t = tmp.getContext("2d", { willReadFrequently: true })!;
  shapes.forEach((s, j) => {
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, W, H);
    toPx(t);
    try {
      t.fill(new Path2D(s.d));
    } catch {
      return;
    }
    const a = t.getImageData(0, 0, W, H).data;
    for (let i = 0; i < n; i++) if (a[i * 4 + 3]! > 110) id[i] = j + 1;
  });
  const base = shapes.map((s) => (s.shade ?? (s.color ? lum(s.color) * 0.7 : 0.18)));

  // Distance from each pixel to its shape's edge (a chamfer pass), and each shape's deepest point.
  const INF = 1e9;
  const d = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const me = id[i]!;
      if (!me) {
        d[i] = 0;
        continue;
      }
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 || id[i - 1] !== me || id[i + 1] !== me || id[i - W] !== me || id[i + W] !== me;
      d[i] = edge ? 1 : INF;
    }
  }
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (d[i]! <= 1) continue;
      d[i] = Math.min(d[i]!, d[i - 1]! + D1, d[i - W]! + D1, d[i - W - 1]! + D2, d[i - W + 1]! + D2);
    }
  }
  for (let y = H - 2; y > 0; y--) {
    for (let x = W - 2; x > 0; x--) {
      const i = y * W + x;
      if (d[i]! <= 1) continue;
      d[i] = Math.min(d[i]!, d[i + 1]! + D1, d[i + W]! + D1, d[i + W + 1]! + D2, d[i + W - 1]! + D2);
    }
  }
  const deepest = new Float32Array(shapes.length + 1);
  for (let i = 0; i < n; i++) if (id[i]) deepest[id[i]!] = Math.max(deepest[id[i]!]!, d[i]!);
  // Smoothed, so a box is a soft cushion, not a pyramid with creases along its middle.
  const most = Math.max(...deepest);
  smooth(d, id, W, H, Math.max(2, Math.round(Math.min(most * 0.3, 28))));
  smooth(d, id, W, H, Math.max(2, Math.round(Math.min(most * 0.3, 28))));
  deepest.fill(0);
  for (let i = 0; i < n; i++) if (id[i]) deepest[id[i]!] = Math.max(deepest[id[i]!]!, d[i]!);

  // Each pixel as a point on a rounded form: how dark the graphite there (0 paper, 1 darkest),
  // and the direction its contour runs (where the hatching goes).
  const tone = new Float32Array(n).fill(-1);
  const dirx = new Float32Array(n);
  const diry = new Float32Array(n);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const me = id[i]!;
      if (!me) continue;
      const m = Math.max(2, deepest[me]!);
      const dn = Math.min(1, d[i]! / m);
      // The way inward (toward the deepest point), from the field's slope.
      let gx = (id[i + 1] === me ? d[i + 1]! : d[i]!) - (id[i - 1] === me ? d[i - 1]! : d[i]!);
      let gy = (id[i + W] === me ? d[i + W]! : d[i]!) - (id[i - W] === me ? d[i - W]! : d[i]!);
      const gl = Math.hypot(gx, gy) || 1;
      gx /= gl;
      gy /= gl;
      // A dome: steep at the edge, flat on top. Its surface leans outward (against the inward way).
      const u = 1 - dn;
      const slope = Math.min(6, u / Math.sqrt(Math.max(1e-4, 1 - u * u)));
      let nx = -gx * slope * 0.9;
      let ny = -gy * slope * 0.9;
      let nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const lit = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      // Value: the thing's own darkness, plus the form turning from the light. The lit side goes
      // to bare paper, the far side dark, with a core shadow and light bounced back at its edge.
      let v = base[me - 1]! * 0.5 + Math.pow(1 - lit, 1.25) * 0.95 - 0.16;
      if (lit > 0.82) v -= (lit - 0.82) * 1.4; // the highlight: paper left alone
      if (lit > 0.1 && lit < 0.38) v += 0.1; // the core shadow, where the light turns away
      if (lit < 0.32 && dn < 0.16) v -= 0.2 * (1 - dn / 0.16); // reflected light on the shadow edge
      tone[i] = Math.max(0, Math.min(1, v));
      // Hatching wraps around the form near its edges and runs straight and diagonal across its
      // middle (where the wrap would spiral), as an artist's does.
      const flat = Math.min(1, Math.max(0, (dn - 0.35) / 0.4));
      const hx = -gy * (1 - flat) + 0.62 * flat;
      const hy = gx * (1 - flat) + 0.78 * flat;
      const hl = Math.hypot(hx, hy) || 1;
      dirx[i] = hx / hl;
      diry[i] = hy / hl;
    }
  }

  const body = document.createElement("canvas");
  body.width = W;
  body.height = H;
  const g = body.getContext("2d")!;
  const ink = look === "paper" ? "38,37,42" : "236,236,236";
  // On the dark page white pencil draws the light: the strokes go where the form is lit.
  const amount = (v: number) => (look === "paper" ? v : Math.max(0, 0.85 - v));

  // The under-layer: the tone rubbed in. A shape with a colour is laid in that colour (coloured
  // pencil): a pale tint where the light falls, its full colour, then its deep shade in the shadow.
  const cols = shapes.map((s) => (s.color ? ([...hex(s.color)] as [number, number, number]) : null));
  const img = g.createImageData(W, H);
  const [ir, ig, ib] = ink.split(",").map(Number) as [number, number, number];
  for (let i = 0; i < n; i++) {
    if (tone[i]! < 0) continue;
    const c = cols[id[i]! - 1];
    if (c) {
      const [cr, cg, cb, ca] = colourAt(c, tone[i]!, look);
      img.data[i * 4] = cr;
      img.data[i * 4 + 1] = cg;
      img.data[i * 4 + 2] = cb;
      img.data[i * 4 + 3] = ca;
      continue;
    }
    img.data[i * 4] = ir;
    img.data[i * 4 + 1] = ig;
    img.data[i * 4 + 2] = ib;
    img.data[i * 4 + 3] = Math.round(255 * amount(tone[i]!) * 0.5);
  }
  g.putImageData(img, 0, 0);

  // The pencil: short strokes that wrap around the form, denser and darker where it's dark,
  // crossed in the darkest places.
  const r = rand(W * 31 + H * 17 + shapes.length * 7 + base.reduce((a, b) => a + b, 0) * 1000);
  const area = shapes.length ? id.reduce((a, v) => a + (v ? 1 : 0), 0) : 0;
  const sp = Math.max(1.6, Math.sqrt(area / 9000));
  g.lineCap = "round";
  for (let y = sp / 2; y < H - 1; y += sp) {
    for (let x = sp / 2; x < W - 1; x += sp) {
      const px = Math.min(W - 2, Math.max(1, Math.round(x + (r() - 0.5) * sp)));
      const py = Math.min(H - 2, Math.max(1, Math.round(y + (r() - 0.5) * sp)));
      const i = py * W + px;
      if (tone[i]! < 0) continue;
      const v = amount(tone[i]!);
      if (r() > v * 1.45 + 0.02) continue;
      const len = sp * (2 + r() * 2.6);
      for (const cross of v > 0.62 ? [0, 1] : [0]) {
        let ux = dirx[i]!;
        let uy = diry[i]!;
        // A hand's slant, and the second pass turned across the first.
        const turn = cross ? 1.05 : 0.18 + (r() - 0.5) * 0.25;
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        [ux, uy] = [ux * c - uy * sn, ux * sn + uy * c];
        g.globalAlpha = Math.min(0.92, 0.12 + v * 0.72) * (cross ? 0.75 : 1);
        // Coloured pencil in the shape's own colour, deeper in the shadow; graphite only for the
        // darkest crossing, as an artist uses it for the accents.
        const own = cols[id[i]! - 1];
        g.strokeStyle = own && !(cross && v > 0.78)
          ? `rgb(${look === "paper" ? mixc(own, [24, 20, 26], 0.18 + v * 0.42) : mixc(own, [255, 255, 255], Math.max(0, 0.42 - (0.85 - v) * 0.2))})`
          : `rgb(${ink})`;
        g.lineWidth = Math.max(0.5, S * 0.9) * (0.55 + r() * 0.5);
        g.beginPath();
        g.moveTo(px - ux * len * 0.5, py - uy * len * 0.5);
        g.quadraticCurveTo(px + uy * len * 0.08, py - ux * len * 0.08, px + ux * len * 0.5, py + uy * len * 0.5);
        g.stroke();
      }
    }
  }
  g.globalAlpha = 1;

  // The paper's tooth: tiny gaps where the graphite skipped.
  g.fillStyle = look === "paper" ? "rgba(246,243,236,0.55)" : "rgba(14,14,14,0.55)";
  for (let j = 0, k = Math.round(area / 22); j < k; j++) {
    const px = Math.floor(r() * W);
    const py = Math.floor(r() * H);
    if (tone[py * W + px]! >= 0) g.fillRect(px, py, 1, 1);
  }

  // A thing with a colour keeps a light glaze of it, like coloured pencil over graphite.
  shapes.forEach((s, j) => {
    if (!s.color) return;
    g.save();
    toPx(g);
    g.globalCompositeOperation = look === "paper" ? "multiply" : "soft-light";
    g.globalAlpha = look === "paper" ? 0.12 : 0.25;
    g.fillStyle = s.color;
    try {
      g.fill(new Path2D(s.d));
    } catch {}
    g.restore();
    void j;
  });

  // Only inside the thing.
  const mask = document.createElement("canvas");
  mask.width = W;
  mask.height = H;
  const mk = mask.getContext("2d")!;
  const md = mk.createImageData(W, H);
  for (let i = 0; i < n; i++) if (id[i]) md.data[i * 4 + 3] = 255;
  mk.putImageData(md, 0, 0);
  mk.filter = "blur(0.6px)";
  mk.drawImage(mask, 0, 0);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = "source-over";

  const out: Rendered = { body, bodyBox: { x: -pad, y: -pad, w: W / S, h: H / S } };
  if (stands) Object.assign(out, castShadow(mask, W, H, S, pad, box, look, r));
  if (cache.size > 160) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return place(out, box);
}

/**
 * The thing's silhouette laid on the ground away from the light (to the right and back), soft at
 * its far end, dark where it touches the ground, hatched like the rest.
 */
function castShadow(mask: HTMLCanvasElement, W: number, H: number, S: number, pad: number, box: Box, look: Look, r: () => number) {
  const ground = (pad + box.h) * S; // the thing's foot, in its picture's pixels
  const reach = 0.85;
  const lift = 0.16;
  const SW = Math.ceil(W + H * reach + 20);
  const SH = Math.ceil(H * 0.5 + 20);
  const top = ground - H * lift - 10; // where the shadow picture starts, in the body's pixels
  const c = document.createElement("canvas");
  c.width = SW;
  c.height = SH;
  const g = c.getContext("2d")!;
  // x' = x + (ground - y) * reach, y' = ground - (ground - y) * lift, moved into this canvas.
  g.setTransform(1, 0, -reach, lift, ground * reach, ground - ground * lift - top);
  g.filter = `blur(${Math.max(1.5, S * 2.5)}px)`;
  g.drawImage(mask, 0, 0);
  g.filter = "none";
  g.setTransform(1, 0, 0, 1, 0, 0);
  // Darker near the foot, fading as it goes.
  g.globalCompositeOperation = "source-in";
  const fade = g.createLinearGradient(0, 0, SW, 0);
  const tint = look === "paper" ? "40,36,32" : "0,0,0";
  fade.addColorStop(0, `rgba(${tint},${look === "paper" ? 0.5 : 0.8})`);
  fade.addColorStop(1, `rgba(${tint},0.05)`);
  g.fillStyle = fade;
  g.fillRect(0, 0, SW, SH);
  // Hatched across, like the lamp's shadow in a pencil study.
  g.globalCompositeOperation = "source-atop";
  g.strokeStyle = look === "paper" ? "rgba(30,28,30,0.35)" : "rgba(0,0,0,0.5)";
  g.lineWidth = Math.max(0.5, S * 0.7);
  const gap = Math.max(2.5, S * 4);
  g.beginPath();
  for (let x = -SH; x < SW; x += gap * (0.8 + r() * 0.4)) g.moveTo(x, SH), g.lineTo(x + SH * 0.9, 0);
  g.stroke();
  g.globalCompositeOperation = "source-over";
  return { shadow: c, shadowBox: { x: -pad, y: top / S - pad, w: SW / S, h: SH / S } };
}

/** A rendered thing placed at its box (the render is relative to the box's corner). */
function place(r: Rendered, box: Box): Rendered {
  const at = (b: Box): Box => ({ x: b.x + box.x, y: b.y + box.y, w: b.w, h: b.h });
  return { body: r.body, bodyBox: at(r.bodyBox), shadow: r.shadow, shadowBox: r.shadowBox && at(r.shadowBox) };
}

/** How dark a colour is (0 white, 1 black). */
function lum(c: string): number {
  const [r, g, b] = hex(c);
  return Math.max(0.08, 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255);
}

/**
 * A box blur of the distance field, each pixel averaged only with pixels of its own shape (runs of the
 * same id), across then down: prefix sums over each run, so it costs the same at any radius.
 */
function smooth(d: Float32Array, id: Int16Array, W: number, H: number, rad: number) {
  const out = new Float32Array(d.length);
  const pass = (count: number, len: number, at: (line: number, k: number) => number) => {
    const sum = new Float64Array(len + 1);
    for (let line = 0; line < count; line++) {
      for (let k = 0; k < len; ) {
        const i0 = at(line, k);
        const me = id[i0]!;
        let e = k;
        while (e < len && id[at(line, e)] === me) e++;
        if (me) {
          sum[k] = 0;
          for (let q = k; q < e; q++) sum[q + 1] = sum[q]! + d[at(line, q)]!;
          for (let q = k; q < e; q++) {
            const a = Math.max(k, q - rad);
            const b = Math.min(e - 1, q + rad);
            out[at(line, q)] = (sum[b + 1]! - sum[a]!) / (b - a + 1);
          }
        }
        k = e;
      }
    }
    for (let i = 0; i < d.length; i++) if (id[i]) d[i] = out[i]!;
  };
  pass(H, W, (y, x) => y * W + x);
  pass(W, H, (x, y) => y * W + x);
}

/** Two colours mixed (t = 0 is a, 1 is b), as "r,g,b". */
function mixc(a: readonly number[], b: readonly number[], t: number): string {
  return a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(",");
}

/**
 * A coloured shape's under-layer at a tone (0 lit, 1 dark): on paper a pale tint in the light, the
 * colour itself, its deep shade in the shadow, fairly opaque so the colour reads; on the dark page the
 * colour glows where it's lit and sinks into the black in the shadow.
 */
function colourAt(c: readonly [number, number, number], v: number, look: Look): [number, number, number, number] {
  const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((x, i) => Math.round(x + (b[i]! - x) * t)) as [number, number, number];
  if (look === "paper") {
    const tint = mix(c, [250, 246, 238], 0.5);
    const deep = mix(c, [22, 18, 24], 0.55);
    const rgb = v < 0.45 ? mix(tint, c, v / 0.45) : mix(c, deep, (v - 0.45) / 0.55);
    return [...rgb, Math.round(255 * (0.5 + v * 0.42))];
  }
  const glow = mix(c, [255, 255, 255], 0.28);
  const rgb = v < 0.5 ? mix(glow, c, v / 0.5) : mix(c, [0, 0, 0], (v - 0.5) * 0.9);
  return [...rgb, Math.round(255 * (0.82 - v * 0.42))];
}
