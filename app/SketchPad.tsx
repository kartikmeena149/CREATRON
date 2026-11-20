// Drawing on a storyboard shot: the user's pencil and eraser over Claude's sketch, to show "not like
// that, like this". Their strokes are kept on the shot (shot.marks), drawn on every view of it (cards,
// animatic, PDF), and when they answer, each drawn shot goes to Claude as a picture to look at.
// The sketch and the strokes are two canvases: the eraser only ever rubs out the user's own lines.
// The arrow points from a note in the user's words to what it's about ("move the logo here").
import { useEffect, useRef, useState } from "react";
import { CAMERAS, CAMERA_LABEL, ENTERS, ENTER_LABEL, MARK_COLORS, handled, type Mark, type Shot, type Verdict } from "../src/storyboard.ts";
import { ClaudeSaid } from "./ClaudeSaid.tsx";
import { StoryboardMark } from "./StoryboardMark.tsx";
import { Icon } from "./icons.tsx";
import type { BoardState } from "./store.ts";
import { type SketchObject, moveObject, sketchObjects } from "../src/sketchObjects.ts";
import { mediaUrl } from "./format.ts";
import { THINGS, fitThing, placeThing } from "../src/sketchLibrary.ts";
import { type SketchTheme, type TextHit, usePictures, aspect, drawShot, noteBox, strokeMarks } from "./storyboardSketch.ts";

/**
 * The pencil, the arrow, the eraser (marks), or Select ("text"): drag an object (a title, tag, caption,
 * card, box, sticker, chart) to move it, its corner to resize it, click any words to change them.
 */
type Tool = Mark["tool"] | "text";
/** Everything one undo step brings back: the user's strokes and the shot's objects, words and moves. */
type Snap = { marks: Mark[]; layers: Shot["layers"]; query?: string; camera: Shot["camera"]; sketch?: Shot["sketch"] };
/**
 * What can be picked: one of the shot's layers (a title, tag, caption, card...: `i` is its index), or
 * one of the things in Claude's drawing (the satellite, the car: `i` is the index of one of its strokes,
 * which stays the same when the drawing's objects are grouped again).
 */
type Pick = { kind: "layer" | "art"; i: number };
type Box = { x: number; y: number; w: number; h: number };
/** An object being dragged: moved, or resized from its bottom right corner. Boxes in fractions of the frame. */
type Drag = Pick & { mode: "move" | "resize"; x0: number; y0: number; box: Box; moved: boolean; words: boolean; art?: { strokes: NonNullable<Shot["sketch"]>; object: SketchObject } };
/** The size slider (0..1) as a line width, a fraction of the frame's shorter side: the eraser is broader. */
const widthOf = (tool: Tool, v: number) => (tool === "eraser" ? 0.02 + v * 0.16 : 0.003 + v * 0.037);
const COLOR_NAMES: Record<string, string> = { "#ffd60a": "Yellow", "#f5f5f5": "White", "#4cc9f0": "Blue", "#4ade80": "Green" };

let open = 0;
/** True while the drawing view is open: the storyboard's own keys (esc, arrows, space) leave it alone. */
export const sketching = () => open > 0;

const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** An object of the drawing, named on its strokes (if it had no name) so it stays one thing once moved. */
const named = (list: NonNullable<Shot["sketch"]>, o: SketchObject) =>
  o.name ? list : list.map((st, i) => (o.strokes.includes(i) ? { ...st, object: `object ${o.strokes[0]! + 1}` } : st));
const round4 = (b: { x: number; y: number; w: number; h: number }) => ({ x: Math.round(b.x * 1e4) / 1e4, y: Math.round(b.y * 1e4) / 1e4, w: Math.round(b.w * 1e4) / 1e4, h: Math.round(b.h * 1e4) / 1e4 });

