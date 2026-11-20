// One Claude turn in the chat, kept quiet: while it works, one live line (what it's doing now, a
// timer, Stop) over its latest words; when it's done, a one-line "✓ 8s · 4 steps" that opens into
// everything it did, its one-sentence summary, and Compare (hold to see the edit before) / Revert.
// A question Claude asks shows as a card with options.
import { useEffect, useState } from "react";
import { type Question, type Step, splitAsk } from "../src/chatTypes.ts";
import { Icon, type IconName } from "./icons.tsx";
import { Orb } from "./Orb.tsx";
import { type AgentMessage, useEditor } from "./store.ts";
import { Sketch } from "./Storyboard.tsx";
import { boardLength } from "../src/storyboard.ts";

const STEP_ICONS: Record<Step["icon"], IconName> = { read: "eye", edit: "sliders", code: "type", look: "eye", search: "search", think: "sparkle", check: "check", fail: "close" };

const seconds = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

type Props = { m: AgentMessage; index: number; last: boolean; onAnswer: (answer: string) => void; onStop: () => void };

export function AgentTurn({ m, index, last, onAnswer, onStop }: Props) {
  const working = m.status === "working";
  const now = useNow(working);
  const [open, setOpen] = useState(false);
  const steps = m.items.flatMap((it) => (it.kind === "steps" ? it.steps : []));
  const texts = m.items.filter((it) => it.kind === "text").map((it) => splitAsk(it.text).text.trim()).filter(Boolean);
  const running = steps.findLast((s) => s.status === "running");
  const elapsed = seconds((m.ended ?? now) - m.started);

  if (working) {
    return (
      <div className="agent">
        <div className="agent-live">
          <Orb size={14} />
          <span className="shimmer agent-doing">{running ? running.running || running.label : texts.length ? "Thinking" : "Getting started"}</span>
          <span className="agent-time">{elapsed}</span>
          <button className="agent-stop" onClick={onStop} title="Stop Claude"><i /> Stop</button>
        </div>
        {m.board ? <BoardCard /> : null}
        {m.job && !(m.board && boardWaiting()) && <JobCard job={m.job} now={now} />}
        {!m.job && !m.board && texts.at(-1) && <div className="agent-text">{texts.at(-1)}</div>}
      </div>
    );
  }

  // Done (or waiting, stopped, failed): the summary line, details on demand, and the last words.
  const final = texts.at(-1);
  return (
    <div className="agent">
      <div className="agent-row">
        <button className={`agent-sum ${open ? "open" : ""}`} onClick={() => setOpen(!open)} disabled={!steps.length && texts.length < 2}>
          <span className={`agent-dot ${m.status}`}>{m.status === "error" ? <Icon name="close" size={9} /> : m.status === "waiting" ? "?" : <Icon name="check" size={9} />}</span>
          <span>{[m.status === "stopped" ? `Stopped at ${elapsed}` : elapsed, steps.length && `${steps.length} step${steps.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</span>
          {(steps.length > 0 || texts.length > 1) && <Icon name="chevron" size={10} />}
        </button>
        {m.before && m.after && <ChangeActions m={m} index={index} />}
      </div>
      {open && <Details m={m} />}
      {m.error && <p className="agent-error">{m.error}</p>}
      {m.board ? <BoardCard /> : null}
      {m.result && <ResultCard r={m.result} />}
      {final && !open && <div className="agent-text">{final}</div>}
      {m.question && (m.answer !== undefined ? (
        <div className="agent-answered"><span>{m.question.question}</span><Icon name="chevron" size={10} /><b>{m.answer}</b></div>
      ) : (
        last && m.status === "waiting" && <QuestionCard q={m.question} onAnswer={onAnswer} />
      ))}
    </div>
  );
}

/** "12:05" or "1:02:05" */
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
};
const STAGES = ["board", "look", "cut", "plan", "broll", "build", "render", "check", "fix"];

const boardWaiting = () => {
  const st = useEditor.getState().board?.status;
  return st === "waiting" || st === "redrawing";
};

/** The full edit's storyboard in the chat: a strip of its first shots, where it stands, and the way back to it. */
function BoardCard() {
  const b = useEditor((s) => s.board);
  if (!b) return null;
  const shots = b.draft.shots.filter((s) => !s.dropped);
  const open = () => useEditor.setState({ boardOpen: true });
  const state = { waiting: "Waiting for your OK", redrawing: "Claude is redrawing it", approved: "Approved: building it now", closed: "Storyboard" }[b.status];
  return (
    <div className={`sb-mini ${b.status}`} onClick={open} role="button" title="Open the storyboard">
      <div className="sb-mini-head">
        <div className="sb-mini-text">
          <b>{b.draft.title}</b>
          <span>{state} · {shots.length} shots · {Math.round(boardLength(b.draft))}s</span>
        </div>
        <span className="sb-mini-open">{b.status === "waiting" ? "Review" : "Open"}</span>
      </div>
      <div className="sb-mini-strip">
        {shots.slice(0, 7).map((s) => <Sketch key={s.id} b={b} shot={s} width={34} />)}
        {shots.length > 7 && <span className="sb-mini-more">+{shots.length - 7}</span>}
      </div>
    </div>
  );
}

/** A full edit at work: the step it's on, the time left, and a bar with one tick per step. */
function JobCard({ job, now }: { job: NonNullable<AgentMessage["job"]>; now: number }) {
  const since = now - job.at;
  const left = job.remainingMs - since;
  const at = STAGES.indexOf(job.stage);
  return (
    <div className="job">
      <div className="job-top">
        <span className="job-stage">{job.label}</span>
        <span className="job-left">{left > 20_000 ? `about ${clock(left)} left` : "almost done"}</span>
      </div>
      <div className="job-bar"><i style={{ width: `${Math.round(Math.min(1, job.fraction) * 100)}%` }} /></div>
      <div className="job-ticks">{STAGES.map((st, i) => <i key={st} className={i < at ? "done" : i === at ? "now" : ""} />)}</div>
      <p className="job-note">Full edit · {clock(job.elapsedMs + since)} so far. Your footage stays on this Mac.</p>
    </div>
  );
}

/** A finished full edit: play it here, put it on the timeline as layers, or open its project folder. */
function ResultCard({ r }: { r: NonNullable<AgentMessage["result"]> }) {
  return (
    <div className="job-result">
      {r.url && <video src={r.url} controls playsInline preload="metadata" />}
      <div className="job-actions">
        <button className="primary" onClick={() => useEditor.setState({ sceneImport: r.project })} title="Bring the finished edit onto the timeline as layers you can move, trim and retype">
          <Icon name="layers" size={12} /> Put it on the timeline
        </button>
        <button onClick={() => window.creatron.reveal(r.final)} title="The exported video and its open project folder">Show in Finder</button>
        <span className="job-version">v{r.version}</span>
      </div>
      <p className="job-note">An open project: cuts, captions and music are values in project/timeline.json. Ask here for changes.</p>
    </div>
  );
}

/** Everything Claude said and did, in order. */
function Details({ m }: { m: AgentMessage }) {
  return (
    <div className="agent-details">
      {m.items.map((it, i) =>
        it.kind === "text" ? (
          splitAsk(it.text).text.trim() && <div key={i} className="agent-text dim">{splitAsk(it.text).text.trim()}</div>
        ) : (
          it.steps.map((s) => (
            <div key={s.id} className={`step ${s.status}`}>
              <Icon name={STEP_ICONS[s.icon]} size={11} />
              <span>{s.label}</span>
            </div>
          ))
        ),
      )}
    </div>
  );
}

/**
 * Compare: hold to see the timeline as it was before this change, let go to come back.
 * Revert: put it back as it was; then Restore brings the change back.
 */
function ChangeActions({ m, index }: { m: AgentMessage; index: number }) {
  const { commit, live } = useEditor();
  const plan = useEditor((s) => s.plan);
  // Only the change you're looking at can be compared or reverted (a later edit may have built on it).
  const current = plan === m.after || JSON.stringify(plan) === JSON.stringify(m.after);
  const reverted = m.reverted && (plan === m.before || JSON.stringify(plan) === JSON.stringify(m.before));
  const mark = (reverted: boolean) => {
    const s = useEditor.getState();
    s.set({ messages: s.messages.map((x, i) => (i === index ? { ...(x as AgentMessage), reverted } : x)) });
  };
  if (reverted) {
    return (
      <div className="agent-actions">
        <button onClick={() => (commit(m.after!), mark(false))} title="Bring Claude's change back"><Icon name="redo" size={12} /> Restore</button>
      </div>
    );
  }
  if (!current) return null;
  const hold = () => {
    live(m.before!);
    const up = () => (live(m.after!), window.removeEventListener("pointerup", up));
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="agent-actions">
      <button onPointerDown={hold} title="Hold to see the video before this change"><Icon name="contrast" size={12} /> Compare</button>
      <button onClick={() => (commit(m.before!), mark(true))} title="Put the timeline back as it was before this change"><Icon name="undo" size={12} /> Revert</button>
    </div>
  );
}

/** Claude's question: pick an option or type your own, then Confirm (or let Claude choose). */
function QuestionCard({ q, onAnswer }: { q: Question; onAnswer: (answer: string) => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const [own, setOwn] = useState("");
  const answer = own.trim() || (pick !== null ? q.options[pick].label : "");
  return (
    <div className="ask" onKeyDown={(e) => e.stopPropagation()}>
      <div className="ask-q">{q.question}</div>
      {q.detail && <div className="ask-detail">{q.detail}</div>}
      <div className="ask-options">
        {q.options.map((o, i) => (
          <button key={i} className={`ask-opt ${pick === i && !own.trim() ? "on" : ""}`} onClick={() => (setPick(i), setOwn(""))} onDoubleClick={() => onAnswer(o.label)}>
            <span className="ask-opt-text">
              <b>{o.label}</b>
              {o.detail && <span>{o.detail}</span>}
            </span>
            <span className="ask-tick"><Icon name="check" size={12} /></span>
          </button>
        ))}
      </div>
      <input className="ask-own" value={own} placeholder="Or type your own answer…" onChange={(e) => setOwn(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && answer && onAnswer(answer)} />
      <div className="ask-foot">
        <button className="link" onClick={() => onAnswer("You choose")}>You choose</button>
        <button className="ask-go" disabled={!answer} onClick={() => onAnswer(answer)}>Confirm <kbd>↵</kbd></button>
      </div>
    </div>
  );
}

/** The time now, ticking every half second while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
