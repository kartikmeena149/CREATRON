// Voice Lab: clone a voice from a clip, write a script, generate a voiceover in that voice,
// and drop it on the A2 track. Everything runs on this Mac with Pocket TTS.
import { useEffect, useState } from "react";
import { create } from "zustand";
import { toSourceTime } from "../src/timeline.ts";
import type { VoiceInfo } from "./env.d.ts";
import { mediaUrl } from "./format.ts";
import { useEditor } from "./store.ts";

const DEFAULT_SPEED = 1.067; // Kartik's usual pace from the my-voiceover skill

export function VoiceLab() {
  const { project, status, selectedVo } = useEditor();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const voiceId = useEditor((s) => s.voiceDraft.voiceId);
  const setVoiceId = (id: string) => useEditor.getState().set({ voiceDraft: { ...useEditor.getState().voiceDraft, voiceId: id } });
  const [cloning, setCloning] = useState(false);
  // While a voiceover is being made its own progress bar says what's happening.
  const generating = useVoiceJob((s) => s.busy);
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
  const cloned = voices.filter((v) => v.kind === "cloned");
  const builtin = voices.filter((v) => v.kind === "builtin");

  return (
    <div className="voice-lab">
      {selectedVo && <SelectedVoiceover id={selectedVo} />}

      <section>
        <div className="vl-head">
          <h4>Voice</h4>
          <button className="small-btn" onClick={() => setCloning(!cloning)}>{cloning ? "Cancel" : "＋ Clone a voice"}</button>
        </div>
        {cloning ? (
          <CloneForm
            onDone={async (id) => {
              setCloning(false);
              await refresh(id);
            }}
          />
        ) : (
          <>
            <select className="vl-select" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              {cloned.length > 0 && (
                <optgroup label="Your voices">
                  {cloned.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </optgroup>
              )}
              <optgroup label="Built-in voices">
                {builtin.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
            </select>
            {voice?.kind === "cloned" && (
              <div className="vl-voice">
                {voice.url && <audio controls src={voice.url} />}
                <button
                  className="small-btn danger"
                  onClick={async () => {
                    if (!confirm(`Delete the voice "${voice.name}"?`)) return;
                    await window.creatron.deleteVoice(voice.id);
                    await refresh();
                  }}
                >
                  Delete voice
                </button>
              </div>
            )}
          </>
        )}
        {error && <p className="error small">{error}</p>}
      </section>

      {!cloning && <ScriptForm voice={voice} />}
      {status && !generating && <p className="vl-status">{status}…</p>}
      <VoiceTakes />
    </div>
  );
}

function CloneForm({ onDone }: { onDone: (id: string) => void }) {
  const { project, plan, time } = useEditor();
  const [from, setFrom] = useState<"video" | "file">("video");
  const [file, setFile] = useState<string>();
  const [length, setLength] = useState(20);
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
      duration: length,
      name,
      consent,
    });
    setBusy(false);
    if (r.ok) onDone(r.value.id);
    else setError(r.error);
  };

  return (
    <div className="clone-form">
      <div className="segmented">
        <button className={from === "video" ? "on" : ""} disabled={!project} onClick={() => setFrom("video")}>From this video</button>
        <button className={from === "file" ? "on" : ""} onClick={() => setFrom("file")}>From a file</button>
      </div>
      {from === "video" ? (
        <p className="hint">Uses {length}s of this video starting at the playhead. Move the playhead to where only one person talks.</p>
      ) : (
        <div className="row">
          <div className="file-pick">{file ? file.split("/").pop() : "No file chosen"}</div>
          <button className="small-btn" onClick={async () => setFile(await window.creatron.pickAudio())}>Choose…</button>
        </div>
      )}
      <label className="slider">
        <span className="slider-head"><span>Clip length</span><span className="value">{length}s</span></span>
        <input type="range" min={5} max={25} step={1} value={length} onChange={(e) => setLength(Number(e.target.value))} />
      </label>
      <input className="vl-input" placeholder="Voice name, e.g. My podcast voice" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>This is my voice, or I have this person's permission to clone it.</span>
      </label>
      <button className="primary wide" disabled={!consent || !name.trim() || !source || busy} onClick={clone}>
        {busy ? "Cloning…" : "Clone voice"}
      </button>
      <p className="hint">Best results: 15 to 25 seconds of one person speaking clearly, no music.</p>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

type Progress = { stage: "starting" | "speaking" | "finishing"; done: number; total: number };

/**
 * The voiceover being made. It lives outside the page, so leaving the Voice page (or the panel)
 * mid-way doesn't lose it: the take still lands in the library and the list when it's done.
 */
const useVoiceJob = create<{ busy: boolean; progress: Progress; error: string }>(() => ({
  busy: false,
  progress: { stage: "starting", done: 0, total: 1 },
  error: "",
}));
let listening = false;

async function generateTake(text: string, voice: VoiceInfo, speed: number) {
  if (useVoiceJob.getState().busy) return;
  // Subscribed once, on the first voiceover (the bridge to the app is surely there by then).
  if (!listening) (listening = true), window.creatron.onVoiceProgress((progress) => useVoiceJob.setState({ progress }));
  useVoiceJob.setState({ busy: true, error: "", progress: { stage: "starting", done: 0, total: 1 } });
  const r = await window.creatron.generateVoiceover({ text, voiceId: voice.id, speed });
  useVoiceJob.setState({ busy: false });
  if (!r.ok) return useVoiceJob.setState({ error: r.error });
  const s = useEditor.getState();
  s.addToLibrary(r.value.file);
  s.set({ voiceTakes: [{ file: r.value.file, duration: r.value.duration, text, voice: voice.name, at: Date.now() }, ...s.voiceTakes] });
}

/** Write a script and generate it in a voice. Works with no video open; every result goes to the library. */
function ScriptForm({ voice }: { voice?: VoiceInfo }) {
  const { voiceDraft: draft, set } = useEditor();
  const { busy, error } = useVoiceJob();
  const setDraft = (patch: Partial<typeof draft>) => set({ voiceDraft: { ...useEditor.getState().voiceDraft, ...patch } });
  return (
    <section>
      <h4>Script</h4>
      <textarea
        className="vl-script"
        placeholder={"Type what the voice should say.\nEach line is spoken as its own sentence."}
        value={draft.text}
        onChange={(e) => setDraft({ text: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <label className="slider">
        <span className="slider-head">
          <span>Speed</span>
          <span className="value">{draft.speed.toFixed(2)}×{Math.abs(draft.speed - DEFAULT_SPEED) < 0.005 ? " (your usual)" : ""}</span>
        </span>
        <input type="range" min={0.8} max={1.4} step={0.01} value={draft.speed} onChange={(e) => setDraft({ speed: Number(e.target.value) })} />
      </label>
      <button className="primary wide" disabled={busy || !voice || !draft.text.trim()} onClick={() => voice && generateTake(draft.text, voice, draft.speed)}>
        {busy ? "Generating…" : `Generate in ${voice?.name ?? "…"}`}
      </button>
      {busy && <VoiceProgressBar />}
      <p className="hint">English, French, German, Spanish, Italian, Portuguese or Dutch. Hindi isn't supported yet.</p>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

/** Every voiceover made in this project, newest first: listen, put it on the timeline, find it in the library. */
function VoiceTakes() {
  const { voiceTakes, project, plan, addVoiceover, set } = useEditor();
  if (!voiceTakes.length) return null;
  return (
    <section>
      <div className="vl-head">
        <h4>Your voiceovers</h4>
        <button className="small-btn" onClick={() => set({ leftView: "media" })}>Show in Library</button>
      </div>
      <div className="vl-takes">
        {voiceTakes.map((t) => {
          const placed = plan.voiceovers.some((v) => v.file === t.file);
          return (
            <div key={t.file} className="vl-take">
              <p className="vl-text" title={t.text}>“{t.text}”</p>
              <audio controls src={mediaUrl(t.file)} preload="none" />
              <div className="vl-take-foot">
                <span className="dim small">{t.duration.toFixed(1)}s · {t.voice}</span>
                {project && (
                  <button className="small-btn" onClick={() => addVoiceover({ file: t.file, duration: t.duration, text: t.text, voice: t.voice })}>
                    {placed ? "Add again" : "Add to timeline"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!project && <p className="hint">They're in the Library too: drag one onto the timeline, or double-click it there to make a faceless video over it.</p>}
    </section>
  );
}

/**
 * How far along a voiceover is. The engine reports each finished line; between reports the bar
 * creeps toward the next step so it never looks stuck. Starting the engine has no known length.
 */
function VoiceProgressBar() {
  const p = useVoiceJob((s) => s.progress);
  const [shown, setShown] = useState(0);
  const from = p.stage === "starting" ? 0 : p.stage === "finishing" ? 0.95 : 0.05 + (0.9 * p.done) / p.total;
  const to = p.stage === "starting" ? 0.05 : p.stage === "finishing" ? 1 : 0.05 + (0.9 * (p.done + 1)) / p.total;
  useEffect(() => {
    setShown((s) => Math.max(s, from));
    const t = setInterval(() => setShown((s) => Math.max(s, from) + (to * 0.97 - Math.max(s, from)) * 0.06), 150);
    return () => clearInterval(t);
  }, [from, to]);
  const label =
    p.stage === "starting" ? "Starting the voice engine (first time takes a few seconds)"
    : p.stage === "finishing" ? "Finishing the voiceover"
    : `Speaking line ${p.done + 1} of ${p.total}`;
  return (
    <div className={`vl-progress ${p.stage === "starting" ? "waiting" : ""}`}>
      <div className="vl-progress-bar"><i style={{ width: `${Math.round(shown * 100)}%` }} /></div>
      <div className="vl-progress-text"><span>{label}…</span>{p.stage !== "starting" && <b>{Math.round(shown * 100)}%</b>}</div>
    </div>
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