export function SketchPad({ b, shot, index, picture, editable, busy, said, onFix, onTry, onChange, onEdit, onClose, theme = "dark" }: {
  b: BoardState; shot: Shot; index: number; picture: HTMLImageElement | null | undefined; editable: boolean; theme?: SketchTheme;
  /** Claude is fixing this shot now; `said` is its answer to the last fix. */
  busy?: boolean; said?: Verdict;
  /** Fix with Claude: just this shot, from the drawing and its notes. `onTry` asks for Claude's suggestion instead. */
  onFix?: () => void; onTry?: (text: string) => void;
  onChange: (marks: Mark[]) => void; onClose: () => void;
  /** A change to the shot itself: words typed over a title, caption or tag, a movement picked from its label. */
  onEdit?: (patch: Partial<Shot>) => void;
}) {
  const ratio = aspect(b.draft.format);
  const fit = () => {
    const maxH = window.innerHeight - 48 - (said ? 280 : 170); // room for Claude's answer under it
    const maxW = window.innerWidth - 160;
    let h = maxH;
    let w = h * ratio;
    if (w > maxW) (w = maxW), (h = w / ratio);
    return { w: Math.round(w), h: Math.round(h) };
  };
  const [box, setBox] = useState(fit);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(MARK_COLORS[0]);
  const [size, setSize] = useState(0.25);
  const [note, setNote] = useState<{ index: number; text: string } | null>(null); // an arrow's note being typed
  const noteOpened = useRef(0);
  useEffect(() => void (note && (noteOpened.current = performance.now())), [note?.index]);
  const [undone, setUndone] = useState<Snap[]>([]); // for redo
  const [history, setHistory] = useState<Snap[]>([]); // for undo
  const base = useRef<HTMLCanvasElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const live = useRef<Mark | null>(null);
  const marks = shot.marks ?? [];
  // Where the sketch's words are (from drawShot), the one under the pointer, and the one being edited.
  const texts = useRef<TextHit[]>([]);
  const [hover, setHover] = useState<TextHit | null>(null);
  const [editing, setEditing] = useState<{ hit: TextHit; value: string } | null>(null);
  // The object picked with Select, and the one being dragged.
  const [picked, setPicked] = useState<Pick | null>(null);
  // Claude's drawing as objects, and the drawing's units per frame height (the frame is 1000 units wide).
  const art = sketchObjects(shot.sketch ?? []);
  const unitsTall = 1000 / ratio;
  const artOf = (stroke: number) => art.find((o) => o.strokes.includes(stroke));
  /** A pickable thing's box, in fractions of the frame. */
  const boxOf = (p: Pick | null): Box | null => {
    if (!p) return null;
    if (p.kind === "layer") {
      const l = shot.layers[p.i];
      return l ? { x: l.x, y: l.y, w: l.w, h: l.h } : null;
    }
    const o = artOf(p.i);
    return o ? { x: o.box.x / 1000, y: o.box.y / unitsTall, w: o.box.w / 1000, h: o.box.h / unitsTall } : null;
  };
  const drag = useRef<Drag | null>(null);
  const [adding, setAdding] = useState(false); // the Add menu is open
  // A thing the user named, being made real where they put its box (found or drawn): asking, then drawing on.
  const [drawingOn, setDrawingOn] = useState<{ name: string; how: Making; box: Box; layer: Shot["layers"][number]; strokes?: NonNullable<Shot["sketch"]>; error?: string; step?: string; reveal?: Box } | null>(null);
  // The shot as it is now, for work that finishes later (Claude's drawing comes back after a few seconds).
  const latest = useRef(shot);
  latest.current = shot;
  const frame = useRef(0);
  const scale = Math.min(3, window.devicePixelRatio || 2);

  useEffect(() => setBox(fit()), [Boolean(said)]);
  useEffect(() => {
    open++;
    const onResize = () => setBox(fit());
    window.addEventListener("resize", onResize);
    return () => (open--, window.removeEventListener("resize", onResize));
  }, []);

  // The sketch under the drawing (without the user's strokes: those are the layer on top).
  // While a named thing is drawn on, its placeholder box isn't drawn under it.
  const under = drawingOn?.strokes ? { ...shot, layers: shot.layers.filter((l) => !isBoxOf(l, drawingOn.layer)) } : shot;
  const plain = JSON.stringify({ ...under, marks: undefined });
  const pictures = usePictures((p) => p.version); // a picture layer arrived: draw again
  useEffect(() => {
    if (base.current && picture !== undefined) texts.current = drawShot(base.current, box.w, box.h, scale, { ...under, marks: undefined }, b.draft, picture, theme, b.dir);
  }, [plain, picture, box.w, box.h, JSON.stringify(b.draft.look), theme, pictures]);

  // The strokes, drawn again whenever they change (undo, redo, clear, another size of window).
  const paint = (list: Mark[]) => {
    const c = ink.current;
    if (!c) return;
    c.width = Math.round(box.w * scale);
    c.height = Math.round(box.h * scale);
    const g = c.getContext("2d")!;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    strokeMarks(g, box.w, box.h, list, theme);
  };
  // The note being typed is the box on top: its old words aren't drawn under it.
  const shown = note ? marks.map((m, i) => (i === note.index ? { ...m, text: "" } : m)) : marks;
  useEffect(() => paint(shown), [JSON.stringify(shown), box.w, box.h, theme]);

  const snap = (): Snap => ({ marks, layers: shot.layers, query: shot.query, camera: shot.camera, sketch: shot.sketch });
  const remember = () => (setHistory((h) => [...h.slice(-49), snap()]), setUndone([]));
  const restore = (s: Snap) => {
    onChange(s.marks);
    onEdit?.({ layers: s.layers, query: s.query, camera: s.camera, sketch: s.sketch });
  };
  const commit = (next: Mark[]) => {
    remember();
    onChange(next);
  };
  /** A change to the shot itself (words, a move, a resize), as one undo step. */
  const edit = (patch: Partial<Shot>) => {
    if (!onEdit) return;
    remember();
    onEdit(patch);
  };
  const undo = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setUndone((u) => [...u, snap()]);
    restore(prev);
  };
  const redo = () => {
    const next = undone.at(-1);
    if (!next) return;
    setUndone((u) => u.slice(0, -1));
    setHistory((h) => [...h, snap()]);
    restore(next);
  };
  /** The picked object moved by (dx, dy) or removed: keys. */
  const nudge = (dx: number, dy: number) => {
    if (!boxOf(picked)) return;
    if (picked!.kind === "art") return edit({ sketch: moveObject(named(shot.sketch ?? [], artOf(picked!.i)!), artOf(picked!.i)!, dx * 1000, dy * unitsTall) });
    edit({ layers: shot.layers.map((l, i) => (i === picked!.i ? { ...l, x: clamp(l.x + dx, 0, 1 - l.w), y: clamp(l.y + dy, 0, 1 - l.h) } : l)) });
  };
  const removePicked = () => {
    if (!boxOf(picked)) return;
    if (picked!.kind === "art") {
      const gone = new Set(artOf(picked!.i)!.strokes);
      edit({ sketch: (shot.sketch ?? []).filter((_, i) => !gone.has(i)) });
    } else edit({ layers: shot.layers.filter((_, i) => i !== picked!.i) });
    setPicked(null);
  };

  // ---- Add: the user puts their own objects on the shot, to show what they want ----
  /** How far the next added thing steps from the last one, so new things don't land on top of each other. */
  const step = () => {
    const n = shot.layers.filter((l) => l.added).length + new Set((shot.sketch ?? []).filter((st) => st.added).map((st) => st.object)).size;
    return ((n % 5) - 2) * 0.06;
  };
  /** A new layer of theirs, picked straight away (its words open to type when it has any). */
  const addLayer = (l: Partial<Shot["layers"][number]> & { kind: Shot["layers"][number]["kind"] }, type = false, make?: Making) => {
    if (!onEdit || !editable) return;
    const d = step();
    const base = { x: 0.25, y: 0.4, w: 0.5, h: 0.1, ...l };
    const layer = { ...base, x: clamp(base.x + d, 0, 1 - base.w), y: clamp(base.y + d, 0, 1 - base.h), added: true } as Shot["layers"][number];
    const i = shot.layers.length;
    edit({ layers: [...shot.layers, layer] });
    setAdding(false);
    setTool("text");
    setPicked({ kind: "layer", i });
    if (type) setEditing({ hit: { kind: "layer", i, x: 0, y: 0, w: 0, h: 0 }, value: layer.text ?? "" });
    if (make) void makeNamed(layer, make);
  };

  /**
   * A thing the user named (a placeholder box's words) made real where the box is, one of two ways
   * they choose: "find" (a real picture of it from the web, checked, cut out and drawn in pencil from
   * it, wiped on as the pencil goes over it) or "draw" (Claude draws it in pencil, stroke by stroke,
   * as one object of the drawing). If it can't be done, the box stays (Claude makes it real when it
   * fixes the shot) and the other way can be tried.
   */
  const makeNamed = async (layer: Shot["layers"][number], how: Making) => {
    const name = layer.text?.trim();
    if (!name || drawingOn) return;
    const area = { x: layer.x * 1000, y: layer.y * unitsTall, w: layer.w * 1000, h: layer.h * unitsTall };
    setDrawingOn({ name, how, box: { x: layer.x, y: layer.y, w: layer.w, h: layer.h }, layer, step: how === "find" ? "Searching the web…" : `Drawing ${name}…` });
    setPicked(null);
    const fail = (error: string) => {
      setDrawingOn((d) => d && { ...d, error: error.split("\n")[0]!.slice(0, 140) });
      window.setTimeout(() => setDrawingOn(null), 7000);
    };

    if (how === "find") {
      // As an artist would: draw it from a real picture of it (found on the web, cut out, drawn in pencil).
      const off = window.creatron.onPictureProgress((p) => p.name === name && setDrawingOn((d) => (d && !d.reveal ? { ...d, step: p.step } : d)));
      const found = await window.creatron.findPicture(b.dir, name);
      off();
      if (!found.ok) return fail(found.error);
      setDrawingOn((d) => d && { ...d, step: "Loading the picture…" });
      const img = await new Promise<HTMLImageElement | null>((ok) => {
        const im = new Image();
        im.onload = () => ok(im);
        im.onerror = () => ok(null);
        im.src = mediaUrl(`${b.dir}/${found.value.file}`);
      });
      if (img) {
        // Its own shape, as big as fits where the box was, centred there.
        const ar = img.naturalWidth / img.naturalHeight; // width / height in pixels
        const boxAr = (layer.w * 1000) / (layer.h * unitsTall);
        const w = ar >= boxAr ? layer.w : (layer.h * unitsTall * ar) / 1000;
        const h = ar >= boxAr ? (layer.w * 1000) / ar / unitsTall : layer.h;
        const placed = { x: layer.x + (layer.w - w) / 2, y: layer.y + (layer.h - h) / 2, w, h };
        const now = latest.current;
        setHistory((hs) => [...hs.slice(-49), { marks: now.marks ?? [], layers: now.layers, query: now.query, camera: now.camera, sketch: now.sketch }]);
        setUndone([]);
        const at = now.layers.findIndex((l) => isBoxOf(l, layer));
        const drawn = { ...layer, ...round4(placed), kind: "image" as const, file: found.value.file, added: true };
        onEdit?.({ layers: at >= 0 ? now.layers.map((l, i) => (i === at ? drawn : l)) : [...now.layers, drawn] });
        // Drawn in front of them: the paper wiped away as the pencil goes over it.
        setDrawingOn((d) => d && { ...d, step: `Drawing ${name}…`, reveal: placed });
        window.setTimeout(() => {
          setDrawingOn(null);
          setTool("text");
          setPicked({ kind: "layer", i: at >= 0 ? at : now.layers.length });
        }, REVEAL * 1000);
        return;
      }
      return fail("the picture found couldn't be opened");
    }

    // Claude draws it in pencil, stroke by stroke.
    const r = await window.creatron.drawThing(name);
    if (!r.ok) return fail(r.error);
    const strokes = fitThing({ name, strokes: r.value }, area, latest.current.sketch ?? []);
    setDrawingOn((d) => d && { ...d, strokes });
    setPicked(null);
    // Once the last stroke is drawn on: the drawing joins the shot, the box goes, one undo step.
    window.setTimeout(() => {
      const now = latest.current;
      setHistory((h) => [...h.slice(-49), { marks: now.marks ?? [], layers: now.layers, query: now.query, camera: now.camera, sketch: now.sketch }]);
      setUndone([]);
      const gone = now.layers.findIndex((l) => isBoxOf(l, layer));
      onEdit?.({ layers: now.layers.filter((_, i) => i !== gone), sketch: [...(now.sketch ?? []), ...strokes] });
      setDrawingOn(null);
      setTool("text");
      setPicked({ kind: "art", i: (now.sketch ?? []).length });
    }, drawTime(strokes.length) * 1000);
  };
  /** A thing from the pencil library, as one object of the drawing, picked to move or resize. */
  const addThing = (thing: (typeof THINGS)[number]) => {
    if (!onEdit || !editable) return;
    const before = shot.sketch ?? [];
    const placed = placeThing(thing, unitsTall, before);
    const d = step();
    const moved = moveObject(placed, sketchObjects(placed)[0]!, d * 1000, d * unitsTall);
    edit({ sketch: [...before, ...moved] });
    setAdding(false);
    setTool("text");
    setPicked({ kind: "art", i: before.length });
  };
  /** A picture of theirs, copied into the storyboard's folder, as a picture layer Claude uses as it is. */
  const addPicture = async () => {
    const [file] = await window.creatron.pickLibrary();
    if (!file) return;
    const r = await window.creatron.boardAddFile(b.dir, file);
    if (!r.ok) return setAdding(false);
    addLayer({ kind: "image", x: 0.2, y: 0.3, w: 0.6, h: 0.3, file: r.value, text: file.split("/").pop()!.replace(/\.[^.]+$/, "") });
  };
  const clear = () => marks.length && commit([]);
  const canFix = Boolean(onFix && editable && !busy && handled(shot));
  const fix = () => canFix && onFix!();

  // Keys while drawing: P pencil, E eraser, [ ] size, ⌘Z undo, ⇧⌘Z redo, esc or return to finish.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) return; // typing a note or words, or the slider
      const k = e.key.toLowerCase();
      const used = () => (e.preventDefault(), e.stopImmediatePropagation());
      if ((e.metaKey || e.ctrlKey) && k === "z") return used(), e.shiftKey ? redo() : undo();
      if ((e.metaKey || e.ctrlKey) && k === "enter") return used(), fix();
      if (e.metaKey || e.ctrlKey) return;
      if (adding && k === "escape") return used(), setAdding(false);
      if (tool === "text" && picked !== null) {
        const step = e.shiftKey ? 0.05 : 0.01;
        if (k === "escape") return used(), setPicked(null);
        if (k === "backspace" || k === "delete") return used(), removePicked();
        if (k === "arrowleft") return used(), nudge(-step, 0);
        if (k === "arrowright") return used(), nudge(step, 0);
        if (k === "arrowup") return used(), nudge(0, -step);
        if (k === "arrowdown") return used(), nudge(0, step);
      }
      if (k === "escape" || k === "enter") return used(), onClose();
      if (k === "p" || k === "b") return used(), setTool("pen");
      if (k === "e") return used(), setTool("eraser");
      if (k === "a") return used(), setTool("arrow");
      if ((k === "t" || k === "v") && onEdit) return used(), setTool("text");
      if (k === "[") return used(), setSize((v) => Math.max(0, Math.round((v - 0.1) * 100) / 100));
      if (k === "]") return used(), setSize((v) => Math.min(1, Math.round((v + 0.1) * 100) / 100));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const at = (e: { clientX: number; clientY: number }) => {
    const r = ink.current!.getBoundingClientRect();
    return [round((e.clientX - r.left) / r.width), round((e.clientY - r.top) / r.height)] as const;
  };
  const moveCursor = (e: React.PointerEvent) => {
    const c = cursor.current;
    if (!c) return;
    const r = ink.current!.getBoundingClientRect();
    const d = Math.max(3, widthOf(tool, size) * Math.min(box.w, box.h));
    Object.assign(c.style, { width: `${d}px`, height: `${d}px`, transform: `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`, opacity: "1" });
  };

  /** The words under a point on the sketch: the smallest box that holds it (a label wins over the title under it). */
  const textAt = (e: { clientX: number; clientY: number }): TextHit | null => {
    const r = ink.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const pad = 4;
    const under = texts.current.filter((t) => px >= t.x - pad && px <= t.x + t.w + pad && py >= t.y - pad && py <= t.y + t.h + pad);
    return under.sort((a, z) => a.w * a.h - z.w * z.h)[0] ?? null;
  };
  /** What a piece of text says now, to edit. */
  const valueOf = (t: TextHit): string =>
    t.kind === "query" ? shot.query ?? "" : t.kind === "camera" ? shot.camera : t.kind === "enter" ? shot.layers[t.i!]?.enter ?? "cut"
      : t.kind === "note" ? shot.layers[t.i!]?.note ?? "" : shot.layers[t.i!]?.text ?? "";
  const startEdit = (t: TextHit) => editable && onEdit && (setHover(null), setEditing({ hit: t, value: valueOf(t) }));
  const saveEdit = (value = editing?.value) => {
    if (!editing || !onEdit) return;
    const { hit } = editing;
    setEditing(null);
    setHover(null); // the words may move when they're drawn again
    if (value === undefined || value === valueOf(hit)) return;
    const layers = (patch: (l: Shot["layers"][number]) => Shot["layers"][number]) => shot.layers.map((l, i) => (i === hit.i ? patch(l) : l));
    if (hit.kind === "query") edit({ query: value.trim() || undefined });
    else if (hit.kind === "camera") edit({ camera: value as Shot["camera"] });
    else if (hit.kind === "enter") edit({ layers: layers((l) => ({ ...l, enter: value as NonNullable<typeof l.enter> })) });
    else if (hit.kind === "note") edit({ layers: layers((l) => ({ ...l, note: value.trim() || undefined })) });
    else edit({ layers: layers((l) => ({ ...l, text: value })) });
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable || e.button !== 0) return;
    if (adding) return setAdding(false);
    if (editing) return saveEdit(); // a click outside the words finishes them
    if (tool === "text") {
      e.preventDefault(); // keep the focus for the box that opens (the click's own focus change would close it)
      const [x, y] = at(e);
      // The picked object's corner handle: resize. Anything else under the pointer: a label or note is
      // edited at once; an object is picked, and dragged if the pointer moves (a plain click edits its words).
      const p = boxOf(picked);
      const corner = p && Math.abs((p.x + p.w - x) * box.w) < 10 && Math.abs((p.y + p.h - y) * box.h) < 10;
      const t = corner ? ({ kind: picked!.kind, i: picked!.kind === "art" ? art.indexOf(artOf(picked!.i)!) : picked!.i } as TextHit) : textAt(e);
      if (!t) return setPicked(null);
      if (t.kind !== "layer" && t.kind !== "art") return startEdit(t);
      const pick: Pick = { kind: t.kind, i: t.kind === "art" ? art[t.i!]!.strokes[0]! : t.i! };
      const b0 = boxOf(pick);
      if (!b0) return;
      setPicked(pick);
      drag.current = {
        ...pick, mode: corner ? "resize" : "move", x0: x, y0: y, box: b0, moved: false,
        words: pick.kind === "layer" && !corner && picked?.kind === "layer" && picked.i === pick.i,
        art: pick.kind === "art" ? { strokes: named(shot.sketch ?? [], artOf(pick.i)!), object: artOf(pick.i)! } : undefined,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep the stroke going outside the frame
    } catch {}
    if (note) return saveNote(); // a click outside the note box finishes it
    const [x, y] = at(e);
    live.current = { tool, color, size: widthOf(tool, size), points: tool === "arrow" ? [x, y, x, y] : [x, y] };
    paint([...shown, live.current]);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "text") {
      const d = drag.current;
      if (d && onEdit) {
        const [x, y] = at(e);
        const dx = x - d.x0;
        const dy = y - d.y0;
        if (!d.moved && Math.hypot(dx * box.w, dy * box.h) < 3) return;
        if (!d.moved) (d.moved = true), remember(), setHover(null);
        const o = d.box;
        const next = d.mode === "move"
          ? { x: clamp(o.x + dx, -o.w * 0.5, 1 - o.w * 0.5), y: clamp(o.y + dy, -o.h * 0.5, 1 - o.h * 0.5), w: o.w, h: o.h }
          : { x: o.x, y: o.y, w: clamp(o.w + dx, 0.03, 1 - o.x), h: clamp(o.h + dy, 0.015, 1 - o.y) };
        // Drawn again at most once a frame while it moves (the sketch redraws around it).
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          if (d.art) {
            // The drawing's strokes as they were when the drag began, moved (or scaled, keeping its shape) from there.
            const k = d.mode === "resize" ? Math.max(0.1, Math.max(next.w / Math.max(o.w, 1e-4), next.h / Math.max(o.h, 1e-4))) : 1;
            onEdit({ sketch: moveObject(d.art.strokes, d.art.object, (next.x - o.x) * 1000, (next.y - o.y) * unitsTall, k) });
          } else onEdit({ layers: shot.layers.map((l, i) => (i === d.i ? { ...l, ...round4(next) } : l)) });
        });
        return;
      }
      const t = editing ? null : textAt(e);
      if (t?.kind !== hover?.kind || t?.i !== hover?.i) setHover(t);
      return;
    }
    moveCursor(e);
    const m = live.current;
    if (!m) return;
    if (m.tool === "arrow") {
      // The arrow follows the pointer from where it started.
      const [x, y] = at(e);
      m.points[2] = x;
      m.points[3] = y;
      return paint([...shown, m]);
    }
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const g = ink.current!.getContext("2d")!;
    for (const ev of events) {
      const [x, y] = at(ev);
      const px = m.points[m.points.length - 2]!;
      const py = m.points[m.points.length - 1]!;
      if (Math.hypot((x - px) * box.w, (y - py) * box.h) < 1.5) continue;
      m.points.push(x, y);
      // Just the new bit, straight away; the whole stroke is smoothed when it's done.
      g.save();
      g.globalCompositeOperation = m.tool === "eraser" ? "destination-out" : "source-over";
      g.strokeStyle = m.color;
      g.lineCap = "round";
      g.lineWidth = Math.max(1, m.size * Math.min(box.w, box.h));
      g.beginPath();
      g.moveTo(px * box.w, py * box.h);
      g.lineTo(x * box.w, y * box.h);
      g.stroke();
      g.restore();
    }
  };
  const up = () => {
    const d = drag.current;
    if (d) {
      drag.current = null;
      // A click on an object already picked, without moving it: change its words.
      if (!d.moved && d.words) startEdit({ kind: "layer", i: d.i, x: 0, y: 0, w: 0, h: 0 });
      return;
    }
    const m = live.current;
    live.current = null;
    if (!m) return;
    if (m.tool === "arrow") {
      // Too short to be an arrow: nothing. Otherwise kept, and its note box opens at the tail.
      if (Math.hypot((m.points[2]! - m.points[0]!) * box.w, (m.points[3]! - m.points[1]!) * box.h) < 14) return paint(marks);
      commit([...marks, { ...m, text: "" }]);
      return setNote({ index: marks.length, text: "" });
    }
    commit([...marks, m]);
  };
  // The note's words go on the arrow; one edit is one undo step.
  const saveNote = () => {
    if (!note) return;
    const current = shot.marks ?? [];
    const k = current[note.index];
    setNote(null);
    if (!k || (k.text ?? "") === note.text.trim()) return;
    commit(current.map((x, i) => (i === note.index ? { ...x, text: note.text.trim() } : x)));
  };
  // Double-click a note to change it.
  const editNote = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = ink.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const g = document.createElement("canvas").getContext("2d")!;
    const i = marks.findLastIndex((k) => {
      if (k.tool !== "arrow") return false;
      const nb = noteBox(g, box.w, box.h, k) ?? { x: k.points[0]! * box.w - 12, y: k.points[1]! * box.h - 12, w: 24, h: 24 };
      return px >= nb.x && px <= nb.x + nb.w && py >= nb.y && py <= nb.y + nb.h;
    });
    if (i >= 0) return setNote({ index: i, text: marks[i]!.text ?? "" });
    // Not a note of theirs: the sketch's own words, whatever the tool.
    const t = textAt(e);
    if (t) startEdit(t);
  };
  const noteAt = note && marks[note.index] ? { x: marks[note.index]!.points[0]! * box.w, y: marks[note.index]!.points[1]! * box.h } : null;

  return (
    <div className="sb-pad" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sb-pad-bar" role="toolbar" aria-label="Drawing tools">
        <span className="sb-pad-title"><b>Shot {String(index + 1).padStart(2, "0")}</b> Draw what you want instead</span>
        <div className="sb-pad-group">
          <button className={tool === "pen" ? "on" : ""} disabled={!editable} onClick={() => setTool("pen")} title="Pencil (P)"><Icon name="pencil" size={15} /> Pencil</button>
          <button className={tool === "arrow" ? "on" : ""} disabled={!editable} onClick={() => setTool("arrow")} title="Arrow with a note (A): drag from where the note goes to what it's about, then type"><Icon name="arrowNote" size={15} /> Arrow</button>
          <button className={tool === "eraser" ? "on" : ""} disabled={!editable} onClick={() => setTool("eraser")} title="Eraser (E): rubs out your lines, never the sketch"><Icon name="eraser" size={15} /> Eraser</button>
          {onEdit && <button className={tool === "text" ? "on" : ""} disabled={!editable} onClick={() => setTool("text")} title="Select (V): drag an object to move it, its corner to resize it; click words to change them; ←↑→↓ nudge, ⌫ removes"><Icon name="cursor" size={15} /> Select</button>}
          {onEdit && (
            <span className="sb-pad-addwrap">
              <button className={adding ? "on" : ""} disabled={!editable} onClick={() => setAdding(!adding)} title="Add a title, a shape, a thing or your own picture to this shot, to show Claude what you want"><Icon name="plus" size={15} /> Add</button>
              {adding && <AddMenu onLayer={addLayer} onThing={addThing} onPicture={() => void addPicture()} />}
            </span>
          )}
        </div>
        <div className="sb-pad-group colors">
          {MARK_COLORS.map((c) => (
            <button key={c} className={`sb-pad-color ${color === c && tool !== "eraser" ? "on" : ""}`} style={{ ["--c" as string]: c }} disabled={!editable}
              onClick={() => (setColor(c), tool === "eraser" && setTool("pen"))} title={COLOR_NAMES[c]} aria-label={COLOR_NAMES[c]} />
          ))}
        </div>
        <label className="sb-pad-group sb-pad-size" title="Size: slide left for thin, right for thick ([ and ])">
          <i className="sb-pad-size-dot" style={{ width: 4 + size * 14, height: 4 + size * 14, background: tool === "eraser" ? "transparent" : color }} />
          <input
            type="range" min={0} max={1} step={0.01} value={size} disabled={!editable} aria-label="Size"
            style={{ ["--v" as string]: `${size * 100}%` }} onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>
        <div className="sb-pad-group">
          <button className="icon" disabled={!editable || !history.length} onClick={undo} title="Undo (⌘Z)"><Icon name="undo" size={15} /></button>
          <button className="icon" disabled={!editable || !undone.length} onClick={redo} title="Redo (⇧⌘Z)"><Icon name="redo" size={15} /></button>
          <button disabled={!editable || !marks.length} onClick={clear} title="Rub out all your lines on this shot">Clear</button>
        </div>
        {onFix && (
          <button className="export-btn sb-pad-fix" disabled={!canFix} onClick={fix}
            title="Claude changes just this shot, from your drawing and notes. If something can't be filmed or found, it says why. (⌘↵)">
            <Icon name="sparkle" size={13} /> {busy ? "Fixing…" : "Fix with Claude"} <kbd>⌘↵</kbd>
          </button>
        )}
        <button className="sb-pad-done" onClick={onClose}>Done <kbd>esc</kbd></button>
      </div>
      <div className={`sb-pad-stage ${tool}`} style={{ width: box.w, height: box.h }}>
        <canvas ref={base} style={{ width: box.w, height: box.h }} />
        <canvas
          ref={ink} className="sb-pad-ink" style={{ width: box.w, height: box.h }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={editNote}
          onPointerLeave={() => cursor.current && (cursor.current.style.opacity = "0")}
        />
        {editable && tool !== "arrow" && tool !== "text" && <div ref={cursor} className={`sb-pad-cursor ${tool}`} style={{ ["--c" as string]: color }} />}
        {tool === "text" && boxOf(picked) && !editing && (() => {
          const l = boxOf(picked)!;
          return (
            <div className="sb-pad-picked" style={{ left: l.x * box.w - 3, top: l.y * box.h - 3, width: l.w * box.w + 6, height: l.h * box.h + 6 }}>
              <i className="sb-pad-handle" />
            </div>
          );
        })()}
        {drawingOn?.reveal && (
          <div className="sb-pad-reveal" style={{ left: drawingOn.reveal.x * box.w - 4, top: drawingOn.reveal.y * box.h - 4, width: drawingOn.reveal.w * box.w + 8, height: drawingOn.reveal.h * box.h + 8, ["--page" as string]: theme === "paper" ? "#f3efe6" : "#0f0f0f", animationDuration: `${REVEAL}s` }}>
            <i style={{ animationDuration: `${REVEAL}s` }}><Icon name="pencil" size={22} /></i>
          </div>
        )}
        {drawingOn && !drawingOn.strokes && !drawingOn.reveal && (
          <div className={`sb-pad-asking ${drawingOn.error ? "failed" : ""}`} style={{ left: drawingOn.box.x * box.w, top: drawingOn.box.y * box.h, width: drawingOn.box.w * box.w, height: drawingOn.box.h * box.h }}>
            {drawingOn.error ? (
              <span>
                {drawingOn.how === "find" ? "Couldn't find a picture" : "Couldn't draw it"}: {drawingOn.error}. It stays a box: try {drawingOn.how === "find" ? "Draw it" : "Find a picture"}, or Claude makes it real when it fixes the shot.
              </span>
            ) : (
              <><Icon name={drawingOn.how === "find" ? "search" : "pencil"} size={20} /><span className="shimmer">{drawingOn.step ?? `Drawing ${drawingOn.name}…`}</span></>
            )}
          </div>
        )}
        {drawingOn?.strokes && <DrawOn strokes={drawingOn.strokes} unitsTall={unitsTall} theme={theme} />}
        {tool === "text" && picked?.kind === "layer" && !editing && !drawingOn && (() => {
          const l = shot.layers[picked.i];
          if (!l || l.kind !== "image" || l.file || !l.text?.trim()) return null;
          return (
            <div className="sb-pad-drawit" style={{ left: l.x * box.w, top: Math.min(box.h - 34, (l.y + l.h) * box.h + 8) }} onPointerDown={(e) => e.stopPropagation()}>
              <button onClick={() => void makeNamed(l, "draw")} title={`Claude draws ${l.text} here, in pencil`}>
                <Icon name="pencil" size={13} /> Draw it
              </button>
              <button onClick={() => void makeNamed(l, "find")} title={`Claude searches the web for a real picture of ${l.text}, checks it, and it's drawn in pencil from it`}>
                <Icon name="search" size={13} /> Find a picture
              </button>
            </div>
          );
        })()}
        {tool === "text" && hover && !editing && !(hover.kind === picked?.kind && (hover.kind === "art" ? art[hover.i!] === artOf(picked!.i) : hover.i === picked?.i)) && (
          <div className="sb-pad-texthover" style={{ left: hover.x - 4, top: hover.y - 4, width: hover.w + 8, height: hover.h + 8 }} />
        )}
        {editing && <TextEditor key={`${editing.hit.kind}${editing.hit.i ?? ""}`} edit={editing.hit.kind === "layer" && shot.layers[editing.hit.i!] ? { ...editing, hit: { ...editing.hit, x: shot.layers[editing.hit.i!]!.x * box.w, y: shot.layers[editing.hit.i!]!.y * box.h, w: shot.layers[editing.hit.i!]!.w * box.w, h: shot.layers[editing.hit.i!]!.h * box.h } } : editing} box={box} onChange={(value) => setEditing({ ...editing, value })} onSave={saveEdit} onCancel={() => setEditing(null)} />}
        {busy && (
          <div className="sb-redraw-mark big">
            <StoryboardMark size={96} animated />
            <b>Claude is fixing shot {String(index + 1).padStart(2, "0")}</b>
            <span className="shimmer">Reading your drawing. Nothing else on the storyboard changes.</span>
          </div>
        )}
        {note && noteAt && (
          <input
            className="sb-pad-note" autoFocus value={note.text} placeholder="What should change here?" maxLength={80}
            style={{ left: Math.min(box.w - 230, Math.max(4, noteAt.x - 115)), top: Math.min(box.h - 40, Math.max(4, noteAt.y - 18)), ["--c" as string]: marks[note.index]?.color }}
            onChange={(e) => setNote({ ...note, text: e.target.value })}
            // A box that loses focus the moment it opens (the click that made the arrow) keeps it; later, leaving it saves it.
            onBlur={(e) => (performance.now() - noteOpened.current < 250 ? requestAnimationFrame(() => e.target.focus()) : saveNote())}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                saveNote();
                // ⌘↵: save the note and have Claude fix the shot now.
                if ((e.metaKey || e.ctrlKey) && note.text.trim() && onFix && editable && !busy) onFix();
              }
              if (e.key === "Escape") setNote(null);
            }}
          />
        )}
      </div>
      {said && !busy ? <ClaudeSaid said={said} onTry={editable ? onTry : undefined} disabled={!editable} /> : <p className="sb-pad-hint">
        {busy
          ? "Claude is reading your drawing and notes. The new version of this shot shows up right here."
          : editable
          ? tool === "text"
            ? picked !== null
              ? `Drag it to move it, its corner to resize it${picked?.kind === "layer" ? ", click it again to change its words" : ""}. Arrows nudge it (⇧ for more), ⌫ removes it, ⌘Z undoes.`
              : "Drag anything to move it: the drawing's objects, titles, tags, captions, cards. Click words to change them, a movement label to change the move."
            : tool === "arrow"
            ? "Drag from where your note goes to what it's about, then type. ⌘↵ saves it and has Claude fix this shot."
            : "Circle it, cross it out, sketch where it goes, or point at it with a note. Fix with Claude changes just this shot."
          : "This storyboard isn't waiting for an answer, so drawing is off."}
      </p>}
    </div>
  );
}

