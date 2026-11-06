// Voice Lab: clone a voice from a clip, write a script, generate a voiceover in that voice,
// and drop it on the A2 track, in any of Pocket TTS's languages (a cloned voice speaks them all).
// Everything runs on this Mac.
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { toSourceTime } from "../src/timeline.ts";
import { VOICE_LANGUAGES } from "../src/voiceLanguages.ts";
import type { VoiceInfo } from "./env.d.ts";
import { useFileWave } from "./fileWave.ts";
import { mediaUrl } from "./format.ts";
import { Icon } from "./icons.tsx";
import { MEDIA_DRAG } from "./Inspector.tsx";
import { type VoiceTake, type Wave, useEditor } from "./store.ts";

const DEFAULT_SPEED = 1.067; // Kartik's usual pace from the my-voiceover skill

export function VoiceLab() {
  const { selectedVo } = useEditor();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const voiceId = useEditor((s) => s.voiceDraft.voiceId);
  const setVoiceId = (id: string) => useEditor.getState().set({ voiceDraft: { ...useEditor.getState().voiceDraft, voiceId: id } });
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState("");

  const refresh = async (select?: string) => {
    const r = await window.creatron.voices();
    if (!r.ok) return setError(r.error);
    setVoices(r.value);
    if (select) setVoiceId(select);
    else if (!r.value.some((v) => v.id === voiceId) && r.value[0]) setVoiceId(r.value[0].id);
  };
  useEffect(() => void refresh(), []);

  const voice = voices.find((v) => v.id === voiceId);

  return (
    <div className="voice-lab">
      {selectedVo && <SelectedVoiceover id={selectedVo} />}

      <section>
        <h3>
          {cloning ? "Clone a voice" : "Voice"}
          {cloning && <button className="link" onClick={() => setCloning(false)}>Cancel</button>}
        </h3>
        {cloning ? (
          <CloneForm
            onDone={async (id) => {
              setCloning(false);
              await refresh(id);
            }}
          />
        ) : (
          <VoicePicker
            voice={voice}
            voices={voices}
            onPick={setVoiceId}
            onClone={() => setCloning(true)}
            onDelete={async (v) => {
              if (!confirm(`Delete the voice "${v.name}"?`)) return;
              await window.creatron.deleteVoice(v.id);
              await refresh();
            }}
          />
        )}
        {!cloning && (
          // Cloning is the reason to be here: right under the voice, not only at the end of the list.
          <button className="vl-clone-cta" onClick={() => setCloning(true)}>
            <span className="vl-clone-icon"><Icon name="mic" size={16} /></span>
            <span className="vl-clone-text">
              <b>{voices.some((v) => v.kind === "cloned") ? "Clone another voice" : "Clone your voice"}</b>
              <span>20 seconds of you talking, then any script in your voice, in 7 languages</span>
            </span>
            <Icon name="chevron" size={14} />
          </button>
        )}
        {error && <p className="error small">{error}</p>}
      </section>

      {!cloning && <ScriptForm voice={voice} />}
      <VoiceTakes />
    </div>
  );
}

/** How a voice's name reads: the built-in ones are stored lowercase ("azelma"). */
const voiceName = (v?: VoiceInfo) => (!v ? "…" : v.kind === "builtin" ? v.name.replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : v.name);

