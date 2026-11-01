// Voice Lab: clone a voice from a clip, write a script, generate a voiceover in that voice,
// and drop it on the A2 track. Everything runs on this Mac with Pocket TTS.
import { useEffect, useState } from "react";
import { toSourceTime } from "../src/timeline.ts";
import type { VoiceInfo } from "./env.d.ts";
import { useEditor } from "./store.ts";

const DEFAULT_SPEED = 1.067; // Kartik's usual pace from the my-voiceover skill

export function VoiceLab() {
  const { project, status, selectedVo } = useEditor();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voiceId, setVoiceId] = useState("kartik");
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

      {!cloning && <ScriptForm voice={voice} disabled={!project} />}
      {status && <p className="vl-status">{status}…</p>}
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

function ScriptForm({ voice, disabled }: { voice?: VoiceInfo; disabled: boolean }) {
  const { addVoiceover } = useEditor();
  const [text, setText] = useState("");
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ file: string; duration: number; url: string; text: string; voice: string }>();
  const [error, setError] = useState("");

  const generate = async () => {
    if (!voice || !text.trim()) return;
    setBusy(true);
    setError("");
    setResult(undefined);
    const r = await window.creatron.generateVoiceover({ text, voiceId: voice.id, speed });
    setBusy(false);
    if (r.ok) setResult({ ...r.value, text, voice: voice.name });
    else setError(r.error);
  };

  return (
    <section>
      <h4>Script</h4>
      <textarea
        className="vl-script"
        placeholder={"Type what the voice should say.\nEach line is spoken as its own sentence."}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <label className="slider">
        <span className="slider-head">
          <span>Speed</span>
          <span className="value">{speed.toFixed(2)}×{Math.abs(speed - DEFAULT_SPEED) < 0.005 ? " (your usual)" : ""}</span>
        </span>
        <input type="range" min={0.8} max={1.4} step={0.01} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
      </label>
      <button className="primary wide" disabled={disabled || busy || !voice || !text.trim()} onClick={generate}>
        {busy ? "Generating…" : `Generate in ${voice?.name ?? "…"}`}
      </button>
      <p className="hint">English, French, German, Spanish, Italian, Portuguese or Dutch. Hindi isn't supported yet.</p>
      {error && <p className="error small">{error}</p>}
      {result && (
        <div className="vl-result">
          <audio controls src={result.url} />
          <div className="meta"><span>{result.duration.toFixed(1)}s</span><span>{result.voice}</span></div>
          <button
            className="primary wide"
            onClick={() => {
              addVoiceover({ file: result.file, duration: result.duration, text: result.text, voice: result.voice });
              setResult(undefined);
            }}
          >
            Add to timeline at playhead
          </button>
        </div>
      )}
    </section>
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