/**
 * The words being changed, right where they are on the sketch: a text box over a title, caption,
 * tag, the B-roll / page line or a note; a short list over a movement label (the camera's move, or
 * how the layer comes in). Return saves, esc leaves it as it was.
 */
function TextEditor({ edit, box, onChange, onSave, onCancel }: {
  edit: { hit: TextHit; value: string }; box: { w: number; h: number };
  onChange: (value: string) => void; onSave: (value?: string) => void; onCancel: () => void;
}) {
  const { hit, value } = edit;
  const opened = useRef(performance.now());
  const w = Math.min(box.w - 8, Math.max(hit.kind === "note" ? 220 : 180, hit.w + 16));
  const left = Math.min(box.w - w - 4, Math.max(4, hit.x + hit.w / 2 - w / 2));
  const top = Math.min(box.h - 44, Math.max(4, hit.y - 4));
  if (hit.kind === "camera" || hit.kind === "enter") {
    const options = hit.kind === "camera"
      ? CAMERAS.map((c) => [c, CAMERA_LABEL[c]] as const)
      : ENTERS.map((x) => [x, x === "cut" ? "Just there (no move)" : ENTER_LABEL[x]] as const);
    return (
      <div className="sb-pad-edit menu" style={{ left, top, width: w }} onPointerDown={(e) => e.stopPropagation()}>
        <b>{hit.kind === "camera" ? "Camera move" : "How it comes in"}</b>
        {options.map(([v, label]) => (
          <button key={v} className={v === value ? "on" : ""} onClick={() => onSave(v)}>{label}</button>
        ))}
        <button className="cancel" onClick={onCancel}>Cancel <kbd>esc</kbd></button>
      </div>
    );
  }
  const lines = Math.min(5, Math.max(1, Math.ceil(value.length / Math.max(14, w / 9)) + (value.match(/\n/g)?.length ?? 0)));
  return (
    <div className="sb-pad-edit" style={{ left, top, width: w }} onPointerDown={(e) => e.stopPropagation()}>
      <b>{hit.kind === "query" ? "What it shows" : hit.kind === "note" ? "Note" : "Text"}</b>
      <textarea
        autoFocus rows={lines} value={value} spellCheck
        placeholder={hit.kind === "query" ? "What the picture must show" : hit.kind === "note" ? "A detail of how it moves or is built" : "The words"}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        // A box that loses focus the moment it opens (the click that opened it) keeps it; later, leaving it saves it.
        onBlur={(e) => (performance.now() - opened.current < 300 ? requestAnimationFrame(() => e.target.focus()) : onSave())}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), onSave());
          if (e.key === "Escape") (e.preventDefault(), onCancel());
        }}
      />
    </div>
  );
}