/** A voice's round badge: its first letter, in the accent for your own voices. */
function VoiceAvatar({ voice, size = 32 }: { voice?: VoiceInfo; size?: number }) {
  return (
    <span className={`vl-avatar ${voice?.kind === "cloned" ? "own" : ""}`} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {(voice?.name ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * Plays a few seconds of any voice: a cloned one's sample, or a built-in one speaking the chosen
 * language (the engine makes that the first time, so it shows as loading for a moment). One at a time.
 */
function usePreview() {
  const language = useEditor((s) => s.voiceDraft.language);
  const [now, setNow] = useState<{ id: string; state: "loading" | "playing"; audio?: HTMLAudioElement }>();
  const [error, setError] = useState("");
  useEffect(() => () => now?.audio?.pause(), [now?.audio]);
  const toggle = async (v: VoiceInfo) => {
    now?.audio?.pause();
    if (now?.id === v.id) return setNow(undefined);
    setError("");
    setNow({ id: v.id, state: "loading" });
    const r = await window.creatron.voicePreview(v.id, language);
    if (!r.ok) return setNow(undefined), setError(r.error);
    const audio = new Audio(r.value);
    audio.onended = () => setNow((n) => (n?.audio === audio ? undefined : n));
    setNow((n) => (n?.id === v.id ? { id: v.id, state: "playing", audio } : n));
    audio.play();
  };
  return { stateOf: (v: VoiceInfo) => (now?.id === v.id ? now.state : undefined), toggle, error };
}

function PreviewButton({ state, onClick, small }: { state?: "loading" | "playing"; onClick: () => void; small?: boolean }) {
  return (
    <button
      className={`vl-play ${small ? "small" : ""} ${state ?? ""}`}
      title={state === "playing" ? "Stop" : state === "loading" ? "Getting the voice ready…" : "Hear this voice"}
      onClick={(e) => (e.stopPropagation(), onClick())}
    >
      {state === "loading" ? <span className="mini-spin" /> : <Icon name={state === "playing" ? "pause" : "play"} size={small ? 10 : 12} fill />}
    </button>
  );
}

/**
 * The chosen voice as a card; click it for the list of voices (yours first, then the built-in
 * ones), with cloning a new one at the end. Every voice can be heard first; yours can be deleted.
 */
function VoicePicker({ voice, voices, onPick, onClone, onDelete }: {
  voice?: VoiceInfo; voices: VoiceInfo[]; onPick: (id: string) => void; onClone: () => void; onDelete: (v: VoiceInfo) => void;
}) {
  const [open, setOpen] = useState(false);
  const preview = usePreview();
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !(e.target as HTMLElement).closest(".vl-picker") && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const groups: [string, VoiceInfo[]][] = [
    ["Your voices", voices.filter((v) => v.kind === "cloned")],
    ["Built-in voices", voices.filter((v) => v.kind === "builtin")],
  ];
  return (
    <div className="vl-picker">
      <div className={`vl-card ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        <VoiceAvatar voice={voice} />
        <span className="vl-card-text">
          <b>{voice ? voiceName(voice) : "Choose a voice"}</b>
          <span>{voice?.kind === "cloned" ? "Your voice" : "Built-in voice"}</span>
        </span>
        {voice && <PreviewButton state={preview.stateOf(voice)} onClick={() => preview.toggle(voice)} />}
        <Icon name="chevronDown" size={14} />
      </div>
      {open && (
        <div className="vl-menu">
          {groups.map(([title, list]) => list.length > 0 && (
            <div key={title}>
              <div className="vl-menu-group">{title}</div>
              {list.map((v) => (
                <div key={v.id} className={`vl-menu-item ${v.id === voice?.id ? "on" : ""}`} onClick={() => (onPick(v.id), setOpen(false))}>
                  <PreviewButton small state={preview.stateOf(v)} onClick={() => preview.toggle(v)} />
                  <span>{voiceName(v)}</span>
                  {v.kind === "cloned" && (
                    <button className="vl-del" title="Delete this voice" onClick={(e) => (e.stopPropagation(), setOpen(false), onDelete(v))}>
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                  {v.id === voice?.id && <Icon name="check" size={13} />}
                </div>
              ))}
            </div>
          ))}
          <div className="vl-menu-item vl-menu-clone" onClick={() => (setOpen(false), onClone())}>
            <span className="vl-avatar add"><Icon name="plus" size={13} /></span>
            <span>Clone a voice</span>
          </div>
        </div>
      )}
      {preview.error && <p className="error small">{preview.error}</p>}
    </div>
  );
}

/** How much of the recording a clone uses: about the most Pocket TTS takes, and what clones best. */
const CLONE_SECONDS = 20;

/**
 * Clone a voice in three steps: where the voice is (this video from the playhead, or an audio
 * file), what to call it, and the go-ahead that it's yours or you have permission.
 */
function CloneForm({ onDone }: { onDone: (id: string) => void }) {
  const { project, plan, time } = useEditor();
  const [from, setFrom] = useState<"video" | "file">(project ? "video" : "file");
  const [file, setFile] = useState<string>();
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const startInVideo = project ? toSourceTime(plan, time) : 0;
  const source = from === "video" ? project?.analysis.source : file;

  const clone = async () => {
    if (!source) return;
    setBusy(true);
    setError("");
    const r = await window.creatron.cloneVoice({
      source,
      start: from === "video" ? startInVideo : 0,
      duration: CLONE_SECONDS,
      name,
      consent,
    });
    setBusy(false);
    if (r.ok) onDone(r.value.id);
    else setError(r.error);
  };

  return (
    <div className="clone-form">
      <div className="vl-step">Where's the voice?</div>
      <div className="vl-sources">
        <button className={`vl-source ${from === "video" ? "on" : ""}`} disabled={!project} onClick={() => setFrom("video")}>
          <Icon name="video" size={16} />
          <b>This video</b>
          <span>{project ? `${CLONE_SECONDS}s from ${clock(startInVideo)}` : "Open a video first"}</span>
        </button>
        <button
          className={`vl-source ${from === "file" ? "on" : ""}`}
          onClick={async () => {
            setFrom("file");
            const picked = await window.creatron.pickAudio();
            if (picked) setFile(picked);
          }}
        >
          <Icon name="music" size={16} />
          <b>Audio file</b>
          <span title={file}>{file ? file.split("/").pop() : "Choose a recording"}</span>
        </button>
      </div>
      <p className="hint">
        {from === "video"
          ? "Move the playhead to where only you are talking, with no music."
          : "One person talking clearly, no music. The first 20 seconds are used."}
      </p>

      <div className="vl-step">Name it</div>
      <input className="vl-field" placeholder="e.g. My voice" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />

      <label className={`vl-consent ${consent ? "on" : ""}`}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <i>{consent && <Icon name="check" size={11} />}</i>
        <span>It's my voice, or I have permission to clone it.</span>
      </label>

      <button className="primary wide vl-generate" disabled={!consent || !name.trim() || !source || busy} onClick={clone}>
        <span className="vl-generate-label">
          {busy ? <span className="mini-spin dark" /> : <Icon name="mic" size={15} />}
          {busy ? "Cloning your voice…" : "Clone voice"}
        </span>
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

type Progress = { stage: "starting" | "speaking" | "finishing"; done: number; total: number };

/**
 * The voiceover being made. It lives outside the page, so leaving the Voice page (or the panel)
 * mid-way doesn't lose it: the take still lands in the library and the list when it's done.
 */
const useVoiceJob = create<{ busy: boolean; progress: Progress; error: string; fresh: string | null }>(() => ({
  busy: false,
  progress: { stage: "starting", done: 0, total: 1 },
  error: "",
  /** The voiceover just made, tagged New until it's played. */
  fresh: null,
}));
let listening = false;

const sameScript = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** The voiceover already made from this script, voice, speed and language, if there is one. */
function existingTake(takes: VoiceTake[], text: string, voiceId: string, speed: number, language: string): VoiceTake | undefined {
  return takes.find((t) => t.voiceId === voiceId && t.speed !== undefined && Math.abs(t.speed - speed) < 0.005
    && (t.language ?? "english") === language && sameScript(t.text, text));
}

/** Scrolls to a voiceover's card and makes it blink, so you see it (just made, or already there). */
function showTake(file: string) {
  const card = [...document.querySelectorAll<HTMLElement>(".vl-take")].find((el) => el.dataset.file === file);
  if (!card) return;
  card.scrollIntoView({ block: "center", behavior: "smooth" });
  card.classList.remove("flash");
  void card.offsetWidth; // restart the blink
  card.classList.add("flash");
}

async function generateTake(text: string, voice: VoiceInfo, speed: number, language: string) {
  if (useVoiceJob.getState().busy) return;
  // The same voiceover again would sound the same: point at the one that's there instead.
  const made = existingTake(useEditor.getState().voiceTakes, text, voice.id, speed, language);
  if (made) return showTake(made.file);
  // Subscribed once, on the first voiceover (the bridge to the app is surely there by then).
  if (!listening) (listening = true), window.creatron.onVoiceProgress((progress) => useVoiceJob.setState({ progress }));
  useVoiceJob.setState({ busy: true, error: "", progress: { stage: "starting", done: 0, total: 1 } });
  const r = await window.creatron.generateVoiceover({ text, voiceId: voice.id, speed, language });
  useVoiceJob.setState({ busy: false });
  if (!r.ok) return useVoiceJob.setState({ error: r.error });
  const s = useEditor.getState();
  s.addToLibrary(r.value.file);
  s.set({ voiceTakes: [{ file: r.value.file, duration: r.value.duration, text, voice: voice.name, at: Date.now(), language, voiceId: voice.id, speed }, ...s.voiceTakes] });
  // Take you to it: once its card is drawn, scroll there and blink it.
  useVoiceJob.setState({ fresh: r.value.file });
  requestAnimationFrame(() => requestAnimationFrame(() => showTake(r.value.file)));
}

/**
 * Write a script and generate it in a voice, in the language it's written in. Works with no video
 * open; every result goes to the library.
 */
function ScriptForm({ voice }: { voice?: VoiceInfo }) {
  const { voiceDraft: draft, set } = useEditor();
  const { busy, error } = useVoiceJob();
  const setDraft = (patch: Partial<typeof draft>) => set({ voiceDraft: { ...useEditor.getState().voiceDraft, ...patch } });
  const language = VOICE_LANGUAGES.find((l) => l.id === draft.language) ?? VOICE_LANGUAGES[0];
  const english = language.id === "english";
  const takes = useEditor((s) => s.voiceTakes);
  const made = voice ? existingTake(takes, draft.text, voice.id, draft.speed, language.id) : undefined;
  return (
    <section>
      <h3>
        Script
        <label className="vl-lang" title="The language the script is written in">
          <select value={language.id} onChange={(e) => setDraft({ language: e.target.value })}>
            {VOICE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </h3>
      <div className="vl-script-box">
      <textarea
        className="vl-script"
        placeholder={`Type what the voice should say, in ${language.name}.\nEach line is spoken as its own sentence.`}
        value={draft.text}
        onChange={(e) => setDraft({ text: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
      />
        <ScriptLength text={draft.text} speed={draft.speed} />
      </div>
      <label className="slider">
        <span className="slider-head">
          <span>Speed</span>
          <span className="value">
            {Math.abs(draft.speed - DEFAULT_SPEED) >= 0.005 && (
              <button className="link vl-usual" onClick={(e) => (e.preventDefault(), setDraft({ speed: DEFAULT_SPEED }))}>Your usual</button>
            )}
            {draft.speed.toFixed(2)}×
          </span>
        </span>
        <input type="range" min={0.8} max={1.4} step={0.01} value={draft.speed} onChange={(e) => setDraft({ speed: Number(e.target.value) })} />
      </label>
      <GenerateButton
        label={made ? "Already made · Show it" : `Generate in ${voiceName(voice)}${english ? "" : ` · ${language.name}`}`}
        made={Boolean(made)}
        disabled={!voice || !draft.text.trim()}
        onClick={() => (made ? showTake(made.file) : voice && generateTake(draft.text, voice, draft.speed, language.id))}
      />
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

/** Under the script: how many lines it becomes and about how long it'll run (~15 letters a second). */
function ScriptLength({ text, speed }: { text: string; speed: number }) {
  const lines = text.split(/\n+/).filter((l) => l.trim()).length;
  if (!lines) return null;
  const seconds = Math.max(1, Math.round(text.replace(/\s+/g, " ").trim().length / 15 / speed));
  return <div className="vl-script-meta">{lines} {lines === 1 ? "line" : "lines"} · about {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</div>;
}

/** Every voiceover made in this project, newest first, as results: play it, then put it on the timeline. */
function VoiceTakes() {
  const voiceTakes = useEditor((s) => s.voiceTakes);
  if (!voiceTakes.length) return null;
  return (
    <section>
      <h3>Your voiceovers</h3>
      <div className="vl-takes">
        {voiceTakes.map((t) => <TakeCard key={t.file} take={t} />)}
      </div>
    </section>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * One voiceover: play it and watch its wave fill in (click the wave to jump there), then ＋ puts it
 * on the timeline at the playhead. It can also be dragged onto any track, like a library item.
 */
function TakeCard({ take }: { take: VoiceTake }) {
  const { project, plan, addVoiceover } = useEditor();
  const wave = useFileWave(take.file);
  const [audio, setAudio] = useState<HTMLAudioElement>();
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio?.pause(), [audio]);
  const player = () => {
    if (audio) return audio;
    const a = new Audio(mediaUrl(take.file));
    a.ontimeupdate = () => setAt(a.currentTime);
    a.onplay = () => setPlaying(true);
    a.onpause = () => setPlaying(false);
    a.onended = () => (setPlaying(false), setAt(0));
    setAudio(a);
    return a;
  };
  const fresh = useVoiceJob((s) => s.fresh === take.file);
  const toggle = () => {
    if (fresh) useVoiceJob.setState({ fresh: null });
    const a = player();
    if (a.paused) a.play();
    else a.pause();
  };
  const seek = (fraction: number) => {
    if (fresh) useVoiceJob.setState({ fresh: null });
    const a = player();
    a.currentTime = fraction * take.duration;
    setAt(a.currentTime);
    if (a.paused) a.play();
  };
  const placed = plan.voiceovers.some((v) => v.file === take.file);
  const language = take.language && take.language !== "english" ? VOICE_LANGUAGES.find((l) => l.id === take.language)?.name : undefined;
  return (
    <div
      className={`vl-take ${playing ? "playing" : ""}`}
      data-file={take.file}
      draggable
      title="Drag onto the timeline"
      onDragStart={(e) => {
        e.dataTransfer.setData(MEDIA_DRAG, JSON.stringify({ path: take.file, length: take.duration, audio: true }));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <button className={`vl-play ${playing ? "playing" : ""}`} title={playing ? "Pause" : "Play"} onClick={toggle}>
        <Icon name={playing ? "pause" : "play"} size={12} fill />
      </button>
      <div className="vl-take-body">
        <div className="vl-take-title">
          {fresh && <span className="vl-new">New</span>}
          {take.text.replace(/\s+/g, " ").trim()}
        </div>
        <TakeWave wave={wave} progress={take.duration ? at / take.duration : 0} onSeek={seek} />
        <div className="vl-take-meta">
          <span>{playing || at > 0 ? `${clock(at)} / ${clock(take.duration)}` : clock(take.duration)}</span>
          <span>{take.voice}{language ? ` · ${language}` : ""}</span>
        </div>
      </div>
      <button
        className="vl-take-del"
        title="Delete this voiceover"
        onClick={async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete this voiceover?\n\n“${take.text.replace(/\s+/g, " ").trim().slice(0, 80)}”`)) return;
          audio?.pause();
          const s = useEditor.getState();
          s.set({ voiceTakes: s.voiceTakes.filter((t) => t.file !== take.file), library: s.library.filter((p) => p !== take.file) });
          // Still used on the timeline: the clip there keeps playing, so its file stays.
          if (!s.plan.voiceovers.some((v) => v.file === take.file)) await window.creatron.deleteVoiceoverFile(take.file);
        }}
      >
        <Icon name="trash" size={13} />
      </button>
      {project && (
        <button
          className={`vl-take-add ${placed ? "placed" : ""}`}
          title={placed ? "On the timeline (click to add it again at the playhead)" : "Add to the timeline at the playhead"}
          onClick={() => addVoiceover({ file: take.file, duration: take.duration, text: take.text, voice: take.voice })}
        >
          <Icon name={placed ? "check" : "plus"} size={14} />
        </button>
      )}
    </div>
  );
}

/** The voiceover's wave, the played part in the accent colour. */
function TakeWave({ wave, progress, onSeek }: { wave?: Wave; progress: number; onSeek: (fraction: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const bars = Math.floor(w / 3);
    const peaks = wave?.peaks ?? [];
    const top = Math.max(0.05, ...peaks);
    for (let i = 0; i < bars; i++) {
      let peak = 0;
      const from = Math.floor((i / bars) * peaks.length);
      const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * peaks.length));
      for (let k = from; k < to; k++) peak = Math.max(peak, peaks[k] ?? 0);
      const bh = Math.max(2, (peaks.length ? peak / top : 0.15) * (h - 2));
      ctx.fillStyle = i / bars < progress ? "#9a8cff" : "#4a4a4a";
      ctx.fillRect(i * 3, (h - bh) / 2, 2, bh);
    }
  }, [wave, progress]);
  return (
    <canvas
      ref={canvas}
      className="vl-take-wave"
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      }}
    />
  );
}

