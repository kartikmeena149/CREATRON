// Auto Edit: pick a raw video, say what you want, and Claude Code makes the whole finished video.
// While it works: what it's doing, step by step, with elapsed time and an estimate of the time
// left. Then the result plays here, and fixes go back to the same Claude session (with 📍 markers).
import { useEffect, useRef, useState } from "react";
import type { AutoEditEvent } from "../src/autoedit.ts";
import type { AutoEditResult, AutoJob } from "./env.d.ts";

type Marker = { n: number; time: number; x: number; y: number };
type Progress = Extract<AutoEditEvent, { type: "progress" }> & { at: number };
type LogLine = { text: string; kind: "tool" | "note" | "info"; at: number };
type Phase = "form" | "running" | "done";

const MODELS = [
  { id: "sonnet", label: "Sonnet (faster)" },
  { id: "opus", label: "Opus (best, uses more of your plan)" },
];
const STAGE_LABELS: Record<string, string> = {
  look: "Watching the footage", cut: "Cutting", plan: "Planning the edit", broll: "Finding B-roll and sound",
  build: "Building the video", render: "Rendering", check: "Checking its work", fix: "Fixing",
};
const STAGE_ORDER = ["look", "cut", "plan", "broll", "build", "render", "check", "fix"];

/** "12:05" or "1:02:05" */
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