/**
 * Add: what the user can put on a shot to show what they want. Words (a title, a tag, a caption),
 * shapes (a frame, an arrow, a sticker), things (pencil drawings from the library), something else
 * (named in their words: a placeholder Claude makes real), or their own picture.
 */
function AddMenu({ onLayer, onThing, onPicture }: {
  onLayer: (l: Partial<Shot["layers"][number]> & { kind: Shot["layers"][number]["kind"] }, type?: boolean, make?: Making) => void;
  onThing: (t: (typeof THINGS)[number]) => void;
  onPicture: () => void;
}) {
  const [name, setName] = useState("");
  const other = (how: Making) => name.trim() && onLayer({ kind: "image", x: 0.25, y: 0.3, w: 0.5, h: 0.28, text: name.trim() }, false, how);
  return (
    <div className="sb-pad-add" onPointerDown={(e) => e.stopPropagation()}>
      <b>Words</b>
      <div className="row">
        <button onClick={() => onLayer({ kind: "text", x: 0.1, y: 0.38, w: 0.8, h: 0.1, text: "YOUR TITLE" }, true)}>Title</button>
        <button onClick={() => onLayer({ kind: "text", x: 0.3, y: 0.45, w: 0.4, h: 0.05, text: "TAG", effect: "tag" }, true)}>Tag</button>
        <button onClick={() => onLayer({ kind: "caption", x: 0.1, y: 0.76, w: 0.8, h: 0.035, text: "what is said here" }, true)}>Caption</button>
      </div>
      <b>Shapes</b>
      <div className="row">
        <button onClick={() => onLayer({ kind: "box", x: 0.25, y: 0.35, w: 0.5, h: 0.25 })}>Frame</button>
        <button onClick={() => onLayer({ kind: "arrow", x: 0.3, y: 0.45, w: 0.3, h: 0.1 })}>Arrow</button>
        <button onClick={() => onLayer({ kind: "sticker", x: 0.4, y: 0.45, w: 0.2, h: 0.11, text: "NEW" }, true)}>Sticker</button>
      </div>
      <b>Things</b>
      <div className="things">
        {THINGS.map((t) => (
          <button key={t.name} onClick={() => onThing(t)} title={`Add a ${t.name}`}>
            <svg viewBox="0 0 300 300" aria-hidden>{t.strokes.map((st, i) => <path key={i} d={st.d} />)}</svg>
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      <b>Something else</b>
      <div className="row other">
        <input value={name} placeholder="a robot dog, the Eiffel Tower…" maxLength={60} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => (e.stopPropagation(), e.key === "Enter" && other("draw"))} />
      </div>
      <div className="row make">
        <button onClick={() => other("draw")} disabled={!name.trim()} title="Claude draws it in pencil, in front of you"><Icon name="pencil" size={13} /> Draw it</button>
        <button onClick={() => other("find")} disabled={!name.trim()} title="Claude searches the web for a real picture of it, checks it's right, and it's drawn in pencil from it"><Icon name="search" size={13} /> Find a picture</button>
      </div>
      <button className="picture" onClick={onPicture}><Icon name="grid" size={13} /> Your picture…</button>
    </div>
  );
}

/** The placeholder box of a named thing: the same layer, or (moved or edited since) the user's box with those words. */
const isBoxOf = (l: Shot["layers"][number], box: Shot["layers"][number]) =>
  l === box || (l.kind === "image" && !l.file && Boolean(l.added) === Boolean(box.added) && (l.text ?? "").trim() === (box.text ?? "").trim());

/** How a named thing is made real: Claude draws it, or a real picture of it is found on the web and drawn from. */
type Making = "draw" | "find";

/** How long a picture takes to be drawn in (seconds). */
const REVEAL = 2.6;

/** How long a drawing of n strokes takes to draw on (seconds): each stroke a beat after the last. */
const STROKE_BEAT = 0.36;
const drawTime = (n: number) => n * STROKE_BEAT + 0.9;

/**
 * Claude's drawing of a thing, drawn on in front of the user: each stroke traced in pencil in order
 * (big shapes, then parts, then details), its shading filling in after. Lies over the sketch, in the
 * drawing's units (the frame 1000 wide).
 */
function DrawOn({ strokes, unitsTall, theme }: { strokes: NonNullable<Shot["sketch"]>; unitsTall: number; theme: SketchTheme }) {
  const ink = theme === "paper" ? "#2a292e" : "#e4e4e4";
  return (
    <svg className="sb-pad-drawon" viewBox={`0 0 1000 ${unitsTall}`} preserveAspectRatio="none" style={{ ["--ink" as string]: ink }}>
      {strokes.map((st, i) => (
        <g key={i}>
          {st.shade ? <path className="fill" d={st.d} style={{ animationDelay: `${strokes.length * STROKE_BEAT * 0.6 + i * 0.05}s`, ["--o" as string]: st.shade * 0.32 }} /> : null}
          <path className="line" d={st.d} pathLength={1} style={{ animationDelay: `${i * STROKE_BEAT}s` }} />
        </g>
      ))}
    </svg>
  );
}