/**
 * The Generate button, which is also the progress bar while a voiceover is made: it fills from
 * the left and says what's happening. The engine reports each finished line; between reports the
 * fill creeps toward the next step so it never looks stuck. Starting the engine has no known
 * length, so the fill sweeps then.
 */
function GenerateButton({ label, made, disabled, onClick }: { label: string; made: boolean; disabled: boolean; onClick: () => void }) {
  const { busy, progress: p } = useVoiceJob();
  const [shown, setShown] = useState(0);
  const from = p.stage === "starting" ? 0 : p.stage === "finishing" ? 0.95 : 0.05 + (0.9 * p.done) / p.total;
  const to = p.stage === "starting" ? 0.05 : p.stage === "finishing" ? 1 : 0.05 + (0.9 * (p.done + 1)) / p.total;
  useEffect(() => {
    if (!busy) return setShown(0);
    setShown((s) => Math.max(s, from));
    const t = setInterval(() => setShown((s) => Math.max(s, from) + (to * 0.97 - Math.max(s, from)) * 0.06), 150);
    return () => clearInterval(t);
  }, [busy, from, to]);
  const waiting = busy && p.stage === "starting";
  const text = !busy ? label
    : waiting ? "Starting the voice engine"
    : p.stage === "finishing" ? "Finishing"
    : p.total > 1 ? `Speaking line ${p.done + 1} of ${p.total}` : "Speaking";
  return (
    <button className={`primary wide vl-generate ${busy ? "busy" : ""} ${waiting ? "waiting" : ""} ${made && !busy ? "made" : ""}`} disabled={busy || disabled} onClick={onClick}
      title={made && !busy ? "This exact voiceover is already below. Change the script, voice, speed or language to make a new one." : undefined}>
      {busy && <i className="vl-fill" style={waiting ? undefined : { width: `${Math.round(shown * 100)}%` }} />}
      <span className="vl-generate-label">
        {busy ? <span className="mini-spin" /> : <Icon name={made ? "check" : "mic"} size={15} />}
        {text}
        {busy && !waiting && <b>{Math.round(shown * 100)}%</b>}
      </span>
    </button>
  );
}