export function AutoEdit({ initialVideo, onClose }: { initialVideo?: string; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("form");
  const [video, setVideo] = useState(initialVideo ?? "");
  const [brief, setBrief] = useState("");
  const [reference, setReference] = useState("");
  const [model, setModel] = useState("sonnet");
  const [progress, setProgress] = useState<Progress>();
  const [log, setLog] = useState<LogLine[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AutoEditResult>();
  const [fixing, setFixing] = useState(false);
  const [, tick] = useState(0);

  // The job runs in the main process: show whatever it is doing (also after a reload), and follow it.
  useEffect(() => {
    const show = (job?: AutoJob) => {
      if (!job) return;
      setVideo(job.video);
      setModel(job.model);
      setFixing(job.fixing);
      setResult(job.result);
      setError(job.error ?? "");
      if (job.running) {
        setLog(job.log.flatMap((e) => (e.type === "log" ? [{ text: e.text, kind: e.kind, at: Date.now() }] : [])));
        setProgress(job.progress?.type === "progress" ? { ...job.progress, at: Date.now() } : undefined);
      }
      setPhase(job.running ? "running" : job.result ? "done" : "form");
    };
    window.creatron.autoEditState().then(show);
    const offState = window.creatron.onAutoEditState(show);
    const offEvent = window.creatron.onAutoEdit((e) => {
      if (e.type === "progress") setProgress({ ...e, at: Date.now() });
      else setLog((l) => [...l.slice(-300), { text: e.text, kind: e.kind, at: Date.now() }]);
    });
    return () => (offState(), offEvent());
  }, []);
  // The clock counts every second between the engine's updates.
  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const begin = () => {
    setPhase("running");
    setError("");
    setLog([]);
    setProgress(undefined);
  };
  const start = async () => {
    begin();
    const r = await window.creatron.autoEditStart({ video, brief, reference: reference || undefined, model });
    if (!r.ok) (setError(r.error), setPhase("form"));
  };
  const fix = async (message: string, markers: Marker[]) => {
    if (!result) return;
    begin();
    const r = await window.creatron.autoEditFix({ video, session: result.session, model, message, markers });
    if (!r.ok) (setError(r.error), setPhase("done"));
  };

  return (
    <div className="autoedit">
      <header className="autoedit-head">
        <div className="autoedit-title">✨ Auto Edit</div>
        <div className="dim small">Claude Code edits the whole video for you, on your Claude plan</div>
        <div className="grow" />
        <button className="ghost" onClick={onClose}>{phase === "running" ? "Hide (keeps working)" : "Close"}</button>
      </header>
      {phase === "form" && (
        <Form
          {...{ video, setVideo, brief, setBrief, reference, setReference, model, setModel, error }}
          onStart={start}
        />
      )}
      {phase === "running" && <Running progress={progress} log={log} fixing={fixing} onStop={() => window.creatron.autoEditCancel()} />}
      {phase === "done" && result && (
        <Done
          result={result}
          error={error}
          onFix={fix}
          onNew={() => {
            setResult(undefined);
            setError("");
            setPhase("form");
          }}
        />
      )}
    </div>
  );
}

function Form(p: {
  video: string; setVideo: (v: string) => void; brief: string; setBrief: (v: string) => void;
  reference: string; setReference: (v: string) => void; model: string; setModel: (v: string) => void;
  error: string; onStart: () => void;
}) {
  const name = (f: string) => f.split("/").pop();
  return (
    <div className="autoedit-form">
      <label>Raw video (or audio)</label>
      <div className="row">
        <div className="file">{p.video ? name(p.video) : <span className="dim">none chosen</span>}</div>
        <button onClick={async () => (await window.creatron.pickMedia("any").then((f) => f && p.setVideo(f)))}>Choose…</button>
      </div>
      <label>What do you want? <span className="dim">(optional)</span></label>
      <textarea
        rows={4}
        value={p.brief}
        placeholder="e.g. Science explainer like my reference, 60 s reel, playful music, lots of B-roll"
        onChange={(e) => p.setBrief(e.target.value)}
      />
      <label>Reference video to copy the style of <span className="dim">(optional)</span></label>
      <div className="row">
        <div className="file">{p.reference ? name(p.reference) : <span className="dim">none</span>}</div>
        {p.reference && <button className="ghost" onClick={() => p.setReference("")}>Remove</button>}
        <button onClick={async () => (await window.creatron.pickMedia("video").then((f) => f && p.setReference(f)))}>Choose…</button>
      </div>
      <label>Model</label>
      <select value={p.model} onChange={(e) => p.setModel(e.target.value)}>
        {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <p className="dim small">Takes about 10–30 minutes. Your footage stays on this Mac; Claude sees the transcript and frames it chooses to look at.</p>
      {p.error && <p className="error">{p.error}</p>}
      <button className="primary big" disabled={!p.video} onClick={p.onStart}>Start Auto Edit</button>
    </div>
  );
}

function Running({ progress, log, fixing, onStop }: { progress?: Progress; log: LogLine[]; fixing: boolean; onStop: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => void end.current?.scrollIntoView({ block: "end" }), [log.length]);
  const since = progress ? Date.now() - progress.at : 0;
  const elapsed = progress ? progress.elapsedMs + since : 0;
  const left = progress ? progress.remainingMs - since : undefined;
  const stages = fixing ? ["fix", "render", "check"] : STAGE_ORDER;
  const at = progress ? stages.indexOf(progress.stage) : -1;
  return (
    <div className="autoedit-running">
      <div className="timer">
        <div className="timer-left">
          {left === undefined ? "Starting…" : left > 20_000 ? <>about <b>{clock(left)}</b> left</> : <>almost done…</>}
        </div>
        <div className="dim">
          {progress ? STAGE_LABELS[progress.stage] ?? progress.stage : "Getting ready"} · {clock(elapsed)} elapsed
          {progress && left !== undefined && ` · done around ${new Date(Date.now() + Math.max(left, 0)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
        </div>
        <div className="bar"><i style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }} /></div>
        <div className="stages">
          {stages.map((s, i) => (
            <span key={s} className={i < at ? "done" : i === at ? "now" : ""}>{STAGE_LABELS[s]}</span>
          ))}
        </div>
      </div>
      <div className="autoedit-log">
        {log.map((l, i) => (
          <div key={i} className={`line ${l.kind}`}>
            <span className="t">{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span>{l.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="row end">
        <span className="dim small">The estimate gets better as it goes.</span>
        <div className="grow" />
        <button onClick={onStop}>Stop</button>
      </div>
    </div>
  );
}

function Done({ result, error, onFix, onNew }: { result: AutoEditResult; error: string; onFix: (m: string, markers: Marker[]) => void; onNew: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("");
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [pointing, setPointing] = useState(false);
  const drop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pointing || !video.current) return;
    const v = video.current;
    // The picture is letterboxed inside the element: map the click onto the picture itself.
    const box = v.getBoundingClientRect();
    const scale = Math.min(box.width / v.videoWidth, box.height / v.videoHeight);
    const w = v.videoWidth * scale;
    const h = v.videoHeight * scale;
    const x = (e.clientX - box.left - (box.width - w) / 2) / w;
    const y = (e.clientY - box.top - (box.height - h) / 2) / h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    v.pause();
    setMarkers((m) => [...m, { n: m.length + 1, time: v.currentTime, x, y }]);
    setPointing(false);
  };
  return (
    <div className="autoedit-done">
      <div className={`player ${pointing ? "pointing" : ""}`} onClick={drop}>
        <video ref={video} src={result.url} controls={!pointing} autoPlay />
        {markers.map((m) => <PinOver key={m.n} m={m} video={video.current} />)}
      </div>
      <div className="side">
        <div className="notes">{plainText(result.notes) || "Done."}</div>
        <div className="row">
          <button className="primary" onClick={() => window.creatron.reveal(result.final)}>Show in Finder</button>
          <span className="dim small">Version {result.version}</span>
        </div>
        <label>Want something changed?</label>
        <textarea rows={4} value={message} placeholder="e.g. Make the captions bigger, and the B-roll at the marker shows the wrong plant" onChange={(e) => setMessage(e.target.value)} />
        <div className="row">
          <button className={pointing ? "on" : ""} onClick={() => setPointing(!pointing)} title="Click on the video to mark a spot at this moment">
            📍 {pointing ? "Click on the video…" : "Point"}
          </button>
          {markers.map((m) => (
            <span key={m.n} className="chip" onClick={() => setMarkers(markers.filter((x) => x !== m))} title="Remove">#{m.n} {clock(m.time * 1000)} ✕</span>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={!message.trim()} onClick={() => onFix(message.trim(), markers)}>Send fix</button>
        <div className="grow" />
        <button className="ghost" onClick={onNew}>New Auto Edit</button>
      </div>
    </div>
  );
}

/** Claude's summary without markdown marks (**bold**, `code`, # headings). */
const plainText = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^#+\s*/gm, "").replace(/^\s*[-*] /gm, "• ").trim();

/** A marker pin drawn at its spot on the letterboxed picture. */
function PinOver({ m, video }: { m: Marker; video: HTMLVideoElement | null }) {
  if (!video || !video.videoWidth) return null;
  const box = video.getBoundingClientRect();
  const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
  const w = video.videoWidth * scale;
  const h = video.videoHeight * scale;
  return <div className="marker-pin" style={{ left: (box.width - w) / 2 + m.x * w, top: (box.height - h) / 2 + m.y * h }}>{m.n}</div>;
}
