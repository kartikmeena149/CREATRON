// Right panel: tell the editor what you want. Quick actions run instantly on this Mac;
// anything typed goes to the AI, which edits the current timeline. Each change can be undone.
import { useEffect, useRef, useState } from "react";
import { useHome } from "./Dashboard.tsx";
import { signInProblem } from "../src/chatTypes.ts";
import type { EditPlan } from "../src/schema.ts";
import { outputDuration } from "../src/timeline.ts";
import { markerContext } from "./markers.ts";
import { ModelPicker, useModelChoice } from "./modelChoice.tsx";
import { Icon } from "./icons.tsx";
import { isAudio, isDocument } from "./format.ts";
import { MEDIA_DRAG } from "./Inspector.tsx";
import { sceneClipBrief } from "../src/sceneClips.ts";
import { useSelectedClip } from "./SceneClips.tsx";
import { type AgentMessage, useEditor } from "./store.ts";
import { AgentTurn } from "./AgentTurn.tsx";
import { Orb } from "./Orb.tsx";
import { CreatorQuote } from "./Quotes.tsx";

type Quick = { label: string; run: (plan: EditPlan) => EditPlan; says: string };

const QUICK: Quick[] = [
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
];

export function AIPanel() {
  const { project, plan, messages, busy, status, commit, say, set, picked, selectedBroll, markers, removeMarker } = useEditor();
  const pickedBroll = selectedBroll ? plan.broll.find((b) => b.id === selectedBroll) : undefined;
  // A clip of an imported Claude edit, picked on its track.
  const sel = useSelectedClip();
  const target = describePick(picked, pickedBroll?.query ?? pickedBroll?.source, sel?.clip.name);
  const sceneClip = sel ? sceneClipBrief(sel.m, sel.scene, sel.clip) : undefined;
  const [text, setText] = useState("");
  const [model, setModel] = useModelChoice();
  // Files attached to the next message (they're in the library too), and what Enhance replaced.
  const [attached, setAttached] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [original, setOriginal] = useState<string | null>(null);

  const attach = (paths: string[]) => {
    // Media goes into the library too; a storyboard or notes is only for the AI to read.
    for (const p of paths) if (!isDocument(p)) useEditor.getState().addToLibrary(p);
    setAttached((a) => [...a, ...paths.filter((p) => !a.includes(p))]);
  };

  const enhance = async () => {
    const draft = text.trim();
    if (!draft || enhancing || busy) return;
    setEnhancing(true);
    const r = await window.creatron.enhancePrompt(draft, model, project?.path);
    setEnhancing(false);
    if (!r.ok) return say({ role: "error", text: `Couldn't improve the prompt: ${r.error}` });
    if (!r.value.trim()) return;
    setOriginal(draft);
    setText(r.value.trim());
  };
  const list = useRef<HTMLDivElement>(null);
  // Follow the conversation as it grows (Claude's live turn grows a lot), unless you scrolled up to read.
  const pinned = useRef(true);
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: busy ? "auto" : "smooth" });
  }, [messages, busy]);

  // Claude's live chat: its events stream in for this video.
  const modelRef = useRef(model);
  modelRef.current = model;
  useEffect(
    () => window.creatron.onChatEvent(({ path, event }) => {
      const s = useEditor.getState();
      if (s.project?.path === path) s.agentEvent(event, modelRef.current);
    }),
    [],
  );
  // Your own Claude or ChatGPT plan works live in the chat; OpenRouter models answer in one go.
  const live = model.startsWith("claude-code/") || model.startsWith("codex/");
  const answer = (a: string) => {
    if (!project) return;
    useEditor.getState().answerQuestion(a);
    window.creatron.chatSend(project.path, a, useEditor.getState().plan, model, undefined, true).then((r) => !r.ok && say({ role: "error", text: r.error }));
  };
  const stopClaude = () => {
    if (!project) return;
    window.creatron.chatStop(project.path);
    const s = useEditor.getState();
    const i = s.messages.findLastIndex((m) => m.role === "agent");
    if (i >= 0) set({ busy: false, messages: s.messages.map((m, j) => (j === i ? { ...(m as AgentMessage), status: "stopped", ended: Date.now() } : m)) });
  };

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

  // A request typed on the Dashboard: sent as soon as its video is open here.
  const pending = useHome((h) => h.pending);
  useEffect(() => {
    if (!pending || !project || !plan.segments.length || busy || !model) return;
    useHome.setState({ pending: null });
    void send(pending);
  }, [pending, project?.path, model]);

  const send = async (given?: string) => {
    const request = (typeof given === "string" ? given : text).trim();
    if (!request || !project || !plan.segments.length || busy) return;
    setText("");
    setOriginal(null);
    const files = attached;
    setAttached([]);
    const pins = markers.map((m) => `📍${m.n}`).join(" ");
    const clips = files.length ? `\n📎 ${files.map((f) => f.split("/").pop()).join(", ")}` : "";
    say({ role: "user", text: [target && `${target}:`, pins, request].filter(Boolean).join(" ") + clips });
    const before = useEditor.getState().plan;
    if (live) {
      // Claude works live in the chat; the timeline changes as it edits.
      const words = project.analysis.words;
      const sent = markers.map((m) => ({ ...m, context: markerContext(before, words, m.time) }));
      const focus = target || sent.length || files.length
        ? { clips: target ? picked : [], broll: pickedBroll?.id, sceneClip, markers: sent, attachments: files.map((path) => ({ path })) }
        : undefined;
      if (focus) set({ picked: [], selected: null, selectedBroll: null, selectedClip: null, markers: [], pointing: false });
      const r = await window.creatron.chatSend(project.path, request, before, model, focus);
      if (!r.ok) say({ role: "error", text: signInProblem(r.error) ?? r.error });
      return;
    }
    set({ busy: true });
    const words = project.analysis.words;
    const sent = markers.map((m) => ({ ...m, context: markerContext(before, words, m.time) }));
    const focus =
      target || sent.length || files.length
        ? { clips: target ? picked : [], broll: pickedBroll?.id, sceneClip, markers: sent, attachments: files.map((path) => ({ path })) }
        : undefined;
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
            : /^Claude/.test(r.error) && signInProblem(r.error)
              ? signInProblem(r.error)!
            : /OpenRouter (429|503)/.test(r.error)
              ? "That AI model is busy right now (free models share capacity). Try again in a minute, or pick another model."
              : r.error;
      say({ role: "error", text });
      return;
    }
    const cost = r.value.cost ? ` · $${r.value.cost.toFixed(4)}` : "";
    const used = r.value.model !== model ? ` (${model.split("/").pop()} was busy)` : "";
    apply(before, r.value.plan, r.value.plan.notes || "Done.", `${r.value.model.split("/").pop()}${cost}${used}`);
    // Clip numbers can change after an edit, so the pick is cleared; markers were used up.
    if (focus) set({ picked: [], selected: null, selectedBroll: null, selectedClip: null, markers: [], pointing: false });
  };

  return (
    <aside className="panel ai">
      <div className="ai-head">
        <button className="icon-btn new-chat" title="Clear the chat (your edits stay)" disabled={!messages.length || busy} onClick={() => set({ messages: [] })}>
          <Icon name="plus" />
        </button>
      </div>

      <div className="ai-messages" ref={list} onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}>
        {!messages.length && (
          <div className="ai-empty">
            <Orb size={56} calm />
            <p>What should we make?</p>
            <CreatorQuote />
          </div>
        )}
        {messages.map((m, i) => m.role === "agent" ? (
          <AgentTurn key={i} m={m} index={i} last={i === messages.length - 1} onAnswer={answer} onStop={stopClaude} />
        ) : (
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
        {busy && messages.at(-1)?.role !== "agent" && <div className="msg assistant"><div className="bubble thinking"><span className="mini-spin" /> {status || "Thinking"}…</div></div>}
      </div>

      <div className="ai-quick">
        {QUICK.map((q) => (
          <button key={q.label} disabled={!project || !plan.segments.length} onClick={() => runQuick(q)}>{q.label}</button>
        ))}
      </div>

      <div className="ai-input">
        <div
          className={`ai-box ${dropping ? "dropping" : ""}`}
          // Drop files from Finder or cards from the Library here to give them to the AI.
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(MEDIA_DRAG) && !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            setDropping(false);
            const fromLibrary = e.dataTransfer.getData(MEDIA_DRAG);
            const paths = fromLibrary ? [JSON.parse(fromLibrary).path as string] : [...e.dataTransfer.files].map((f) => window.creatron.pathForFile(f));
            if (!paths.length) return;
            e.preventDefault();
            e.stopPropagation();
            attach(paths);
          }}
        >
        {attached.length > 0 && (
          <div className="ai-attached">
            {attached.map((p) => (
              <span key={p} className="ai-file" title={p}>
                <Icon name={isDocument(p) ? "paperclip" : isAudio(p) ? "music" : "video"} size={12} />
                <span>{p.split("/").pop()}</span>
                <button className="link" title="Don't send this file" onClick={() => setAttached((a) => a.filter((x) => x !== p))}>✕</button>
              </span>
            ))}
          </div>
        )}
        {markers.length > 0 && (
          <div className="ai-markers">
            {markers.map((m) => (
              <span key={m.n} className="ai-marker" title="Sent with your next message, so the AI knows what you mean">
                📍{m.n} at {m.time.toFixed(1)}s
                <button className="link" onClick={() => removeMarker(m.n)}>✕</button>
              </span>
            ))}
          </div>
        )}
        {target && (
          <div className="ai-target">
            <span>✎ {target}</span>
            <button className="link" title="Edit the whole video instead" onClick={() => set({ picked: [], selected: null, selectedBroll: null, selectedClip: null })}>✕</button>
          </div>
        )}
        <textarea
          value={text}
          disabled={!project}
          placeholder={!project ? "Import a video first" : !plan.segments.length ? "The timeline is empty: drop your video back on it" : target ? `What should I do with ${target}?` : "Describe an edit, or ask for the whole finished video…"}
          onChange={(e) => (setText(e.target.value), setOriginal(null))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {original !== null && (
          <div className="ai-enhanced">
            <span><Icon name="sparkle" size={11} /> Improved prompt</span>
            <button className="link" onClick={() => (setText(original), setOriginal(null))}>Undo</button>
          </div>
        )}
        <div className="ai-box-foot">
          <button
            className="icon-btn ai-tool"
            title="Attach files for the AI: a storyboard, script or notes to follow (xlsx, csv, docx, pdf, txt), or videos, music and sound effects to use"
            onClick={async () => attach(await window.creatron.pickAttachments())}
          >
            <Icon name="paperclip" size={16} />
          </button>
          <button
            className={`icon-btn ai-tool ${enhancing ? "working" : ""}`}
            title="Improve the prompt: makes it clearer and more specific for this video"
            disabled={!text.trim() || enhancing || busy}
            onClick={enhance}
          >
            {enhancing ? <span className="mini-spin" /> : <Icon name="sparkle" size={16} />}
          </button>
          <ModelPicker value={model} onChange={setModel} />
          {busy && !live && <span className="mini-spin" />}
          {busy && live ? (
            <button className="send stop" onClick={stopClaude} title="Stop Claude">
              <i className="stop-square" />
            </button>
          ) : (
            <button className="send" disabled={!text.trim() || busy || !project} onClick={() => send()} title="Send (Enter)">
              <Icon name="arrowUp" size={16} />
            </button>
          )}
        </div>
        </div>
      </div>
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
function describePick(clips: number[], broll?: string, sceneClip?: string): string {
  const parts = [];
  if (clips.length) parts.push(`${clips.length > 1 ? "Clips" : "Clip"} ${clips.map((i) => i + 1).join(", ")}`);
  if (broll) parts.push(`B-roll: ${broll}`);
  if (sceneClip) parts.push(sceneClip);
  return parts.join(" + ");
}

