// The Storyboard Creator: plan a video before it's filmed. The user gives the script (typed, pasted,
// dictated or from a file), anything they already have (clips, photos, music, a logo) and how they
// want it; Claude directs it as a storyboard, shot by shot. It opens in the same storyboard view as
// a full edit's: pencil sketches, movement, drawing on shots, Redraw, the animatic and the PDF.
// The job runs in the main process (src/autoedit.ts planStoryboard); its events come in here.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import type { PlanEvent, SavedPlan } from "../src/chatTypes.ts";
import { type Shot, type Storyboard, sayingTime, scenesOf, stripSceneMark } from "../src/storyboard.ts";
import { DictationBar, DictationNote, MicButton, appendSpeech, useDictation } from "./Dictation.tsx";
import { Icon } from "./icons.tsx";
import { ModelPicker, useModelChoice } from "./modelChoice.tsx";
import { useEditor } from "./store.ts";
import { Sketch } from "./Storyboard.tsx";
import { aspect, drawShot } from "./storyboardSketch.ts";

type Job = {
  key: string;
  dir: string;
  title: string;
  status: "drafting" | "ready" | "approved" | "failed" | "stopped";
  step: string;
  fraction?: number;
  remainingMs?: number;
  error?: string;
  /** The script's scenes and the format: what the drawing view lays out while Claude works. */
  scenes?: string[];
  format?: Storyboard["format"];
  started?: number;
};

/** The storyboard being made from a script (one at a time). */
export const usePlan = create<{ job: Job | null }>(() => ({ job: null }));

const FORMATS = [["9:16", "Vertical"], ["16:9", "Wide"], ["1:1", "Square"], ["4:5", "Portrait"]] as const;
const SCRIPT_FILE = /\.(txt|md|markdown|rtf|docx?|pdf|pages|fountain)$/i;

// Events from the job, wherever the user is in the app.
window.creatron.onPlanEvent?.(({ key, event }: { key: string; event: PlanEvent }) => {
  const job = usePlan.getState().job;
  if (!job || job.key !== key) return;
  const set = (patch: Partial<Job>) => usePlan.setState({ job: { ...job, ...patch } });
  if (event.type === "log") {
    if (event.kind !== "tool") set({ step: event.text.replace(/\s+/g, " ").slice(0, 140) });
  } else if (event.type === "progress") {
    set({ fraction: event.fraction, remainingMs: event.remainingMs });
  } else if (event.type === "storyboard") {
    set({ status: "ready", step: "" });
    useEditor.setState({ board: { video: event.video, dir: event.dir, round: event.round, draft: event.board, status: "waiting", plan: true }, boardOpen: true });
  } else if (event.type === "done") {
    set({ status: "approved", dir: event.dir });
  } else if (event.type === "error") {
    const stopped = /^Stopped/.test(event.error);
    set({ status: stopped ? "stopped" : "failed", error: stopped ? undefined : event.error });
    const b = useEditor.getState().board;
    if (b?.plan && b.video === key && b.status !== "approved") useEditor.setState({ board: { ...b, status: "closed" } });
  }
});

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function StoryboardCreator() {
  const job = usePlan((s) => s.job);
  return (
    <div className="home sbc">
      <section className="home-hero sbc-hero">
        <p className="dot-label sbc-eyebrow"><i className="sbc-rec" />Storyboard Creator</p>
        <h1>Plan it before you <span className="sbc-pencil">film it.<PencilUnderline /></span></h1>
        <p className="home-sub">
          Give Claude your script and anything you already have. It directs the video shot by shot: what's on screen, the camera, the motion, the sound. Draw on it, redraw it, take the PDF to the shoot.
        </p>
      </section>
      {job && job.status !== "failed" && job.status !== "stopped" ? <Progress job={job} /> : <Form failed={job?.status === "failed" ? job.error : undefined} />}
      <Saved />
    </div>
  );
}

