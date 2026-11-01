// Right panel: tell the editor what you want. Quick actions run instantly on this Mac;
// anything typed goes to the AI, which edits the current timeline. Each change can be undone.
import { useEffect, useRef, useState } from "react";
import { removePauses } from "../src/autocut.ts";
import { DEFAULT_MODEL } from "../src/plan.ts";
import type { EditPlan } from "../src/schema.ts";
import { outputDuration } from "../src/timeline.ts";
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
  const { project, plan, messages, busy, status, commit, say, set } = useEditor();
  const [text, setText] = useState("");
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
    say({ role: "user", text: request });
    set({ busy: true });
    const before = useEditor.getState().plan;
    const r = await window.creatron.aiEdit(project.path, request, before);
    set({ busy: false });
    if (!r.ok) {
      const text = /OPENROUTER_API_KEY/.test(r.error)
        ? "The AI isn't connected yet. Add your OpenRouter key to CREATRON/.env and restart the app. The quick actions above work without it."
        : /OpenRouter 402/.test(r.error)
          ? "Your OpenRouter account has no credits yet. Once your payment lands, try again. The quick actions above work meanwhile."
          : /OpenRouter 401/.test(r.error)
            ? "OpenRouter didn't accept the API key. Check the key in CREATRON/.env and restart the app."
            : r.error;
      say({ role: "error", text });
      return;
    }
    const cost = r.value.cost ? ` · $${r.value.cost.toFixed(4)}` : "";
    apply(before, r.value.plan, r.value.plan.notes || "Done.", `${r.value.model.split("/").pop()}${cost}`);
  };

  return (
    <aside className="panel ai">
      <div className="ai-head">
        <div className="ai-title"><span className="spark">✦</span> Creatron AI</div>
        <div className="dim small">{DEFAULT_MODEL.split("/").pop()}</div>
      </div>

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
        <textarea
          value={text}
          disabled={!project}
          placeholder={project ? "Describe an edit…" : "Import a video first"}
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
    </aside>
  );
}