function SelectedVoiceover({ id }: { id: string }) {
  const { plan, checkpoint, updateVoiceover, deleteVoiceover, selectVo } = useEditor();
  const vo = plan.voiceovers.find((v) => v.id === id);
  if (!vo) return null;
  return (
    <section className="selected-caption">
      <div className="selected-head">
        <span>Selected voiceover</span>
        <button className="link" onClick={() => selectVo(null)}>Done</button>
      </div>
      <p className="vl-text">“{vo.text}”</p>
      <div className="meta"><span>{vo.voice}</span><span>{vo.duration.toFixed(1)}s</span></div>
      <label className="slider">
        <span className="slider-head"><span>Volume</span><span className="value">{vo.volumeDb > 0 ? "+" : ""}{vo.volumeDb} dB</span></span>
        <input type="range" min={-24} max={12} step={1} value={vo.volumeDb}
          onPointerDown={checkpoint} onChange={(e) => updateVoiceover(id, { volumeDb: Number(e.target.value) }, false)} />
      </label>
      <label className="slider">
        <span className="slider-head">
          <span>Lower my audio under voiceovers</span>
          <span className="value">{plan.audio.duckDb === 0 ? "off" : `${plan.audio.duckDb} dB`}</span>
        </span>
        <input type="range" min={-40} max={0} step={1} value={plan.audio.duckDb} onPointerDown={checkpoint}
          onChange={(e) => useEditor.getState().live({ ...plan, audio: { ...plan.audio, duckDb: Number(e.target.value) } })} />
      </label>
      <div className="selected-actions">
        <button className="small-btn danger" onClick={() => deleteVoiceover(id)}>Delete voiceover</button>
      </div>
    </section>
  );
}