function Form({ failed }: { failed?: string }) {
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [direction, setDirection] = useState("");
  const [format, setFormat] = useState<(typeof FORMATS)[number][0]>("9:16");
  const [assets, setAssets] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const [error, setError] = useState(failed ?? "");
  const [starting, setStarting] = useState(false);
  const [model, setModel] = useModelChoice();
  const dictation = useDictation((said) => setScript((t) => appendSpeech(t, said)));
  const claude = model.startsWith("claude-code/");
  const scenes = scenesOf(script);
  const total = scenes.reduce((a, l) => a + Math.max(1.2, sayingTime(l)), 0);

  const readScript = async (path: string) => {
    const r = await window.creatron.readScript(path);
    if (!r.ok) return setError(`Couldn't read ${path.split("/").pop()}: ${r.error}`);
    const text = r.value.split(/\r?\n/).map(stripSceneMark).filter(Boolean).join("\n");
    setScript((t) => (t.trim() ? `${t.trimEnd()}\n${text}` : text));
    if (!title.trim()) setTitle(path.split("/").pop()!.replace(/\.[^.]+$/, ""));
  };
  const add = (paths: string[]) => {
    const docs = paths.filter((p) => SCRIPT_FILE.test(p));
    for (const d of docs) void readScript(d);
    const media = paths.filter((p) => !SCRIPT_FILE.test(p));
    if (media.length) setAssets((a) => [...a, ...media.filter((m) => !a.includes(m))]);
  };

  const start = async () => {
    if (!script.trim()) return setError("Write, paste, dictate or import the script first.");
    if (scenes.length < 3) return setError("Put each scene on its own line: a storyboard needs at least 3 scenes.");
    if (!claude) return setError("The Storyboard Creator runs on your Claude plan: pick a Claude model below.");
    setError("");
    setStarting(true);
    const r = await window.creatron.planStart({ title: title.trim() || undefined, script, direction: direction.trim() || undefined, format, assets, model });
    setStarting(false);
    if (!r.ok) return setError(r.error);
    usePlan.setState({ job: { key: r.value.key, dir: r.value.dir, title: title.trim() || script.trim().split(/\s+/).slice(0, 6).join(" "), status: "drafting", step: "", scenes, format, started: Date.now() } });
  };

  return (
    <div
      className={`sbc-card ${dropping ? "dropping" : ""}`}
      onDragOver={(e) => (e.preventDefault(), e.stopPropagation(), setDropping(true))}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        add([...e.dataTransfer.files].map((f) => window.creatron.pathForFile(f)));
      }}
    >
      <input className="sbc-title" value={title} placeholder="Untitled video" onChange={(e) => setTitle(e.target.value)} aria-label="Name" />

      <div className="sbc-field">
        <div className="sbc-label">
          <span>Script <em className="sbc-rule">one line = one scene</em></span>
          <span className="mono dim">{scenes.length ? `${scenes.length} scene${scenes.length > 1 ? "s" : ""} · about ${clock(total)}` : "what will be said, in order"}</span>
        </div>
        <ScriptEditor value={script} onChange={setScript} readOnly={dictation.listening} />
        {scenes.length > 0 && scenes.length < 3 && sentences(script).length >= 3 && (
          <button className="sbc-split" onClick={() => setScript(sentences(script).join("\n"))}>
            <Icon name="split" size={13} /> Split into {sentences(script).length} scenes, one per sentence
          </button>
        )}
        <DictationNote d={dictation} />
        {dictation.listening ? <DictationBar d={dictation} /> : (
          <div className="sbc-tools">
            <button className="sbc-tool" onClick={async () => { const p = (await window.creatron.pickAttachments()).find((x) => SCRIPT_FILE.test(x)); if (p) void readScript(p); }} title="A Word, PDF, Pages or text file">
              <Icon name="paperclip" size={14} /> Import script
            </button>
            <span className="grow" />
            <MicButton d={dictation} className="mic-round" />
          </div>
        )}
      </div>

      <div className="sbc-field">
        <div className="sbc-label">
          <span>Your assets</span>
          <span className="mono dim">optional · clips, photos, music, a logo</span>
        </div>
        <div className="sbc-assets">
          {assets.map((a) => (
            <span key={a} className="sbc-asset" title={a}>
              <Icon name={/\.(mp3|wav|m4a|aac|aiff?|flac|ogg)$/i.test(a) ? "music" : /\.(png|jpe?g|webp|gif|heic|svg)$/i.test(a) ? "grid" : "video"} size={12} />
              <span>{a.split("/").pop()}</span>
              <button aria-label="Remove" title="Remove" onClick={() => setAssets((x) => x.filter((y) => y !== a))}><Icon name="close" size={10} /></button>
            </span>
          ))}
          <button className="sbc-add" onClick={async () => add(await window.creatron.pickLibrary())}><Icon name="plus" size={13} /> Add files</button>
          {!assets.length && <span className="sbc-drop">or drop them here. Claude looks at each one and uses it where it fits.</span>}
        </div>
      </div>

      <div className="sbc-row">
        <label className="sbc-field grow">
          <div className="sbc-label"><span>Direction</span><span className="mono dim">optional</span></div>
          <input value={direction} placeholder="Style, mood, audience, length: “fast science explainer for teens, warm and funny”" onChange={(e) => setDirection(e.target.value)} />
        </label>
        <div className="sbc-field">
          <div className="sbc-label"><span>Format</span></div>
          <div className="segmented sbc-format">
            {FORMATS.map(([f, name]) => (
              <button key={f} className={format === f ? "on" : ""} onClick={() => setFormat(f)} title={name}>{f}</button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="sbc-error">{error}</p>}
      <div className="sbc-foot">
        <span className="prompt-model"><ModelPicker value={model} onChange={setModel} /></span>
        {!claude && <span className="sbc-warn">Needs a Claude model</span>}
        <span className="grow" />
        <button className="export-btn sbc-go" disabled={starting || !script.trim()} onClick={() => void start()}>
          {starting ? "Starting…" : "Create storyboard"} <Icon name="arrowUp" size={13} />
        </button>
      </div>
    </div>
  );
}

