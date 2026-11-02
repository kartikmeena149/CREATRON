// Right panel: tell the editor what you want. Quick actions run instantly on this Mac;
// anything typed goes to the AI, which edits the current timeline. Each change can be undone.
import { useEffect, useRef, useState } from "react";
import { removePauses } from "../src/autocut.ts";
import type { EditPlan } from "../src/schema.ts";
import { outputDuration } from "../src/timeline.ts";
import { CaptionList } from "./CaptionList.tsx";
import { VoiceLab } from "./VoiceLab.tsx";
import type { ModelInfo } from "./env.d.ts";
import { useEditor } from "./store.ts";

type Quick = { label: string; run: (plan: EditPlan) => EditPlan; says: string };

const QUICK: Quick[] = [
  {
    label: "Remove pauses",
    run: (plan) => removePauses(plan, useEditor.getState().project!.analysis),
    says: "Cut the pauses.",
  },
  {
    label: "Make it a reel",
    run: (plan) => ({ ...plan, aspect: "9:16", captions: { ...plan.captions, enabled: true } }),
    says: "Switched to 9:16 with captions on.",
  },
  {
    label: "Clean up my voice",
    run: (plan) => ({ ...plan, audio: { ...plan.audio, denoise: true, clarity: 3, normalize: true } }),
    says: "Turned on noise cleanup, +3 dB clarity and Reels loudness.",
  },
  {
    label: "Punch-in zooms",
    run: (plan) => ({ ...plan, segments: plan.segments.map((s, i) => ({ ...s, zoom: i % 2 ? 1.15 : 1 })) }),
    says: "Added a 115% punch-in on every other clip.",
  },
];

