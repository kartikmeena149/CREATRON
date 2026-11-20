// A colour control like a pro editor's: a swatch that opens a picker with a saturation/brightness
// field, hue and opacity sliders, hex and opacity fields, an eyedropper, the colours already in
// the project and the ones used lately. Changes come in live while dragging (one undo step per
// gesture: onStart is called once when one begins).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type RGBA = { r: number; g: number; b: number; a: number };
type HSVA = { h: number; s: number; v: number; a: number };

/** "#rgb", "#rrggbb", "#rrggbbaa", "rgb(…)", "rgba(…)", "transparent" → RGBA, or null. */
export function parseColor(c: string | undefined): RGBA | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const v = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith("%") ? (parseFloat(x) / 100) * 255 : parseFloat(x)));
    if (v.length < 3 || v.some((x) => Number.isNaN(x))) return null;
    const a = v[3] === undefined ? 1 : m[1].includes("%") && /\/\s*[\d.]+%/.test(m[1]) ? v[3] / 255 : v[3];
    return { r: v[0], g: v[1], b: v[2], a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
/** "#rrggbb" (opaque) or "rgba(r, g, b, a)": what's stored in the plan. */
export function formatColor({ r, g, b, a }: RGBA): string {
  return a >= 0.999 ? `#${hex2(r)}${hex2(g)}${hex2(b)}` : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 1000) / 1000})`;
}
const hexOf = ({ r, g, b }: RGBA) => `${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();

function toHsv({ r, g, b, a }: RGBA): HSVA {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max, a };
}
function toRgb({ h, s, v, a }: HSVA): RGBA {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return { r: f(5), g: f(3), b: f(1), a };
}

const RECENT = "creatro.recentColors";
function recent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT) ?? "[]");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string").slice(0, 10) : [];
  } catch {
    return [];
  }
}
function remember(c: string) {
  try {
    localStorage.setItem(RECENT, JSON.stringify([c, ...recent().filter((x) => x !== c)].slice(0, 10)));
  } catch {}
}

/** A colour behind a checkerboard, so see-through colours read as see-through. */
function Chip({ color, size = 18 }: { color: string; size?: number }) {
  return <i className="cp-chip" style={{ width: size, height: size }}><b style={{ background: color }} /></i>;
}