/** Sentences of a block of text: what "Split into scenes" turns into one line each. */
const sentences = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.!?…])\s+(?=[A-Z0-9“"'‘(])/).map((x) => x.trim()).filter(Boolean);

/**
 * The script, one scene per line, numbered like a script editor: each line's scene number and how
 * long it takes to say, in a gutter that follows the line even when it wraps. A textarea over a copy
 * of the same text (invisible but for the gutter), grown to fit so the two never scroll apart.
 * Pasted numbering or bullets are dropped: the gutter numbers the scenes.
 */
function ScriptEditor({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly?: boolean }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(200, el.scrollHeight + 2)}px`;
  }, [value]);
  let n = 0;
  const rows = value.split("\n").map((line) => {
    const words = stripSceneMark(line);
    return words ? { n: ++n, line, secs: Math.max(1.2, sayingTime(words)) } : { n: 0, line, secs: 0 };
  });
  const paste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\n") && !/^\s*(\d{1,3}\s*[.):-]|[-•*–]|scene\s*\d)/i.test(text)) return;
    e.preventDefault();
    const clean = text.split(/\r?\n/).map(stripSceneMark).filter(Boolean).join("\n");
    const el = e.currentTarget;
    el.setRangeText(clean, el.selectionStart, el.selectionEnd, "end");
    onChange(el.value);
  };
  return (
    <div className="sbc-editor">
      <div className="sbc-back" aria-hidden>
        {rows.map((r, i) => (
          <div key={i} className={`sbc-line ${r.n ? "scene" : ""}`} data-n={r.n ? String(r.n).padStart(2, "0") : ""} data-s={r.n ? `${r.secs.toFixed(1)}s` : ""}>
            {r.line || "\u200b"}
          </div>
        ))}
      </div>
      <textarea
        ref={ta} className="sbc-script" value={value} readOnly={readOnly} spellCheck
        placeholder={"This robot doesn't have motors. It has muscles.\nIt's called Protoclone, built by a startup named Clone Robotics.\nInstead of gears and servos, it's moved by artificial muscles…\n\nOne line is one scene. Paste, type, or press the mic and say it."}
        onChange={(e) => onChange(e.target.value)} onPaste={paste}
      />
    </div>
  );
}

/** What the status line says while Claude works, scene by scene (Claude's own notes take over when it writes them). */
const BEATS = ["Reading your script", "Finding the hook", "Blocking out the shots", "Choosing the camera moves", "Planning what moves on screen", "Picking the B-roll", "Writing the sound", "Checking every scene against the script"];

/**
 * The storyboard being drawn: a panel per scene of the script, the one Claude is on sketched live in
 * pencil with the red pencil moving over it, the finished ones kept, the rest waiting as blank frames.
 * The sketches here are stand-ins for the wait; Claude's real shots replace them when it's done.
 */
function Drawing({ job, redrawing, onStop }: { job: Job; redrawing: boolean; onStop: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const scenes = job.scenes?.length ? job.scenes : ["", "", "", "", "", ""];
  const n = scenes.length;
  const opening = job.step === "Opening the storyboard";
  const at = redrawing ? Math.floor(((now / 900) % n)) : Math.min(n - 1, Math.floor((job.fraction ?? 0) * n));
  const elapsed = Math.max(0, (now - (job.started ?? now)) / 1000);
  const left = redrawing ? "" : job.remainingMs && job.remainingMs > 45_000 ? `about ${Math.ceil(job.remainingMs / 60_000)} min left` : "almost there";
  const said = job.step && !/^(Step:|Tools:|Starting|Reading your script|Opening)/.test(job.step) ? job.step : BEATS[Math.min(BEATS.length - 1, Math.floor(elapsed / 9))];
  const format = job.format ?? "9:16";
  const ratio = aspect(format);
  const w = ratio < 1 ? 92 : ratio === 1 ? 120 : 150;
  return (
    <div className="sbc-card sbc-drawing">
      <div className="sbc-drawing-head">
        <span className="sbc-drawing-state">
          <i className="sbc-rec" />
          {opening ? "Opening your storyboard" : redrawing ? "Redrawing with your changes" : `Drawing scene ${String(at + 1).padStart(2, "0")} of ${String(n).padStart(2, "0")}`}
        </span>
        <span className="mono dim">{clock(elapsed)}{left ? ` · ${left}` : ""}</span>
      </div>
      <h3 className="sbc-drawing-title">{job.title}</h3>
      <p className="sbc-drawing-say"><span className="shimmer">{opening ? "Getting it back where you left it" : redrawing ? "Claude is reworking the shots you asked about" : said}</span></p>
      <div className="sbc-panels">
        {scenes.map((line, i) => (
          <div key={i} className={`sbc-panel ${i < at ? "done" : i === at ? "now" : "todo"}`} style={{ width: w }}>
            <span className="sbc-panel-num">{String(i + 1).padStart(2, "0")}</span>
            <PanelSketch index={i} line={line} format={format} width={w} state={i < at ? "done" : i === at ? "now" : "todo"} />
            {line && <p className="sbc-panel-line">{line}</p>}
          </div>
        ))}
      </div>
      <div className="sbc-drawing-foot">
        <span className="dim">{redrawing ? "The new draft opens on its own when it's ready." : "The storyboard opens on its own when every scene is drawn. You can leave this page."}</span>
        <button className="sb-btn" onClick={onStop}>Stop</button>
      </div>
    </div>
  );
}

/** A stand-in shot for a scene, so the pencil has something to draw while Claude decides the real one. */
function standIn(index: number, line: string): Shot {
  const words = line.replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter((x) => x.length > 2);
  const kind = /\?$/.test(line.trim()) || index % 4 === 3 ? "text" : index % 4 === 1 ? "talking" : index % 4 === 2 ? "graphic" : "broll";
  const big = words.slice(0, 2).join(" ").toUpperCase();
  const layers: Shot["layers"] =
    kind === "text" ? [{ kind: "text", x: 0.1, y: 0.36, w: 0.8, h: 0.2, text: big || "TITLE" }]
    : kind === "graphic" ? [{ kind: "chart", x: 0.14, y: 0.3, w: 0.72, h: 0.32 }, { kind: "caption", x: 0.12, y: 0.74, w: 0.76, h: 0.06, text: words.slice(-2).join(" ") }]
    : [{ kind: "caption", x: 0.12, y: 0.74, w: 0.76, h: 0.06, text: words.slice(0, 2).join(" ") }];
  return { id: `wait-${index}`, line, from: 0, to: 1, kind, layers, camera: index % 3 === 0 ? "zoom-in" : "still", transition: "cut" };
}
const WAIT_BOARD = (format: Storyboard["format"]): Storyboard => ({ title: "", idea: "", format, look: { palette: [], font: "SF Pro Display", mood: "", captions: "" }, shots: [] });

/**
 * One panel of the drawing view. Waiting: a blank dashed frame. Now: the stand-in sketch revealed
 * stroke by stroke, top to bottom, behind a red pencil tip. Done: the finished sketch.
 */
function PanelSketch({ index, line, format, width, state }: { index: number; line: string; format: Storyboard["format"]; width: number; state: "done" | "now" | "todo" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const h = Math.round(width / aspect(format));
  useEffect(() => {
    const c = ref.current;
    if (!c || state === "todo") return;
    const scale = Math.min(2, window.devicePixelRatio || 2);
    const full = document.createElement("canvas");
    drawShot(full, width, h, scale, standIn(index, line), WAIT_BOARD(format), null, "dark");
    c.width = full.width;
    c.height = full.height;
    const g = c.getContext("2d")!;
    if (state === "done") return void g.drawImage(full, 0, 0);
    // Drawn in rows like a hand hatching down the panel; the red pencil at the edge of what's drawn.
    let raf = 0;
    const start = performance.now();
    const rows = 14;
    const frame = (t: number) => {
      const p = ((t - start) % 3400) / 2800; // 2.8 s of drawing, a moment's pause, again
      g.clearRect(0, 0, c.width, c.height);
      const done = Math.min(1, p) * rows;
      const rowH = c.height / rows;
      for (let r = 0; r < Math.ceil(done); r++) {
        const part = Math.min(1, done - r);
        const ltr = r % 2 === 0;
        const rw = c.width * part;
        g.drawImage(full, ltr ? 0 : c.width - rw, r * rowH, rw, rowH + 1, ltr ? 0 : c.width - rw, r * rowH, rw, rowH + 1);
      }
      if (p < 1) {
        const r = Math.floor(done);
        const part = done - r;
        const x = (r % 2 === 0 ? part : 1 - part) * c.width;
        const y = (r + 0.5) * rowH;
        g.fillStyle = "#e5231b";
        g.beginPath();
        g.arc(x, y, 3.2 * scale, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "rgba(229,35,27,0.35)";
        g.lineWidth = 1.2 * scale;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 14 * scale, y - 22 * scale); // the pencil's body, trailing up and right
        g.stroke();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state, index, line, format, width]);
  return state === "todo" ? <div className="sbc-panel-blank" style={{ width, height: h }} /> : <canvas ref={ref} style={{ width, height: h }} />;
}

function Progress({ job }: { job: Job }) {
  const board = useEditor((s) => s.board);
  const mine = board?.plan && board.video === job.key ? board : null;
  const redrawing = mine?.status === "redrawing";
  const open = () => useEditor.setState({ boardOpen: true });
  const stop = () => void window.creatron.planStop();
  const fresh = () => usePlan.setState({ job: null });

  if (job.status === "drafting" || redrawing) return <Drawing job={job} redrawing={redrawing} onStop={stop} />;
  return (
    <div className="sbc-card sbc-progress">
      <span className="sbc-done"><Icon name="check" size={18} /></span>
      <b>{job.status === "approved" ? "Storyboard approved" : "Your storyboard is ready"}</b>
      <span className="sbc-step">
        {job.status === "approved"
          ? "Saved with your script. Take the PDF to the shoot, then bring the footage back for a full edit."
          : "Look through it, draw on any shot, ask for changes, or approve it."}
      </span>
      <div className="sbc-actions">
        {mine && <button className="export-btn" onClick={open}>Open storyboard</button>}
        <button className="sb-btn" onClick={() => window.creatron.reveal(`${job.dir}/notes/storyboard.json`)}>Show in Finder</button>
        {job.status === "approved" ? <button className="sb-btn" onClick={fresh}>Plan another</button> : <button className="sb-btn" onClick={stop} title="Put it away: it stays saved in Your storyboards">Close</button>}
      </div>
    </div>
  );
}

/** When something was last changed, the way a person says it: "Today 19:35", "Yesterday", "12 Nov". */
function when(ms: number): string {
  const d = new Date(ms);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return days === 0 ? `Today ${time}` : days === 1 ? `Yesterday ${time}` : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/**
 * Every storyboard made here, newest first. Opening one brings it back as it was saved, ready to
 * draw on, redraw or approve: Claude picks up where it left off.
 */
function Saved() {
  const job = usePlan((s) => s.job);
  const [list, setList] = useState<SavedPlan[] | null>(null);
  const [error, setError] = useState("");
  const [model] = useModelChoice();
  const refresh = () => void window.creatron.plansList().then(setList);
  useEffect(refresh, [job?.status, job?.key]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  if (!list?.length) return null;
  const drafting = job?.status === "drafting";

  const open = async (p: SavedPlan) => {
    const key = `plan:${p.dir}`;
    const b = useEditor.getState().board;
    // Already the one on screen: just show it.
    if (b?.plan && b.video === key && job?.key === key && job.status === "ready") return useEditor.setState({ boardOpen: true });
    setError("");
    const before = usePlan.getState().job;
    usePlan.setState({ job: { key, dir: p.dir, title: p.title, status: "drafting", step: "Opening the storyboard", scenes: p.board.shots.map((x) => x.line), format: p.format, started: Date.now() } });
    const r = await window.creatron.planOpen(p.dir, model);
    if (!r.ok) usePlan.setState({ job: before }), setError(r.error);
  };

  return (
    <section className="home-open sbc-saved">
      <div className="home-head">
        <h2>Your storyboards</h2>
        <span className="mono dim">{list.length}</span>
      </div>
      {error && <p className="sbc-error">{error}</p>}
      <div className="sbc-list">
        {list.map((p) => {
          const here = job?.key === `plan:${p.dir}` && (job.status === "ready" || job.status === "drafting");
          // The first shot as the cover: 150 px tall when upright, 150 px wide when wide.
          const ratio = aspect(p.format);
          const tw = Math.round(ratio < 1 ? 150 * ratio : 150);
          return (
            <div key={p.dir} className={`sbc-item ${here ? "on" : ""}`}>
              <button className="sbc-thumb" style={{ width: tw + 2 }} onClick={() => void open(p)} disabled={drafting && !here} title="Open">
                {p.board.shots[0] && (
                  <Sketch b={{ video: `plan:${p.dir}`, dir: p.dir, round: 1, draft: p.board, status: "closed", plan: true }} shot={p.board.shots[0]} width={tw} />
                )}
              </button>
              <div className="sbc-item-text">
                <b title={p.title}>{p.title}</b>
                <span className="mono dim">{p.shots} scenes · {clock(p.seconds)} · {p.format}</span>
                <span className="sbc-item-meta">
                  <i className={`sbc-chip ${here ? "live" : p.approved ? "ok" : ""}`}>{here ? (job?.status === "drafting" ? "Opening" : "Open now") : p.approved ? "Approved" : "Draft"}</i>
                  <span className="dim">{when(p.updated)}</span>
                </span>
                <span className="sbc-item-actions">
                  <button className="sb-btn" onClick={() => void open(p)} disabled={drafting && !here} title={drafting && !here ? "Claude is working on another storyboard" : "Look through it, draw on it, redraw or approve it"}>
                    Open
                  </button>
                  {p.pdf && <button className="sb-btn" onClick={() => window.creatron.openFile(p.pdf!)}><Icon name="download" size={12} /> PDF</button>}
                  <button className="sb-btn icon" onClick={() => window.creatron.reveal(`${p.dir}/notes/storyboard.json`)} title="Show in Finder"><Icon name="folder" size={13} /></button>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A red pencil stroke under a word: how a storyboard artist marks what matters. */
function PencilUnderline() {
  return (
    <svg className="sbc-underline" viewBox="0 0 200 18" preserveAspectRatio="none" aria-hidden>
      <path d="M3 11 C 40 5, 80 13, 120 8 S 180 6, 197 9" />
      <path d="M14 15 C 60 10, 110 16, 186 12" />
    </svg>
  );
}

/** On Home: the way in for someone with a script but no footage yet. */
export function PlanEntry({ onOpen }: { onOpen: () => void }) {
  const job = usePlan((s) => s.job);
  return (
    <button className="sbc-entry" onClick={onOpen}>
      <span className="sbc-entry-icon"><Icon name="pencil" size={16} /></span>
      <span className="sbc-entry-text">
        <b>Storyboard Creator</b>
        <span>{job && (job.status === "drafting" || job.status === "ready") ? "Your storyboard is in progress: open it" : "Have a script but no video yet? Plan every shot first."}</span>
      </span>
      <Icon name="chevron" size={14} />
    </button>
  );
}