export function AIPanel() {
  const { project, plan, messages, busy, status, commit, say, set, rightTab, picked, selectedBroll } = useEditor();
  const pickedBroll = selectedBroll ? plan.broll.find((b) => b.id === selectedBroll) : undefined;
  const target = describePick(picked, pickedBroll?.query ?? pickedBroll?.source);
  const [text, setText] = useState("");
  const [model, setModel] = useModelChoice();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const apply = (before: EditPlan, after: EditPlan, text: string, meta?: string) => {
    commit(after);
    say({ role: "assistant", text, before, meta });
  };

  const runQuick = (q: Quick) => {
    say({ role: "user", text: q.label });
    const before = plan;
    const after = q.run(plan);
    const d0 = outputDuration(before);
    const d1 = outputDuration(after);
    apply(before, after, q.says, `instant · ${d0.toFixed(1)}s → ${d1.toFixed(1)}s`);
  };

  const send = async () => {
    const request = text.trim();
    if (!request || !project || busy) return;
    setText("");
    say({ role: "user", text: target ? `${target}: ${request}` : request });
    set({ busy: true });
    const before = useEditor.getState().plan;
    const focus = target ? { clips: picked, broll: pickedBroll?.id } : undefined;
    const r = await window.creatron.aiEdit(project.path, request, before, model || undefined, focus);
    set({ busy: false });
    if (!r.ok) {
      const text = /OPENROUTER_API_KEY/.test(r.error)
        ? "The AI isn't connected yet. Add your OpenRouter key to CREATRON/.env and restart the app. The quick actions above work without it."
        : /OpenRouter 402/.test(r.error)
          ? "This model needs OpenRouter credits, and your balance is $0. Pick a free model from the menu above, or add credits and try again."
          : /OpenRouter 401/.test(r.error)
            ? "OpenRouter didn't accept the API key. Check the key in CREATRON/.env and restart the app."
            : /free-models-per-day/.test(r.error)
              ? `You've used today's free AI requests (OpenRouter allows 50 a day on free models, and each edit uses a few). They come back at ${freeResetTime()}. Adding $10 of OpenRouter credits once raises the limit to 1000 a day, even on free models.`
            : /Claude .*Not logged in/i.test(r.error)
              ? "Claude isn't signed in on this Mac yet. Open Terminal, type claude, press Enter, type /login and sign in with your Claude account. Then send your request again."
            : /OpenRouter (429|503)/.test(r.error)
              ? "That AI model is busy right now (free models share capacity). Try again in a minute, or pick another model."
              : r.error;
      say({ role: "error", text });
      return;
    }
    const cost = r.value.cost ? ` · $${r.value.cost.toFixed(4)}` : "";
    const used = r.value.model !== model ? ` (${model.split("/").pop()} was busy)` : "";
    apply(before, r.value.plan, r.value.plan.notes || "Done.", `${r.value.model.split("/").pop()}${cost}${used}`);
    // Clip numbers can change after an edit, so the pick is cleared.
    if (focus) set({ picked: [], selected: null, selectedBroll: null });
  };

  return (
    <aside className="panel ai">
      <div className="ai-head">
        <div className="tabs">
          <button className={rightTab === "ai" ? "on" : ""} onClick={() => set({ rightTab: "ai" })}>
            <span className="spark">✦</span> Creatron AI
          </button>
          <button className={rightTab === "captions" ? "on" : ""} onClick={() => set({ rightTab: "captions" })}>
            Captions
          </button>
          <button className={rightTab === "voice" ? "on" : ""} onClick={() => set({ rightTab: "voice" })}>
            Voice
          </button>
        </div>
        {rightTab === "ai" && <ModelPicker value={model} onChange={setModel} />}
      </div>

      {rightTab === "voice" ? <VoiceLab /> : rightTab === "captions" ? <CaptionList /> : <>
      <div className="ai-messages" ref={list}>
        {!messages.length && (
          <div className="ai-empty">
            <p>Tell me how to edit this video.</p>
            <p className="dim">"Cut the boring parts and keep it under 45 seconds"</p>
            <p className="dim">"Make a reel, zoom in when I make a point"</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">{m.text}</div>
            {m.role === "assistant" && (
              <div className="msg-foot">
                {m.meta && <span className="dim small">{m.meta}</span>}
                {m.before && (
                  <button className="link" onClick={() => commit(m.before!)} title="Go back to the timeline before this change">
                    Undo this
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant"><div className="bubble thinking">{status || "Thinking"}…</div></div>}
      </div>

      <div className="ai-quick">
        {QUICK.map((q) => (
          <button key={q.label} disabled={!project} onClick={() => runQuick(q)}>{q.label}</button>
        ))}
      </div>

      <div className="ai-input">
        {target && (
          <div className="ai-target">
            <span>✎ {target}</span>
            <button className="link" title="Edit the whole video instead" onClick={() => set({ picked: [], selected: null, selectedBroll: null })}>✕</button>
          </div>
        )}
        <textarea
          value={text}
          disabled={!project}
          placeholder={!project ? "Import a video first" : target ? `What should I do with ${target}?` : "Describe an edit… (pick clips on the timeline to edit just those)"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="send" disabled={!text.trim() || busy || !project} onClick={send} title="Send (Enter)">↑</button>
      </div>
      </>}
    </aside>
  );
}

/** When OpenRouter's daily free limit resets (midnight UTC), in this Mac's time, e.g. "5:30 AM". */
function freeResetTime(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

/** "Clip 2", "Clips 1, 3", "B-roll: watering plants" — what the next request will change. */
function describePick(clips: number[], broll?: string): string {
  const parts = [];
  if (clips.length) parts.push(`${clips.length > 1 ? "Clips" : "Clip"} ${clips.map((i) => i + 1).join(", ")}`);
  if (broll) parts.push(`B-roll: ${broll}`);
  return parts.join(" + ");
}

type Models = { models: ModelInfo[]; credits: number | null; recommended: string };
let modelsOnce: Promise<Models | undefined> | undefined;
const loadModels = () =>
  (modelsOnce ??= window.creatron.models().then((r) => (r.ok ? r.value : ((modelsOnce = undefined), undefined))));

/** The chosen model, remembered on this Mac; until you pick one, the best fit for your credits. */
function useModelChoice(): [string, (id: string) => void] {
  const read = () => {
    try {
      return localStorage.getItem("creatron.model") ?? "";
    } catch {
      return "";
    }
  };
  const [model, setModel] = useState(read);
  useEffect(() => {
    if (!model) loadModels().then((m) => m && setModel(m.recommended));
  }, []);
  const choose = (id: string) => {
    setModel(id);
    try {
      localStorage.setItem("creatron.model", id);
    } catch {}
  };
  return [model, choose];
}

function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [data, setData] = useState<Models>();
  useEffect(() => void loadModels().then(setData), []);
  const price = (m: ModelInfo) => (m.free ? "free" : `$${+m.inPerM.toFixed(2)} / $${+m.outPerM.toFixed(2)} per M`);
  const current = data?.models.find((m) => m.id === value);
  return (
    <div className="model-picker">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={current ? `${current.name}: ${price(current)}` : value}
      >
        {!data && <option value={value}>{value.split("/").pop() || "Loading…"}</option>}
        {data && (
          <>
            <optgroup label="Free (no credits needed)">
              {data.models.filter((m) => m.free).map((m) => <option key={m.id} value={m.id}>{m.name.replace(" (free)", "")} · free</option>)}
            </optgroup>
            <optgroup label={data.credits !== null && data.credits <= 0 ? "Paid (needs OpenRouter credits)" : "Paid"}>
              {data.models.filter((m) => !m.free).map((m) => <option key={m.id} value={m.id}>{m.name} · {price(m)}</option>)}
            </optgroup>
          </>
        )}
      </select>
      {data?.credits !== null && data?.credits !== undefined && (
        <span className={`credits ${data.credits <= 0 ? "empty" : ""}`} title="OpenRouter balance">${data.credits.toFixed(2)}</span>
      )}
    </div>
  );
}
