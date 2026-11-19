// The storyboard sheet: the first thing a full edit shows. Every shot of the coming video as a sketch
// made from the user's own footage (halftone dots), with its line, its look and its motion. The user
// reads it like a director's board, plays it as an animatic over their voice, changes any shot, asks
// Claude to redraw, downloads it as a PDF, and approves: only then is the video built.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CAMERAS, CAMERA_LABEL, KIND_LABEL, SHOT_KINDS, type Shot, type Storyboard, TRANSITIONS, TRANSITION_LABEL, boardLength,
} from "../src/storyboard.ts";
import { mediaUrl } from "./format.ts";
import { Icon } from "./icons.tsx";
import { type BoardState, useEditor } from "./store.ts";
import { INK, PAPER, accentOf, aspect, drawShot } from "./storyboardSketch.ts";


const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
const len = (s: Shot) => Math.max(0, s.to - s.from);

// ---- pictures ----

const pictures = new Map<string, Promise<HTMLImageElement | null>>();

/** The file and moment a shot's picture comes from, or null when it has none yet. */
function shotSource(b: BoardState, s: Shot): { file: string; at: number } | null {
  const src = s.source;
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

/** One shot, drawn. Redraws when the shot or the look changes. */
export function Sketch({ b, shot, width, className }: { b: BoardState; shot: Shot; width: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const picture = usePicture(b, shot);
  const ratio = aspect(b.draft.format);
  const height = Math.round(width / ratio);
  const look = JSON.stringify(b.draft.look);
  const data = JSON.stringify(shot);
  useEffect(() => {
    if (!ref.current || picture === undefined) return;
    drawShot(ref.current, width, height, Math.min(3, window.devicePixelRatio || 2), shot, b.draft, picture);
  }, [data, look, picture, width]);
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
  const [playing, setPlaying] = useState(false);
  const [changes, setChanges] = useState("");
  const [pdf, setPdf] = useState<"" | "making" | string>("");
  const [note, setNote] = useState("");
  const close = () => useEditor.setState({ boardOpen: false });

  useEffect(() => {
    setFocus(null);
    setChanges("");
    setNote("");
    setPdf("");
  }, [b?.round, b?.dir]);

  // Keys: ← → between shots, space plays, esc closes, ⌘⏎ approves. Kept from the editor underneath.
  useEffect(() => {
    if (!open || !b) return;
    const onKey = (e: KeyboardEvent) => {
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

  if (!open || !b) return null;
  const board = b.draft;
  const shots = board.shots;
  const kept = shots.filter((s) => !s.dropped);
  const total = boardLength(board);
  const accent = accentOf(board);
  const waiting = b.status === "waiting";
  const redrawing = b.status === "redrawing";
  const edited = shots.some((s) => s.dropped || s.ask?.trim());
  const focused = shots.find((s) => s.id === focus);

  const update = (id: string, patch: Partial<Shot>) => {
    const s = useEditor.getState().board;
    if (!s) return;
    useEditor.setState({ board: { ...s, draft: { ...s.draft, shots: s.draft.shots.map((x) => (x.id === id ? { ...x, ...patch } : x)) } } });
  };

  async function approve() {
    const s = useEditor.getState().board;
    if (!s || s.status !== "waiting") return;
    const ok = await window.creatron.storyboardAnswer(s.video, { approve: true, board: s.draft });
    if (!ok) return setNote("This storyboard isn't waiting any more (the edit was stopped). Ask for a full edit again to start over.");
    useEditor.setState({ board: { ...s, status: "approved" }, boardOpen: false });
  }

  async function redraw() {
    const s = useEditor.getState().board;
    if (!s || s.status !== "waiting") return;
    if (!changes.trim() && !s.draft.shots.some((x) => x.ask?.trim() || x.dropped)) return setNote("Say what to change, or add a note to a shot first.");
    const ok = await window.creatron.storyboardAnswer(s.video, { approve: false, board: s.draft, changes });
    if (!ok) return setNote("This storyboard isn't waiting any more (the edit was stopped).");
    setNote("");
    useEditor.setState({ board: { ...s, status: "redrawing" } });
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

  let at = 0;
  const outAt = new Map(kept.map((s) => [s.id, ((at += len(s)), at - len(s))]));

  return (
    <div className="sb" onKeyDown={(e) => e.stopPropagation()} style={{ ["--sb-accent" as string]: accent }}>
      <header className="sb-head">
        <button className="icon-btn" onClick={close} title="Close (esc). The storyboard stays in the chat."><Icon name="close" /></button>
        <div className="sb-head-title">
          <span className={`sb-state ${b.status}`}><i />Storyboard{b.round > 1 ? ` · draft ${b.round}` : ""} · {b.status === "approved" ? "approved" : waiting ? "waiting for your OK" : redrawing ? "redrawing" : "closed"}</span>
          <h2>{board.title}</h2>
        </div>
        <div className="sb-head-r">
          <button className="sb-btn" onClick={() => setPlaying(true)} disabled={!kept.length}><Icon name="play" size={11} fill /> Play animatic</button>
          <button className="sb-btn" onClick={makePdf} disabled={pdf === "making"}><Icon name="download" size={13} /> {pdf === "making" ? "Making PDF…" : "PDF"}</button>
          {waiting && <button className="export-btn" onClick={approve} title="Build the video from these shots">Approve &amp; build <kbd>⌘↵</kbd></button>}
        </div>
      </header>

      <section className="sb-brief">
        <p className="sb-idea">{board.idea}</p>
        <div className="sb-facts">
          <span className="sb-fact"><b>Shots</b>{kept.length} · {clock(total)} · {board.format}</span>
          <span className="sb-fact"><b>Palette</b><span className="sb-swatches">{board.look.palette.map((c) => <i key={c} style={{ background: c }} title={c} />)}</span></span>
          <span className="sb-fact"><b>Font</b><span style={{ fontFamily: `"${board.look.font}", system-ui` }}>{board.look.font}</span></span>
          <span className="sb-fact wide" title={board.look.mood}><b>Look</b>{board.look.mood || "—"}</span>
          <span className="sb-fact wide" title={board.look.captions}><b>Captions</b>{board.look.captions || "—"}</span>
          {board.music && <span className="sb-fact wide" title={board.music}><b>Music</b>{board.music}</span>}
        </div>
        <Ribbon shots={shots} total={total} focus={focus} onPick={setFocus} />
      </section>

      <div className={`sb-board ${redrawing ? "redrawing" : ""} ${focused ? "with-drawer" : ""}`}>
        <div className="sb-grid">
          {shots.map((s, i) => (
            <div key={s.id} className="sb-cell">
              {i > 0 && <span className={`sb-trans t-${s.transition}`} title={`${TRANSITION_LABEL[s.transition]} into shot ${i + 1}`}>{TRANSITION_LABEL[s.transition]}</span>}
              <button className={`sb-card ${focus === s.id ? "on" : ""} ${s.dropped ? "dropped" : ""} ${s.ask?.trim() ? "noted" : ""}`} onClick={() => setFocus(focus === s.id ? null : s.id)}>
                <div className="sb-card-top">
                  <span className="sb-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="sb-time">{s.dropped ? "cut" : clock(outAt.get(s.id) ?? 0)}<em>{len(s).toFixed(1)}s</em></span>
                </div>
                <Sketch b={b} shot={s} width={176} />
                <p className="sb-line">{s.line ? `“${s.line}”` : <em>no words</em>}</p>
                <div className="sb-chips">
                  <span className="sb-chip">{KIND_LABEL[s.kind]}</span>
                  {s.camera !== "still" && <span className="sb-chip">{CAMERA_LABEL[s.camera]}</span>}
                  </div>
                {s.sound && <p className="sb-sound" title={s.sound}><Icon name="volume" size={11} />{s.sound}</p>}
                {s.ask?.trim() && <span className="sb-flag" title={s.ask}>note</span>}
              </button>
            </div>
          ))}
        </div>
        {redrawing && <div className="sb-redraw"><span className="shimmer">Claude is redrawing the storyboard…</span></div>}
        {focused && <ShotDrawer b={b} shot={focused} index={shots.indexOf(focused)} editable={waiting} onClose={() => setFocus(null)} onChange={(p) => update(focused.id, p)} />}
      </div>

      <footer className="sb-foot">
        {waiting ? (
          <>
            <input
              className="sb-ask" value={changes} placeholder="Ask Claude for changes: “a stronger hook”, “more B-roll in the middle”, “calmer colours”…"
              onChange={(e) => setChanges(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.metaKey && redraw()}
            />
            <button className="sb-btn" onClick={redraw} disabled={!changes.trim() && !edited}><Icon name="sparkle" size={13} /> Redraw</button>
            <button className="export-btn" onClick={approve}>Approve &amp; build <kbd>⌘↵</kbd></button>
          </>
        ) : (
          <p className="sb-foot-note">{b.status === "approved" ? "Approved. Claude is building this video now; it follows these shots." : redrawing ? "Your changes went to Claude. The new draft opens here when it's ready." : "This storyboard is no longer waiting for an answer."}</p>
        )}
        {note && <p className="sb-note">{note}</p>}
        {pdf && pdf !== "making" && <button className="sb-link" onClick={() => window.creatron.reveal(pdf)}>PDF saved in the project's Export folder · Show</button>}
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
function ShotDrawer({ b, shot, index, editable, onClose, onChange }: { b: BoardState; shot: Shot; index: number; editable: boolean; onClose: () => void; onChange: (p: Partial<Shot>) => void }) {
  const texts = shot.layers.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === "text" || l.kind === "caption" || l.kind === "sticker");
  const setLayerText = (i: number, text: string) => onChange({ layers: shot.layers.map((l, j) => (j === i ? { ...l, text } : l)) });
  return (
    <aside className="sb-drawer">
      <div className="sb-drawer-head">
        <span className="sb-num big">{String(index + 1).padStart(2, "0")}</span>
        <span className="dim small">{shot.from.toFixed(1)}–{shot.to.toFixed(1)}s of the recording</span>
        <button className="icon-btn" onClick={onClose} title="Close (esc)"><Icon name="close" size={14} /></button>
      </div>
      <Sketch b={b} shot={shot} width={232} className="big" />
      <blockquote className="sb-quote">{shot.line ? `“${shot.line}”` : "No words in this shot."}</blockquote>
      {shot.why && <p className="sb-why"><Icon name="sparkle" size={11} /> {shot.why}</p>}
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

// ---- the animatic ----

/** The storyboard as a rough film: each sketch for as long as its line, over the real voice, with its camera move and transition. */
function Animatic({ b, onClose }: { b: BoardState; onClose: () => void }) {
  const shots = useMemo(() => b.draft.shots.filter((s) => !s.dropped), [b]);
  const audio = useRef<HTMLAudioElement>(null);
  const [i, setI] = useState(0);
  const [t, setT] = useState(0); // seconds into the animatic
  const [paused, setPaused] = useState(false);
  const total = shots.reduce((a, s) => a + len(s), 0);
  const starts = useMemo(() => {
    let a = 0;
    return shots.map((s) => ((a += len(s)), a - len(s)));
  }, [shots]);

  // The voice plays shot by shot: from each shot's start to its end in the recording, then the next one.
  useEffect(() => {
    const el = audio.current;
    if (!el || !shots.length) return;
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
  const width = Math.min(420, Math.round(((window.innerHeight - 220) * aspect(b.draft.format))));
  return (
    <div className="sb-anim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <audio ref={audio} src={mediaUrl(b.video)} preload="auto" />
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
  const cols = ratio < 0.7 ? 6 : ratio <= 1 ? 4 : 3;
  const total = boardLength(board);
  let at = 0;
  const cards = shots.map((s, i) => {
    const start = at;
    at += len(s);
    return `<div class="card">
      <div class="meta"><b>${String(i + 1).padStart(2, "0")}</b><span>${clock(start)} · ${len(s).toFixed(1)}s</span></div>
      <img src="${images[i]}" />
      <p class="line">${s.line ? `“${esc(s.line)}”` : "<em>no words</em>"}</p>
      <p class="tags"><span>${KIND_LABEL[s.kind]}</span>${s.camera !== "still" ? ` · ${CAMERA_LABEL[s.camera]}` : ""}${i && s.transition !== "cut" ? ` · ${TRANSITION_LABEL[s.transition]} transition` : ""}${s.sound ? ` · ♪ ${esc(s.sound)}` : ""}</p>
      ${s.query && (s.kind === "broll" || s.kind === "image") ? `<p class="why">Shows: ${esc(s.query)}</p>` : ""}
      ${s.why ? `<p class="why">${esc(s.why)}</p>` : ""}
    </div>`;
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
    .grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 6mm 5mm; }
    .card { page-break-inside: avoid; break-inside: avoid; }
    .card img { width: 100%; display: block; border-radius: 1.5mm; border: 1.2px solid ${INK}; }
    .meta { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1.5mm; font: 600 7.5pt "SF Mono", Menlo, monospace; color: #77736a; }
    .meta b { font-size: 11pt; color: ${accent}; }
    .line { font-size: 8.5pt; line-height: 1.32; margin-top: 2mm; font-weight: 600; }
    .tags { font-size: 7pt; color: #5d5a52; margin-top: 1.2mm; }
    .tags span { font-weight: 700; }
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
    <section class="page"><div class="grid">${cards}</div></section>
  </body></html>`;
}
