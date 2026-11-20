// The storyboard sheet: the first thing a full edit shows. Every shot of the coming video as a sketch
// made from the user's own footage (halftone dots), with its line, its look and its motion. The user
// reads it like a director's board, plays it as an animatic over their voice, changes any shot, asks
// Claude to redraw, downloads it as a PDF, and approves: only then is the video built.
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import {
  BEAT_LABEL, CAMERAS, CAMERA_LABEL, KIND_LABEL, SHOT_KINDS, type Shot, type Storyboard, TRANSITIONS, type Verdict, type Layer, EFFECTS, FONTS, fontParts, fontStack, TRANSITION_LABEL, boardLength,
  movesOf,
} from "../src/storyboard.ts";
import { mediaUrl } from "./format.ts";
import { Icon } from "./icons.tsx";
import { StoryboardMark } from "./StoryboardMark.tsx";
import { ClaudeSaid } from "./ClaudeSaid.tsx";
import { SketchPad, sketching } from "./SketchPad.tsx";
import { DictationBar, DictationNote, MicButton, appendSpeech, dictating, useDictation } from "./Dictation.tsx";
import { type BoardState, useEditor } from "./store.ts";
import { INK, PAPER, accentOf, aspect, drawShot } from "./storyboardSketch.ts";


const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
const len = (s: Shot) => Math.max(0, s.to - s.from);

// ---- pictures ----

const pictures = new Map<string, Promise<HTMLImageElement | null>>();

/** The file and moment a shot's picture comes from, or null when it has none yet. */
function shotSource(b: BoardState, s: Shot): { file: string; at: number } | null {
  const src = s.source;
  // From a script: nothing is filmed yet, so only the user's own assets have pictures.
  if (b.plan) return src?.file && src.file !== "main" ? { file: src.file.startsWith("/") ? src.file : `${b.dir}/${src.file.replace(/^\.\//, "")}`, at: src.at ?? 1 } : null;
  if (!src) return s.kind === "broll" || s.kind === "image" || s.kind === "text" || s.kind === "graphic" ? null : { file: b.video, at: (s.from + s.to) / 2 };
  if (src.file === "main" || !src.file) return { file: b.video, at: src.at ?? (s.from + s.to) / 2 };
  return { file: src.file.startsWith("/") ? src.file : `${b.dir}/${src.file.replace(/^\.\//, "")}`, at: src.at ?? 1 };
}

function loadPicture(file: string, at: number): Promise<HTMLImageElement | null> {
  const key = `${file}|${at.toFixed(2)}`;
  if (!pictures.has(key))
    pictures.set(key, window.creatron.frameAt(file, at, 360).then((url) => {
      if (!url) return null;
      return new Promise<HTMLImageElement | null>((ok) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => ok(null);
        img.src = url;
      });
    }).catch(() => null));
  return pictures.get(key)!;
}

function usePicture(b: BoardState, s: Shot): HTMLImageElement | null | undefined {
  const src = shotSource(b, s);
  const key = src ? `${src.file}|${src.at}` : "";
  const [img, setImg] = useState<HTMLImageElement | null | undefined>(src ? undefined : null);
  useEffect(() => {
    if (!src) return setImg(null);
    let alive = true;
    setImg(undefined);
    loadPicture(src.file, src.at).then((i) => alive && setImg(i));
    return () => void (alive = false);
  }, [key]);
  return img;
}

/**
 * How wide a shot is drawn on a card and in the shot view, by format: a 9:16 frame is drawn tall and
 * narrow, a 16:9 one wide, so every format gets a readable picture and the same card proportions.
 */
export function frameSizes(format: Storyboard["format"]): { card: number; drawer: number } {
  const r = aspect(format);
  return r >= 1.5 ? { card: 300, drawer: 392 } : r >= 1 ? { card: 230, drawer: 300 } : r >= 0.75 ? { card: 200, drawer: 260 } : { card: 176, drawer: 232 };
}