export function ColorField({ value, onChange, onStart, palette = [], alpha = true, label }: {
  value: string | undefined;
  onChange: (color: string) => void;
  /** Called once as a change begins (save an undo step here). */
  onStart: () => void;
  /** Colours already in the project, offered first. */
  palette?: string[];
  alpha?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const rgba = parseColor(value) ?? { r: 255, g: 255, b: 255, a: 1 };
  return (
    <span className="cp-field">
      <button ref={button} className={`cp-swatch ${open ? "on" : ""}`} title={label ? `${label}: click to change` : "Click to change"} onClick={() => setOpen((o) => !o)}>
        <Chip color={formatColor(rgba)} />
        <span className="cp-hex">#{hexOf(rgba)}</span>
        {alpha && rgba.a < 0.999 && <span className="cp-alpha">{Math.round(rgba.a * 100)}%</span>}
      </button>
      {open && button.current && (
        <Picker anchor={button.current} value={rgba} alpha={alpha} palette={palette} onStart={onStart}
          onChange={(c) => onChange(formatColor(c))}
          onClose={(c) => (setOpen(false), c && remember(formatColor(c)))} />
      )}
    </span>
  );
}

function Picker({ anchor, value, alpha, palette, onStart, onChange, onClose }: {
  anchor: HTMLElement; value: RGBA; alpha: boolean; palette: string[];
  onStart: () => void; onChange: (c: RGBA) => void; onClose: (last?: RGBA) => void;
}) {
  const [hsv, setHsv] = useState<HSVA>(() => toHsv(value));
  const [hex, setHex] = useState<string | null>(null); // non-null while typing
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const last = useRef<RGBA | undefined>(undefined);
  const rgb = toRgb(hsv);

  // Beside the swatch, kept on screen.
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const h = box.current?.offsetHeight ?? 360;
    const w = box.current?.offsetWidth ?? 248;
    setPos({ x: Math.min(innerWidth - w - 8, a.left), y: a.bottom + 6 + h > innerHeight ? Math.max(8, a.top - h - 6) : a.bottom + 6 });
  }, [anchor]);
  // Escape or a click outside closes it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose(last.current));
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose(last.current);
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", down, true);
    return () => (window.removeEventListener("keydown", key, true), window.removeEventListener("pointerdown", down, true));
  });

  const set = (next: HSVA) => {
    if (!started.current) (started.current = true), onStart();
    setHsv(next);
    last.current = toRgb(next);
    onChange(last.current);
  };
  /** A new gesture: its own undo step. */
  const begin = () => (started.current = false);
  const pick = (c: string) => {
    const p = parseColor(c);
    if (!p) return;
    begin();
    set(toHsv(alpha ? p : { ...p, a: 1 }));
  };

  const drag = (el: HTMLElement, e: React.PointerEvent, fn: (x: number, y: number) => void) => {
    e.preventDefault();
    begin();
    const go = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect();
      fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
    };
    go(e);
    const up = () => (window.removeEventListener("pointermove", go), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", go);
    window.addEventListener("pointerup", up);
  };

  const eyedropper = typeof window !== "undefined" && "EyeDropper" in window;
  const sample = async () => {
    try {
      const Ctor = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
      const r = await new Ctor().open();
      pick(r.sRGBHex);
    } catch {} // cancelled
  };
  const hue = `hsl(${hsv.h}, 100%, 50%)`;
  const solid = formatColor({ ...rgb, a: 1 });
  const commitHex = (text: string) => {
    setHex(null);
    const p = parseColor(`#${text.replace(/^#/, "")}`);
    if (p) begin(), set(toHsv({ ...p, a: p.a < 1 ? p.a : hsv.a }));
  };
  const swatches = (list: string[]) => list.filter((c, i) => parseColor(c) && list.indexOf(c) === i).slice(0, 10);
  const mine = swatches(palette);
  const used = swatches(recent());

  return createPortal(
    <div className="cp-pop" ref={box} style={{ left: pos.x, top: pos.y }} onKeyDown={(e) => e.stopPropagation()}>
      <div className="cp-sv" style={{ background: hue }} onPointerDown={(e) => drag(e.currentTarget, e, (x, y) => set({ ...hsv, s: x, v: 1 - y }))}>
        <i className="cp-sv-white" /><i className="cp-sv-black" />
        <span className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: solid }} />
      </div>
      <div className="cp-row">
        {eyedropper && (
          <button className="cp-eye" title="Pick a colour from the screen" onClick={sample}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4.5l5 5M17 2l5 5-3 3-5-5zM14 7L5 16l-1 4 4-1 9-9" /></svg>
          </button>
        )}
        <div className="cp-sliders">
          <div className="cp-bar cp-hue" onPointerDown={(e) => drag(e.currentTarget, e, (x) => set({ ...hsv, h: x * 360 }))}>
            <span className="cp-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: hue }} />
          </div>
          {alpha && (
            <div className="cp-bar cp-alpha-bar" onPointerDown={(e) => drag(e.currentTarget, e, (x) => set({ ...hsv, a: Math.round(x * 100) / 100 }))}>
              <i style={{ background: `linear-gradient(90deg, transparent, ${solid})` }} />
              <span className="cp-thumb" style={{ left: `${hsv.a * 100}%`, background: formatColor(rgb) }} />
            </div>
          )}
        </div>
        <Chip color={formatColor(rgb)} size={28} />
      </div>
      <div className="cp-inputs">
        <label className="cp-input hex">
          <span>#</span>
          <input value={hex ?? hexOf(rgb)} maxLength={7} spellCheck={false}
            onFocus={(e) => (setHex(hexOf(rgb)), requestAnimationFrame(() => e.target.select()))}
            onChange={(e) => setHex(e.target.value.replace(/[^0-9a-f#]/gi, ""))}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
        </label>
        {alpha && (
          <label className="cp-input pct">
            <input type="number" min={0} max={100} value={Math.round(hsv.a * 100)}
              onChange={(e) => (begin(), set({ ...hsv, a: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 }))} />
            <span>%</span>
          </label>
        )}
      </div>
      {mine.length > 0 && (
        <div className="cp-group">
          <span>In this edit</span>
          <div className="cp-swatches">{mine.map((c) => <button key={c} title={c} onClick={() => pick(c)}><Chip color={c} size={20} /></button>)}</div>
        </div>
      )}
      {used.length > 0 && (
        <div className="cp-group">
          <span>Recent</span>
          <div className="cp-swatches">{used.map((c) => <button key={c} title={c} onClick={() => pick(c)}><Chip color={c} size={20} /></button>)}</div>
        </div>
      )}
    </div>,
    document.body,
  );
}