/** The storyboard's page colour: dark (Creatro's own) or light (paper and ink, like the PDF). Remembered. */
const THEME_KEY = "creatro.storyboard.theme";
export const useBoardTheme = create<{ theme: "dark" | "light" }>(() => {
  try {
    return { theme: localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark" };
  } catch {
    return { theme: "dark" };
  }
});
function setBoardTheme(theme: "dark" | "light") {
  useBoardTheme.setState({ theme });
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}
/** The sketch style for the page colour. */
export const sketchTheme = (t: "dark" | "light") => (t === "light" ? "paper" : "dark");

/** One shot, drawn. Redraws when the shot or the look changes. */
export function Sketch({ b, shot, width, className, theme: fixed }: { b: BoardState; shot: Shot; width: number; className?: string; theme?: "dark" | "light" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const picture = usePicture(b, shot);
  const ratio = aspect(b.draft.format);
  const height = Math.round(width / ratio);
  const look = JSON.stringify(b.draft.look);
  const data = JSON.stringify(shot);
  const chosen = useBoardTheme((t) => t.theme);
  const theme = fixed ?? chosen;
  useEffect(() => {
    if (!ref.current || picture === undefined) return;
    drawShot(ref.current, width, height, Math.min(3, window.devicePixelRatio || 2), shot, b.draft, picture, sketchTheme(theme));
  }, [data, look, picture, width, theme]);
  return (
    <div className={`sb-sketch ${picture === undefined ? "loading" : ""} ${className ?? ""}`} style={{ width, height }}>
      <canvas ref={ref} style={{ width, height }} />
    </div>
  );
}

// ---- the sheet ----

export function StoryboardSheet() {
  const b = useEditor((s) => s.board);
  const open = useEditor((s) => s.boardOpen);
  const [focus, setFocus] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const theme = useBoardTheme((t) => t.theme);
  const [playing, setPlaying] = useState(false);
  const [changes, setChanges] = useState("");
  const dictation = useDictation((said) => setChanges((c) => appendSpeech(c, said)));
  const [pdf, setPdf] = useState<"" | "making" | string>("");
  const [note, setNote] = useState("");
  /** The user chose "All shots" while one was picked. Picking another shot goes back to just it. */
  const [whole, setWhole] = useState(false);
  const [hideSaid, setHideSaid] = useState(false);
  const close = () => useEditor.setState({ boardOpen: false });

  // A new draft: the box empties; the open shot stays open (after a redraw of it, that's the new one).
  useEffect(() => {
    setChanges("");
    setNote("");
    setPdf("");
    setHideSaid(false);
  }, [b?.round, b?.dir]);
  useEffect(() => setFocus(null), [b?.dir]);
  useEffect(() => setWhole(false), [focus]);

  // Keys: ← → between shots, space plays, esc closes, ⌘⏎ approves. Kept from the editor underneath.
  useEffect(() => {
    if (!open || !b) return;
    const onKey = (e: KeyboardEvent) => {
      if (dictating() || sketching()) return; // Esc and Return belong to the mic or the drawing view while they're open
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? "");
      if (e.key === "Escape") {
        e.stopPropagation();
        if (playing) setPlaying(false);
        else if (focus) setFocus(null);
        else close();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") return e.preventDefault(), void approve();
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        // Undo / redo step between Claude's drafts (the editor underneath keeps its own undo).
        e.preventDefault();
        e.stopPropagation();
        return stepDraft(e.shiftKey ? 1 : -1);
      }
      const shots = b.draft.shots;
      const i = shots.findIndex((s) => s.id === focus);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        const next = shots[Math.min(shots.length - 1, Math.max(0, (i < 0 ? -1 : i) + (e.key === "ArrowRight" ? 1 : -1)))];
        if (next) setFocus(next.id);
      } else if (e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        setPlaying(!playing);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, b, focus, playing]);

  // "PDF saved" goes away by itself.
  useEffect(() => {
    if (!pdf || pdf === "making") return;
    const t = setTimeout(() => setPdf(""), 8000);
    return () => clearTimeout(t);
  }, [pdf]);

  if (!open || !b) return null;
  const board = b.draft;
  const shots = board.shots;
  const kept = shots.filter((s) => !s.dropped);
  const total = boardLength(board);
  const accent = accentOf(board);
  const waiting = b.status === "waiting";
  const redrawing = b.status === "redrawing";
  const edited = shots.some((s) => s.dropped || s.ask?.trim() || s.marks?.length);
  const focused = shots.find((s) => s.id === focus);
  const sizes = frameSizes(board.format);
  const numOf = (id: string) => String(shots.findIndex((s) => s.id === id) + 1).padStart(2, "0");
  // What a Redraw changes: the open shot and any the user drew on or wrote a note on. Nothing else.
  const noted = shots.filter((s) => s.ask?.trim() || s.marks?.length).map((s) => s.id);
  const pickable = [...new Set([...(focus ? [focus] : []), ...noted])];
  const picked = whole ? [] : pickable;
  const pickedLabel = picked.length === 1 ? `Shot ${numOf(picked[0])}` : `${picked.length} shots`;
  const redrawingOnly = redrawing && b.only?.length ? b.only : undefined;
  const versions = b.versions ?? [board];
  const at = b.at ?? versions.length - 1;

  const update = (id: string, patch: Partial<Shot>) => {
    const s = useEditor.getState().board;
    if (!s) return;
    useEditor.setState({ board: { ...s, draft: { ...s.draft, shots: s.draft.shots.map((x) => (x.id === id ? { ...x, ...patch } : x)) } } });
  };

  /** Undo / redo: another of Claude's drafts. Edits on the one left (notes, drawings) stay with it. */
  function stepDraft(by: number) {
    const s = useEditor.getState().board;
    if (!s?.versions || s.status !== "waiting") return;
    const from = s.at ?? s.versions.length - 1;
    const to = from + by;
    if (to < 0 || to >= s.versions.length) return;
    const versions = s.versions.slice();
    versions[from] = s.draft;
    useEditor.setState({ board: { ...s, versions, at: to, draft: versions[to] } });
  }

  async function approve() {
    const s = useEditor.getState().board;
    if (!s || s.status !== "waiting") return;
    const ok = await window.creatron.storyboardAnswer(s.video, { approve: true, board: s.draft, drawings: await drawings(s) });
    if (!ok) return setNote(s.plan ? "This storyboard isn't waiting any more (it was stopped). Make a new one from the Storyboard Creator." : "This storyboard isn't waiting any more (the edit was stopped). Ask for a full edit again to start over.");
    // A full edit goes on to build the video; a plan from a script stays open, for its PDF.
    useEditor.setState({ board: { ...s, status: "approved" }, boardOpen: Boolean(s.plan) });
  }

  /** Sends the changes to Claude: `only` = the shots that may change (the rest stay exactly as they are). */
  async function redraw(text = changes, only: string[] | undefined = picked.length ? picked : undefined) {
    const s = useEditor.getState().board;
    if (!s || s.status !== "waiting") return;
    const touched = s.draft.shots.filter((x) => !only || only.includes(x.id));
    if (!text.trim() && !touched.some((x) => x.ask?.trim() || x.dropped || x.marks?.length)) return setNote("Say what to change, draw on a shot, or add a note to one first.");
    const ok = await window.creatron.storyboardAnswer(s.video, { approve: false, board: s.draft, changes: text, drawings: await drawings(s), only });
    if (!ok) return setNote("This storyboard isn't waiting any more (the edit was stopped).");
    setNote("");
    useEditor.setState({ board: { ...s, status: "redrawing", only } });
  }

  async function makePdf() {
    setPdf("making");
    try {
      const html = await pdfHtml(b!);
      const r = await window.creatron.storyboardPdf(b!.dir, html, board.title);
      if (!r.ok) throw new Error(r.error);
      setPdf(r.value);
      window.creatron.openFile(r.value);
    } catch (e) {
      setPdf("");
      setNote(`Couldn't make the PDF: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let t = 0;
  const outAt = new Map(kept.map((s) => [s.id, ((t += len(s)), t - len(s))]));

  return (
    <div className={`sb ${theme === "light" ? "light" : ""}`} onKeyDown={(e) => e.stopPropagation()} style={{ ["--sb-accent" as string]: accent }}>
      <header className="sb-head">
        <button className="icon-btn" onClick={close} title="Close (esc). The storyboard stays in the chat."><Icon name="close" /></button>
        <div className="sb-head-title">
          <span className={`sb-state ${b.status}`}><i />Storyboard{versions.length < 2 && b.round > 1 ? ` · draft ${b.round}` : ""} · {b.status === "approved" ? "approved" : waiting ? "waiting for your OK" : redrawing ? "redrawing" : "closed"}</span>
          <h2>{board.title}</h2>
        </div>
        <div className="sb-head-r">
          {versions.length > 1 && (
            // Claude's drafts, oldest first: step back to one you liked better, and forward again. None is lost.
            <div className="sb-versions" role="group" aria-label="Drafts">
              <button onClick={() => stepDraft(-1)} disabled={!waiting || at <= 0} title={`Undo: back to draft ${at} (⌘Z)`}><Icon name="undo" size={14} /></button>
              <span title={`You're looking at draft ${at + 1} of ${versions.length}`}>Draft <b>{at + 1}</b><em>/{versions.length}</em></span>
              <button onClick={() => stepDraft(1)} disabled={!waiting || at >= versions.length - 1} title={`Redo: on to draft ${at + 2} (⇧⌘Z)`}><Icon name="redo" size={14} /></button>
            </div>
          )}
          <div className="sb-theme" role="group" aria-label="Page colour">
            <button className={theme === "dark" ? "on" : ""} onClick={() => setBoardTheme("dark")} title="Dark page" aria-pressed={theme === "dark"}><Icon name="moon" size={14} /></button>
            <button className={theme === "light" ? "on" : ""} onClick={() => setBoardTheme("light")} title="Light page: paper and ink, like the PDF" aria-pressed={theme === "light"}><Icon name="sun" size={14} /></button>
          </div>
          <button className="sb-btn" onClick={() => setPlaying(true)} disabled={!kept.length}><Icon name="play" size={11} fill /> Play animatic</button>
          <button className="sb-btn" onClick={makePdf} disabled={pdf === "making"}><Icon name="download" size={13} /> {pdf === "making" ? "Making PDF…" : "PDF"}</button>
        </div>
      </header>

      <section className="sb-brief">
        <p className="sb-idea">{board.idea}</p>
        <div className="sb-facts">
          <span className="sb-fact"><b>Shots</b>{kept.length} · {clock(total)} · {board.format}</span>
          <span className="sb-fact"><b>Palette</b><span className="sb-swatches">{board.look.palette.map((c) => <i key={c} style={{ background: c }} title={c} />)}</span></span>
          <span className="sb-fact"><b>Font</b><span style={{ fontFamily: fontStack(fontParts(board.look.font).family), fontWeight: fontParts(board.look.font).weight }}>{board.look.font}</span></span>
          <span className="sb-fact wide" title={board.look.mood}><b>Look</b>{board.look.mood || "—"}</span>
          <span className="sb-fact wide" title={board.look.captions}><b>Captions</b>{board.look.captions || "—"}</span>
          {board.music && <span className="sb-fact wide" title={board.music}><b>Music</b>{board.music}</span>}
        </div>
        <Ribbon shots={shots} total={total} focus={focus} onPick={setFocus} />
      </section>

      <div className={`sb-board ${redrawing ? (redrawingOnly ? "redrawing some" : "redrawing") : ""} ${focused ? "with-drawer" : ""}`} style={{ ["--sb-card" as string]: `${sizes.card + 20}px`, ["--sb-cell" as string]: `${sizes.card + 42}px`, ["--sb-drawer" as string]: `${sizes.drawer + 88}px` }}>
        <div className="sb-grid">
          {shots.map((s, i) => (
            <div key={s.id} className="sb-cell">
              {/* Every card keeps the transition's slot (empty for the first), so the rows line up. */}
              <span className={`sb-trans t-${i ? s.transition : "none"}`} title={i ? `${TRANSITION_LABEL[s.transition]} into shot ${i + 1}` : undefined} aria-hidden={!i}>{i ? TRANSITION_LABEL[s.transition] : ""}</span>
              <button className={`sb-card ${focus === s.id ? "on" : ""} ${s.dropped ? "dropped" : ""} ${s.ask?.trim() ? "noted" : ""} ${redrawingOnly?.includes(s.id) ? "redrawn" : ""}`} onClick={() => setFocus(focus === s.id ? null : s.id)}>
                <div className="sb-card-top">
                  <span className="sb-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="sb-time">{s.dropped ? "cut" : clock(outAt.get(s.id) ?? 0)}<em>{len(s).toFixed(1)}s</em></span>
                </div>
                <div className="sb-card-pic">
                  <Sketch b={b} shot={s} width={sizes.card} />
                  {redrawingOnly?.includes(s.id) && <RedrawMark size={44} />}
                </div>
                <p className="sb-line">{s.line ? `“${s.line}”` : <em>no words</em>}</p>
                <div className="sb-chips">
                  {s.beat && <span className="sb-chip beat">{BEAT_LABEL[s.beat]}</span>}
                  <span className="sb-chip">{KIND_LABEL[s.kind]}</span>
                  {s.camera !== "still" && <span className="sb-chip">{CAMERA_LABEL[s.camera]}</span>}
                  </div>
                {s.sound && <p className="sb-sound" title={s.sound}><Icon name="volume" size={11} />{s.sound}</p>}
                {Boolean(s.ask?.trim() || s.marks?.length) && (
                  <span className="sb-flag" title={s.ask?.trim() || "You drew on this shot"}>{s.marks?.length ? (s.ask?.trim() ? "drawn · note" : "drawn") : "note"}</span>
                )}
              </button>
            </div>
          ))}
        </div>
        {redrawing && !redrawingOnly && (
          <div className="sb-redraw">
            <div className="sb-redraw-card">
              <StoryboardMark size={84} animated />
              <b>Redrawing the storyboard</b>
              <span className="shimmer">Claude is working your changes into every shot</span>
            </div>
          </div>
        )}
        {focused && <ShotDrawer b={b} shot={focused} index={shots.indexOf(focused)} editable={waiting} redrawn={Boolean(redrawingOnly?.includes(focused.id))} onClose={() => setFocus(null)} onChange={(p) => update(focused.id, p)} onDraw={() => setDrawing(focused.id)} />}
        {drawing && shots.some((x) => x.id === drawing) && (
          <Pad b={b} shot={shots.find((x) => x.id === drawing)!} index={shots.findIndex((x) => x.id === drawing)} editable={waiting}
            busy={redrawing && Boolean(b.only?.includes(drawing))} said={b.saidFor?.includes(drawing) ? b.said : undefined}
            onFix={() => redraw("", [drawing])} onTry={(text) => redraw(text, [drawing])}
            onChange={(marks) => update(drawing, { marks })} onClose={() => setDrawing(null)} />
        )}
      </div>

      {pdf && pdf !== "making" && (
        // Said above the bar, not in it: the bar keeps its shape. Goes away by itself.
        <div className="sb-toast" role="status" key={pdf}>
          <span className="sb-toast-icon"><Icon name="check" size={13} /></span>
          <span className="sb-toast-text"><b>PDF saved</b><span>{pdf.split("/").pop()}</span></span>
          <button className="sb-btn" onClick={() => window.creatron.openFile(pdf)}>Open</button>
          <button className="sb-btn" onClick={() => window.creatron.reveal(pdf)}>Show in Finder</button>
          <button className="sb-toast-x" onClick={() => setPdf("")} title="Close"><Icon name="close" size={12} /></button>
        </div>
      )}
      <footer className="sb-foot">
        {waiting && b.said && !hideSaid && (
          <ClaudeSaid said={b.said} onClose={() => setHideSaid(true)} onTry={(text) => redraw(text, b.saidFor?.length ? b.saidFor : undefined)} />
        )}
        {waiting ? (
          <>
            {pickable.length > 0 && (
              <div className="sb-scope" role="group" aria-label="What the redraw changes">
                <button className={picked.length ? "on" : ""} onClick={() => setWhole(false)} title={`Only ${pickable.map(numOf).join(", ")} change${pickable.length === 1 ? "s" : ""}; every other shot stays as it is`}>
                  {pickable.length === 1 ? `Shot ${numOf(pickable[0])}` : `${pickable.length} shots`}
                </button>
                <button className={picked.length ? "" : "on"} onClick={() => setWhole(true)} title="The whole storyboard can change">All shots</button>
              </div>
            )}
            {dictation.listening ? <div className="sb-ask dict-host"><DictationBar d={dictation} /></div> : <input
              className="sb-ask" value={changes}
              placeholder={picked.length ? `Change ${pickedLabel.toLowerCase()}: “closer on the face”, “bigger title”, “a whip pan in”…` : "Ask Claude for changes: “a stronger hook”, “more B-roll in the middle”, “calmer colours”…"}
              onChange={(e) => setChanges(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.metaKey && redraw()}
            />}
            {!dictation.listening && <MicButton d={dictation} className="sb-btn sb-mic" />}
            <button className="sb-btn" onClick={() => redraw()} disabled={!changes.trim() && !edited}><Icon name="sparkle" size={13} /> {picked.length ? `Redraw ${pickedLabel.toLowerCase()}` : "Redraw"}</button>
            <button className="export-btn" onClick={approve} title={b.plan ? "Lock in this plan: it's saved with your script, ready for the shoot" : "Build the video from these shots"}>{b.plan ? "Approve storyboard" : <>Approve &amp; build</>} <kbd>⌘↵</kbd></button>
          </>
        ) : (
          <p className="sb-foot-note">{b.status === "approved" ? (b.plan ? "Approved. It's saved with your script; take the PDF to the shoot." : "Approved. Claude is building this video now; it follows these shots.") : redrawing ? (redrawingOnly ? `Claude is redrawing ${redrawingOnly.length === 1 ? "shot" : "shots"} ${redrawingOnly.map(numOf).join(", ")}. Every other shot stays exactly as it is.` : "Your changes went to Claude. The new draft opens here when it's ready.") : b.error ? `Claude stopped: ${friendlyError(b.error)}${b.plan ? " Open it again from the Storyboard Creator to go on." : ""}` : "This storyboard is no longer waiting for an answer."}</p>
        )}
        <DictationNote d={dictation} />
        {note && <p className="sb-note">{note}</p>}

      </footer>

      {playing && <Animatic b={b} onClose={() => setPlaying(false)} />}
    </div>
  );
}

/** The video's shape at a glance, like a track on the timeline: one clip per shot, as long as it lasts. */
function Ribbon({ shots, total, focus, onPick, at }: { shots: Shot[]; total: number; focus?: string | null; onPick?: (id: string) => void; at?: number }) {
  return (
    <div className="sb-ribbon">
      {shots.filter((s) => !s.dropped).map((s, i) => (
        <button key={s.id} className={`sb-rib ${focus === s.id ? "on" : ""}`} style={{ flexGrow: Math.max(0.4, len(s)) }} onClick={() => onPick?.(s.id)} title={`${i + 1}. ${KIND_LABEL[s.kind]} · ${len(s).toFixed(1)}s${s.line ? ` · “${s.line}”` : ""}`}>
          <span>{i + 1}</span>
        </button>
      ))}
      {at !== undefined && total > 0 && <i className="sb-ribbon-head" style={{ left: `${(at / total) * 100}%` }} />}
    </div>
  );
}

/** One shot, big, with everything about it you can change. */
/** Claude's errors in plain words: its usage limit says when it comes back. */
function friendlyError(error: string): string {
  const limit = /(?:session|usage|rate) limit[^·]*·\s*(resets[^"\n]*)/i.exec(error);
  if (limit) return `your Claude usage limit is reached (it ${limit[1]!.trim()}). Nothing was lost.`;
  return error.replace(/^The full edit didn.t finish:\s*/, "").replace(/^Claude:\s*/, "").slice(0, 220);
}

const EFFECT_LABEL: Record<(typeof EFFECTS)[number], string> = { none: "Flat", shadow: "Soft shadow", outline: "Outline", glow: "Glow", extrude: "3D block", gold: "Gold", chrome: "Chrome", tag: "Tag", highlight: "Highlighter" };

function ShotDrawer({ b, shot, index, editable, redrawn, onClose, onChange, onDraw }: { b: BoardState; shot: Shot; index: number; editable: boolean; redrawn?: boolean; onClose: () => void; onChange: (p: Partial<Shot>) => void; onDraw: () => void }) {
  const texts = shot.layers.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === "text" || l.kind === "caption" || l.kind === "sticker");
  const setLayer = (i: number, patch: Partial<Layer>) => onChange({ layers: shot.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setLayerText = (i: number, text: string) => setLayer(i, { text });
  const lookFont = fontParts(b.draft.look.font).family;
  return (
    <aside className="sb-drawer">
      <div className="sb-drawer-head">
        <span className="sb-num big">{String(index + 1).padStart(2, "0")}</span>
        <span className="dim small">{shot.from.toFixed(1)}–{shot.to.toFixed(1)}s {b.plan ? "into the video" : "of the recording"}</span>
        <button className="icon-btn" onClick={onClose} title="Close (esc)"><Icon name="close" size={14} /></button>
      </div>
      <div className={`sb-drawable ${redrawn ? "redrawn" : ""}`} onDoubleClick={redrawn ? undefined : onDraw} title={redrawn ? "Claude is redrawing this shot" : "Double-click to draw on it"}>
        <Sketch b={b} shot={shot} width={frameSizes(b.draft.format).drawer} className="big" />
        {redrawn && <RedrawMark size={72} label="Redrawing this shot" />}
      </div>
      <div className="sb-draw-row">
        <button className="sb-btn" onClick={onDraw} disabled={!editable && !shot.marks?.length}>
          <Icon name="pencil" size={13} /> {shot.marks?.length ? "Edit your drawing" : "Draw on this shot"}
        </button>
        {shot.marks?.length ? <span className="dim small">Claude sees it when you answer</span> : <span className="dim small">Show it: not like that, like this</span>}
      </div>
      <blockquote className="sb-quote">{shot.line ? `“${shot.line}”` : "No words in this shot."}</blockquote>
      {shot.why && <p className="sb-why"><Icon name="sparkle" size={11} /> {shot.why}</p>}
      {movesOf(shot).length > 0 && (
        <ul className="sb-moves" title="Drawn in red on the sketch">
          {movesOf(shot).map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
      <fieldset disabled={!editable} className="sb-fields">
        <label className="sb-row-toggle">
          <span>Keep this line in the video</span>
          <button className={`toggle ${shot.dropped ? "" : "on"}`} role="switch" aria-checked={!shot.dropped} onClick={() => onChange({ dropped: !shot.dropped })}><i /></button>
        </label>
        <div className="sb-field">
          <span>Shot</span>
          <div className="sb-seg">{SHOT_KINDS.map((k) => (
            <button key={k} className={shot.kind === k ? "on" : ""} onClick={() => onChange({ kind: k })}>{KIND_LABEL[k]}</button>
          ))}</div>
        </div>
        {(shot.kind === "broll" || shot.kind === "image" || shot.kind === "split") && (
          <label className="sb-field">
            <span>What we see</span>
            <input value={shot.query ?? ""} placeholder="e.g. rocket launch at night, close up" onChange={(e) => onChange({ query: e.target.value })} />
          </label>
        )}
        {texts.map(({ l, i }) => (
          <label className="sb-field" key={i}>
            <span>{l.kind === "caption" ? "Caption" : l.kind === "sticker" ? "Sticker" : "On-screen text"}</span>
            <input value={l.text ?? ""} onChange={(e) => setLayerText(i, e.target.value)} />
            {l.kind === "text" && (() => {
              // The title's typeface and finish: what the sketch draws, and what the video will use.
              const family = l.font ? fontParts(l.font).family : "";
              return (
                <span className="sb-type">
                  <select value={family} onChange={(e) => setLayer(i, { font: e.target.value || undefined })} title="Typeface"
                    style={{ fontFamily: fontStack(family || lookFont) }}>
                    <option value="">{lookFont} (the video's font)</option>
                    {family && !FONTS[family] && <option value={family}>{family}</option>}
                    {Object.entries(FONTS).map(([f, says]) => <option key={f} value={f}>{f}  ·  {says.split(":")[0]}</option>)}
                  </select>
                  <select value={l.effect ?? "none"} onChange={(e) => setLayer(i, { effect: e.target.value as Layer["effect"] })} title="Finish">
                    {EFFECTS.map((f) => <option key={f} value={f}>{EFFECT_LABEL[f]}</option>)}
                  </select>
                </span>
              );
            })()}
          </label>
        ))}
        <div className="sb-field">
          <span>Camera</span>
          <div className="sb-seg small">{CAMERAS.map((c) => <button key={c} className={shot.camera === c ? "on" : ""} onClick={() => onChange({ camera: c })}>{CAMERA_LABEL[c]}</button>)}</div>
        </div>
        {index > 0 && (
          <div className="sb-field">
            <span>Transition in</span>
            <div className="sb-seg small">{TRANSITIONS.map((t) => <button key={t} className={shot.transition === t ? "on" : ""} onClick={() => onChange({ transition: t })}>{TRANSITION_LABEL[t]}</button>)}</div>
          </div>
        )}
        <label className="sb-field">
          <span>Sound</span>
          <input value={shot.sound ?? ""} placeholder="e.g. whoosh, pop, riser" onChange={(e) => onChange({ sound: e.target.value || undefined })} />
        </label>
        <label className="sb-field">
          <span>Note to Claude</span>
          <textarea rows={3} value={shot.ask ?? ""} placeholder="Anything about this shot: “show the actual chip here”, “make this funnier”…" onChange={(e) => onChange({ ask: e.target.value })} />
        </label>
      </fieldset>
      {!editable && <p className="hint">The storyboard is {b.status === "approved" ? "approved" : "not waiting"}: changes now go through the chat.</p>}
    </aside>
  );
}

/** The drawing view for one shot, with that shot's picture. */
function Pad(props: {
  b: BoardState; shot: Shot; index: number; editable: boolean; busy?: boolean; said?: Verdict;
  onFix: () => void; onTry: (text: string) => void; onChange: (marks: NonNullable<Shot["marks"]>) => void; onClose: () => void;
}) {
  const picture = usePicture(props.b, props.shot);
  const theme = useBoardTheme((t) => t.theme);
  return <SketchPad {...props} picture={picture} theme={sketchTheme(theme)} />;
}

/**
 * Each shot the user drew on, as a picture for Claude: the sketch as they saw it (Creatro's dark
 * view) with their strokes on top, 540 px wide. Keyed by shot id, as PNG data URLs.
 */
async function drawings(b: BoardState): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const ratio = aspect(b.draft.format);
  const w = ratio < 1 ? 540 : 960;
  const h = Math.round(w / ratio);
  for (const s of b.draft.shots) {
    if (!s.marks?.length) continue;
    const src = shotSource(b, s);
    const picture = src ? await loadPicture(src.file, src.at) : null;
    const c = document.createElement("canvas");
    drawShot(c, w, h, 1, s, b.draft, picture, "dark");
    out[s.id] = c.toDataURL("image/png");
  }
  return out;
}

// ---- the animatic ----

/** The storyboard as a rough film: each sketch for as long as its line, over the real voice, with its camera move and transition. */
function Animatic({ b, onClose }: { b: BoardState; onClose: () => void }) {
  const shots = useMemo(() => b.draft.shots.filter((s) => !s.dropped), [b]);
  const audio = useRef<HTMLAudioElement>(null);
  const [i, setI] = useState(0);
  const [t, setT] = useState(0); // seconds into the animatic
  const [paused, setPaused] = useState(false);
  const pausedNow = useRef(false);
  pausedNow.current = paused;
  const silent = Boolean(b.plan); // from a script: nothing recorded, the shots run on a clock
  const total = shots.reduce((a, s) => a + len(s), 0);
  const starts = useMemo(() => {
    let a = 0;
    return shots.map((s) => ((a += len(s)), a - len(s)));
  }, [shots]);

  // No recording: each shot for its planned length, on a timer (paused when paused).
  useEffect(() => {
    if (!silent || !shots.length) return;
    let last = performance.now();
    let at = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      if (!pausedNow.current) at += (now - last) / 1000;
      last = now;
      if (at >= total) return clearInterval(timer), setT(total), onClose();
      setI(Math.max(0, starts.findLastIndex((x) => x <= at)));
      setT(at);
    }, 40);
    return () => clearInterval(timer);
  }, [shots, silent]);

  // The voice plays shot by shot: from each shot's start to its end in the recording, then the next one.
  useEffect(() => {
    const el = audio.current;
    if (silent || !el || !shots.length) return;
    let at = 0;
    let started = false;
    const go = (k: number) => {
      at = k;
      setI(k);
      el.currentTime = shots[k].from;
      void el.play().catch(() => {});
    };
    // A timer and the audio's own time events (not animation frames: those stop in a hidden window
    // while the voice plays on, and the shots would fall behind).
    const tick = () => {
      if (!started) return;
      const s = shots[at];
      if (el.currentTime >= s.to - 0.02) {
        if (at + 1 < shots.length) return go(at + 1);
        el.pause();
        setT(total);
        return onClose();
      }
      setT(starts[at] + Math.max(0, Math.min(len(s), el.currentTime - s.from)));
    };
    const start = () => {
      if (started) return;
      started = true;
      go(0);
    };
    el.addEventListener("loadedmetadata", start);
    el.addEventListener("timeupdate", tick);
    if (el.readyState >= 1) start();
    const timer = setInterval(tick, 40);
    return () => {
      clearInterval(timer);
      el.removeEventListener("loadedmetadata", start);
      el.removeEventListener("timeupdate", tick);
      el.pause();
    };
  }, [shots]);

  useEffect(() => {
    const el = audio.current;
    if (el) paused ? el.pause() : void el.play().catch(() => {});
  }, [paused]);

  const shot = shots[i];
  if (!shot) return null;
  const into = t - starts[i];
  const words = shot.line.split(/\s+/).filter(Boolean);
  const said = Math.ceil((into / Math.max(0.1, len(shot))) * words.length);
  // As big as fits under the top bar and above the controls: tall frames up to 420 px wide, wide ones up to 960.
  const ratio = aspect(b.draft.format);
  const width = Math.min(ratio >= 1 ? Math.min(960, window.innerWidth - 160) : 420, Math.round((window.innerHeight - 220) * ratio));
  return (
    <div className="sb-anim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {!silent && <audio ref={audio} src={mediaUrl(b.video)} preload="auto" />}
      <div className="sb-anim-top">
        <span className="sb-eyebrow">Animatic · shot {i + 1} of {shots.length}</span>
        <button className="icon-btn" onClick={onClose} title="Close (esc)"><Icon name="close" /></button>
      </div>
      <div className="sb-anim-stage" style={{ width, height: Math.round(width / aspect(b.draft.format)) }}>
        <div key={shot.id} className={`sb-anim-shot cam-${shot.camera} in-${i ? shot.transition : "cut"}`} style={{ ["--d" as string]: `${len(shot)}s` }}>
          <Sketch b={b} shot={shot} width={width} />
        </div>
        {shot.transition === "flash" && i > 0 && <i key={`f${shot.id}`} className="sb-flash" />}
      </div>
      <p className="sb-anim-line">{words.map((w, k) => <span key={k} className={k < said ? "said" : ""}>{w} </span>)}</p>
      <div className="sb-anim-bar">
        <button className="sb-btn" onClick={() => setPaused(!paused)}><Icon name={paused ? "play" : "pause"} size={12} fill /> {paused ? "Play" : "Pause"}</button>
        <Ribbon shots={shots} total={total} at={t} />
        <span className="sb-anim-time">{clock(t)} / {clock(total)}</span>
      </div>
    </div>
  );
}

// ---- the PDF ----

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A print-ready page: a cover with the idea and look, then the shots like a film storyboard. */
async function pdfHtml(b: BoardState): Promise<string> {
  const board = b.draft;
  const shots = board.shots.filter((s) => !s.dropped);
  const ratio = aspect(board.format);
  const w = ratio < 1 ? 300 : 420;
  const h = Math.round(w / ratio);
  const images: string[] = [];
  for (const s of shots) {
    const src = shotSource(b, s);
    const picture = src ? await loadPicture(src.file, src.at) : null;
    const c = document.createElement("canvas");
    drawShot(c, w, h, 2, s, board, picture, "paper");
    images.push(c.toDataURL("image/jpeg", 0.9));
  }
  const accent = accentOf(board);
  // Tall frames sit in columns; wide ones as a production storyboard does it: the frame on the left,
  // its words and directions on the right, two to a row, so a page holds six shots, not three.
  const wide = ratio >= 1.3;
  // The frame's share of a card: whatever its shape, frame and directions fill the card side by side.
  const frame = wide ? 50 : ratio >= 0.9 ? 42 : ratio >= 0.7 ? 38 : 33;
  const total = boardLength(board);
  let at = 0;
  const cards = shots.map((s, i) => {
    const start = at;
    at += len(s);
    return `<div class="card">
      <div class="meta"><b>${String(i + 1).padStart(2, "0")}</b><span>${clock(start)} · ${len(s).toFixed(1)}s</span></div>
      <img src="${images[i]}" />
      <div class="txt">
      <p class="line">${s.line ? `“${esc(s.line)}”` : "<em>no words</em>"}</p>
      <p class="tags">${s.beat ? `<b class="beat">${BEAT_LABEL[s.beat]}</b> · ` : ""}<span>${KIND_LABEL[s.kind]}</span>${s.camera !== "still" ? ` · ${CAMERA_LABEL[s.camera]}` : ""}${i && s.transition !== "cut" ? ` · ${TRANSITION_LABEL[s.transition]} transition` : ""}${s.sound ? ` · ♪ ${esc(s.sound)}` : ""}</p>
      ${movesOf(s).map((m) => `<p class="move">→ ${esc(m)}</p>`).join("")}
      ${s.query && (s.kind === "broll" || s.kind === "image") ? `<p class="why">Shows: ${esc(s.query)}</p>` : ""}
      ${s.why ? `<p class="why">${esc(s.why)}</p>` : ""}
      </div>
    </div>`;
  });
  // Pages built here, not left to the printer: each a full paper sheet with a running header.
  const perPage = wide ? 6 : 4;
  const starts: number[] = [];
  shots.reduce((t, x) => (starts.push(t), t + len(x)), 0);
  const sheets = Array.from({ length: Math.ceil(cards.length / perPage) }, (_, p) => {
    const a = p * perPage;
    const b2 = Math.min(cards.length, a + perPage);
    const end = starts[b2 - 1]! + len(shots[b2 - 1]!);
    return `<section class="page sheet">
      <header class="sheet-head"><span>Storyboard · ${esc(board.title)}</span><span>Shots ${a + 1}–${b2} of ${shots.length} · ${clock(starts[a]!)}–${clock(end)}</span></header>
      <div class="grid">${cards.slice(a, b2).join("")}</div>
    </section>`;
  }).join("");
  const ribbon = shots.map((s, i) => `<i style="flex-grow:${Math.max(0.4, len(s))};background:${i % 2 ? "#d9d3c7" : "#cbc4b6"}">${i + 1}</i>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif; color: ${INK}; background: ${PAPER}; -webkit-print-color-adjust: exact; }
    .page { padding: 14mm 14mm 12mm; }
    .cover { height: 210mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; }
    .eyebrow { font: 600 9pt "SF Mono", Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; color: #77736a; }
    h1 { font: 800 40pt/1.02 "${esc(board.look.font)}", -apple-system, sans-serif; letter-spacing: -.02em; margin-top: 8mm; max-width: 220mm; }
    .idea { font-size: 15pt; line-height: 1.4; margin-top: 6mm; max-width: 200mm; color: #3a3833; }
    .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6mm; border-top: 1.5px solid ${INK}; padding-top: 5mm; }
    .facts b { display: block; font: 600 8pt "SF Mono", Menlo, monospace; letter-spacing: .12em; text-transform: uppercase; color: #77736a; margin-bottom: 2mm; }
    .facts div { font-size: 10.5pt; line-height: 1.35; }
    .sw { display: flex; gap: 2mm; } .sw i { width: 9mm; height: 9mm; border-radius: 50%; border: 1px solid rgba(0,0,0,.15); }
    .ribbon { display: flex; gap: 1px; height: 7mm; margin: 6mm 0 2mm; border-radius: 2mm; overflow: hidden; }
    .ribbon i { display: flex; align-items: center; justify-content: center; font: 600 7pt "SF Mono", Menlo, monospace; color: rgba(0,0,0,.6); font-style: normal; }
    .brand { display: flex; justify-content: space-between; font: 600 8pt "SF Mono", Menlo, monospace; letter-spacing: .14em; color: #77736a; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: ${wide ? "4.5mm" : "6mm"} 9mm; align-content: start; }
    .card { page-break-inside: avoid; break-inside: avoid; }
    .card img { width: 100%; display: block; border-radius: 1.5mm; border: 1.2px solid ${INK}; }
    .sheet { height: 210mm; padding: 9mm 13mm 8mm; page-break-after: always; break-after: page; overflow: hidden; }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    .sheet-head { display: flex; justify-content: space-between; padding-bottom: 2.5mm; margin-bottom: 4mm; border-bottom: 1px solid #d6cdba; font: 600 7pt "SF Mono", Menlo, monospace; letter-spacing: .1em; text-transform: uppercase; color: #8a8478; }
    .grid .card { display: grid; grid-template-columns: ${frame}% 1fr; column-gap: 4.5mm; align-items: start; }
    .grid .meta { grid-column: 1 / -1; margin-bottom: 1mm; }
    .grid .txt .line { margin-top: 0; font-size: 9.5pt; }
    .grid .move, .grid .tags { font-size: 7pt; margin-top: .7mm; }
    .grid .why { font-size: 6.8pt; line-height: 1.28; margin-top: .9mm; }
    .meta { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1.5mm; font: 600 7.5pt "SF Mono", Menlo, monospace; color: #77736a; }
    .meta b { font-size: 11pt; color: ${accent}; }
    .line { font-size: 8.5pt; line-height: 1.32; margin-top: 2mm; font-weight: 600; }
    .tags { font-size: 7pt; color: #5d5a52; margin-top: 1.2mm; }
    .tags span { font-weight: 700; }
    .tags .beat { font: 700 6.5pt "SF Mono", Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; color: ${accent}; }
    .move { font-size: 7pt; color: ${"#c81d16"}; margin-top: .8mm; line-height: 1.3; }
    .why { font-size: 7pt; color: #77736a; margin-top: 1mm; font-style: italic; line-height: 1.3; }
  </style></head><body>
    <section class="page cover">
      <div>
        <div class="eyebrow">Storyboard${b.round > 1 ? ` · draft ${b.round}` : ""}</div>
        <h1>${esc(board.title)}</h1>
        <p class="idea">${esc(board.idea)}</p>
      </div>
      <div>
        <div class="eyebrow">${shots.length} shots · ${clock(total)} · ${board.format}</div>
        <div class="ribbon">${ribbon}</div>
        <div class="facts">
          <div><b>Palette</b><span class="sw">${board.look.palette.map((c) => `<i style="background:${c}"></i>`).join("")}</span></div>
          <div><b>Look</b>${esc(board.look.mood || "—")}<br/><span style="font-family:'${esc(board.look.font)}'">${esc(board.look.font)}</span></div>
          <div><b>Captions</b>${esc(board.look.captions || "—")}</div>
          <div><b>Music</b>${esc(board.music || "—")}</div>
        </div>
        <div class="brand" style="margin-top:8mm"><span>Creatro</span><span>Rough sketches from your own footage · nothing is built until you approve</span></div>
      </div>
    </section>
    ${sheets}
  </body></html>`;
}

/** On a shot Claude is redrawing: the storyboard mark, drawing itself over and over. */
function RedrawMark({ size, label }: { size: number; label?: string }) {
  return (
    <div className="sb-redraw-mark">
      <StoryboardMark size={size} animated />
      {label && <span className="shimmer">{label}</span>}
    </div>
  );
}
