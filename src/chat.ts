// The live AI chat: one Claude Code session per video that stays open between messages (no start-up
// wait after the first), streaming everything it does so the chat can show it as it happens: its
// words, its thinking, each file it reads or edits, and the timeline changing under it. When a choice
// is the user's, Claude ends its turn with a question card; the answer goes into the same session.
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { GUIDE, check, markerFrames, prepare } from "./agent.ts";
import { agentDir } from "./customcode.ts";
import { type Focus, describeFocus } from "./plan.ts";
import { type Analysis, EditPlan } from "./schema.ts";
import { signInProblem } from "./chatTypes.ts";
import { cleanEnv } from "./agents.ts";
import { type Orientation, resolveStockBroll } from "./stock.ts";
import { resolveSounds } from "./sfx.ts";
import { outputSize } from "./frame.ts";
import { type ChatEvent, type Question, type Step, splitAsk, splitFullEdit } from "./chatTypes.ts";
import { fullEditInfo } from "./fulledit.ts";

export type { ChatEvent } from "./chatTypes.ts";

/** How Claude should behave in the chat (on top of the editing guide). */
const CHAT_RULES = `
## You're in the editor's chat
The user watches you work live, in a small side panel: keep your words few. Before you start, write what
you're about to do in under 10 words ("Adding punchy captions and cutting the pauses."). Then work, silently.
End with ONE plain sentence, under 25 words, saying what changed. No lists, no code, no file names, no JSON,
no offers of more help.

Be quick: the transcript and the exact word times (words.md) are in the messages, so don't re-read them. Read
plan.json once, then edit it.
Make all the changes in as few edits as you can. Don't over-think small requests.

## Asking the user
When a real choice is the user's (a style or look, which of a few directions, anything they'd want to decide),
don't guess: ask, and stop. End your reply with exactly one block like this and nothing after it:
\`\`\`ask
{"question": "Which caption style?", "detail": "optional one line", "options": [{"label": "Bold yellow", "detail": "Big Anton, the said word in yellow"}, {"label": "Clean white", "detail": "Small and minimal"}]}
\`\`\`
2 to 4 options, short labels, a one-line detail each. The user can also type their own answer. Their answer
comes as the next message. Ask at most once per request, and only when it matters; small things, just do.
`;

/**
 * The full edit (Claude only: it runs on Claude Code). The chat's Claude decides which kind of request it
 * has: changes to the timeline it makes itself; a whole finished video it hands to the full edit.
 */
const FULL_EDIT_RULES = `
## A whole finished video: hand it to the full edit
Some requests are bigger than timeline edits: make the WHOLE finished video from the raw footage, the way a
professional editor would (B-roll, music and sound design, motion graphics and annotations, a polished
export), or edit it "like" / "in the style of" an attached reference video. Those take a separate 10-30
minute job (Creatro's full edit) that builds an editable project and reviews its own work. You don't do them
in plan.json. Instead, say in under 10 words that you're starting the full edit, then end your reply with
exactly one block and nothing after it:
\`\`\`fulledit
{"brief": "what to make, in the user's words plus anything you know about their goal", "reference": "/absolute/path/of/an/attached/reference/video (only if one was attached)"}
\`\`\`
When a full edit of this video already exists (the message says so) and the user wants that finished video
changed, use {"change": "the change, precisely"} instead of "brief".
Everything else (cuts, captions, a look, a few B-roll shots, sounds, text, speed, the shape) you do yourself
in plan.json as usual. When it's unclear whether they want a full edit (it takes a while), ask first.
`;

/** Claude (Claude Code) keeps one process open per video; ChatGPT (Codex) runs one process per message. */
type Session = {
  source: string;
  kind: "claude" | "codex";
  child?: ChildProcess;
  model: string;
  id?: string;
  emit: (e: ChatEvent) => void;
  turn?: Turn;
  send: (text: string) => void;
  /** Codex starts fresh each message: the last few exchanges go with the next one. */
  history: string[];
};

/** One request in flight: what the session is collecting until Claude's turn ends. */
type Turn = {
  analysis: Analysis;
  current: EditPlan;
  focus?: Focus;
  text: string;
  changed: boolean;
  fixes: number;
  blocks: Map<number, { kind: string; started: number; tool?: { id: string; name: string; json: string } }>;
  steps: Map<string, Step>;
  resolve: () => void;
};

const sessions = new Map<string, Session>();
/** Session ids by video, so a stopped or restarted session picks up the conversation. */
const resumeIds = new Map<string, string>();

/** Sends a message to the video's session (starting it when needed). Events stream to emit. */
export async function chat(
  analysis: Analysis,
  message: string,
  current: EditPlan,
  model: string,
  emit: (e: ChatEvent) => void,
  opts: { focus?: Focus; answer?: boolean } = {},
): Promise<void> {
  const dir = agentDir(analysis.source);
  const kind = model.startsWith("codex/") ? "codex" : "claude";
  const agentModel = model.replace(/^(claude-code|codex)\//, "");
  let s = sessions.get(analysis.source);
  if (s && (s.model !== agentModel || s.kind !== kind || (kind === "claude" && s.child?.exitCode !== null))) (stop(analysis.source), (s = undefined));
  // Claude resumes its own conversation; Codex gets the video every time (it starts fresh).
  const first = kind === "codex" || (!s && !resumeIds.has(analysis.source));
  // The timeline as it is now (the user may have changed it by hand since the last message).
  prepare(dir, analysis, current);
  if (kind === "codex") writeFileSync(join(dir, "AGENTS.md"), GUIDE + CHAT_RULES);
  if (!s) s = kind === "codex" ? startCodex(analysis.source, dir, agentModel, emit) : start(analysis.source, dir, agentModel, emit);
  s.emit = emit;

  const pictures = opts.focus?.markers?.length ? await markerFrames(dir, analysis, current, opts.focus.markers) : [];
  const content = [
    kind === "codex" && s.history.length ? `Earlier in this chat:\n${s.history.join("\n")}\n` : "",
    kind === "codex" ? "Follow AGENTS.md (the editing guide and the chat rules). Work only in this folder." : "",
    opts.answer ? `My answer: ${message}` : `REQUEST: ${message}`,
    opts.focus ? describeFocus(current, opts.focus) : "",
    // Whether there's a finished full edit to change (Claude hands changes to it with "change").
    kind === "claude" && fullEditInfo(analysis.source) ? `(A full edit of this video exists: version ${fullEditInfo(analysis.source)!.version}. Its summary: ${fullEditInfo(analysis.source)!.notes.slice(0, 300)})` : "",
    pictures.length ? `\nWhat I'm pointing at (Read each image; the red box is the spot I clicked):\n${pictures.join("\n")}` : "",
    first ? `\n--- video.md ---\n${readFileSync(join(dir, "video.md"), "utf8")}` : "\nplan.json holds the timeline as it is now (I may have changed it): read it again before editing.",
    // Exact word times on the edited video as it is now: sounds, text and B-roll land on the word.
    `\n--- words.md (use these exact times for anything that lands on a word) ---\n${readFileSync(join(dir, "words.md"), "utf8")}`,
    // Said every time: the chat panel is narrow, and long replies bury the edit.
    "\n(Keep it short: under 10 words before you start, ONE sentence under 25 words when you're done.)",
  ].filter(Boolean).join("\n");

  emit({ type: "start" });
  await new Promise<void>((resolve) => {
    s!.turn = { analysis, current, focus: opts.focus, text: "", changed: false, fixes: 0, blocks: new Map(), steps: new Map(), resolve };
    s!.send(content);
  });
}

/** Stops the video's session (the next message resumes the conversation). */
export function stop(source: string) {
  const s = sessions.get(source);
  if (!s) return;
  sessions.delete(source);
  s.child?.kill();
  if (s.turn) (s.emit({ type: "done", changed: s.turn.changed }), s.turn.resolve(), (s.turn = undefined));
}

function start(source: string, dir: string, model: string, emit: (e: ChatEvent) => void): Session {
  // A clean environment: no API key (that would bill the API instead of the plan) and none of a
  // parent Claude session's settings.
  const env = { HOME: homedir(), USER: process.env.USER ?? "", PATH: process.env.PATH ?? "", LANG: process.env.LANG ?? "en_US.UTF-8", TMPDIR: tmpdir() };
  const resume = resumeIds.get(source);
  const args = [
    "-p", "--model", model, "--effort", model === "opus" ? "medium" : "low",
    "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--restricted", "--tools", "Read,Write,Edit,Glob,Grep", "--permission-mode", "acceptEdits",
    "--strict-mcp-config", "--setting-sources", "project", "--disable-slash-commands",
    "--append-system-prompt", GUIDE + CHAT_RULES + FULL_EDIT_RULES,
    ...(resume ? ["--resume", resume] : []),
  ];
  const child = spawn("claude", args, { env, cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  const s: Session = { source, kind: "claude", child, model, emit, history: [], send: (text) => child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n") };
  sessions.set(source, s);
  let buf = "";
  let err = "";
  child.stdout!.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          onEvent(s, dir, JSON.parse(line));
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
        }
      }
    }
  });
  child.stderr!.on("data", (d) => (err += d));
  child.on("close", () => {
    if (sessions.get(source) === s) sessions.delete(source);
    if (!s.turn) return;
    const msg = signInProblem(err + buf) ?? `Claude stopped: ${(err || buf).trim().slice(0, 300) || "no reply"}`;
    s.emit({ type: "error", error: msg });
    s.turn.resolve();
    s.turn = undefined;
  });
  child.on("error", (e) => s.turn && (s.emit({ type: "error", error: `Couldn't start Claude: ${e.message}` }), s.turn.resolve(), (s.turn = undefined)));
  return s;
}

/**
 * ChatGPT through OpenAI's Codex app: each message (and each fix after Creatro's check) is one
 * `codex exec` run in the video's folder, signed in with the user's ChatGPT plan. It reads AGENTS.md
 * and edits plan.json like Claude does; its JSON events become the same chat steps.
 */
function startCodex(source: string, dir: string, model: string, emit: (e: ChatEvent) => void): Session {
  const s: Session = { source, kind: "codex", model, emit, history: [], send: (text) => runCodex(s, dir, text) };
  sessions.set(source, s);
  return s;
}

function runCodex(s: Session, dir: string, prompt: string) {
  const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-C", dir, ...(s.model !== "default" ? ["--model", s.model] : []), "-"];
  const child = spawn("codex", args, { env: cleanEnv(), cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  s.child = child;
  const request = prompt.match(/^(REQUEST|My answer): (.*)$/m)?.[0];
  let buf = "";
  let err = "";
  let ended = false;
  child.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let e: any;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type === "turn.completed" || e.type === "turn.failed" || e.type === "error") ended = true;
      onCodexEvent(s, dir, e);
    }
  });
  child.stderr.on("data", (d) => (err += d));
  child.on("close", () => {
    if (s.turn && request) s.history = [...s.history, `You were asked: ${request}`, `You answered: ${s.turn.text.trim().slice(0, 400)}`].slice(-6);
    if (ended || !s.turn) return;
    s.emit({ type: "error", error: signInProblem(err + buf, "ChatGPT") ?? `ChatGPT stopped: ${(err || buf).trim().slice(0, 300) || "no reply"}` });
    s.turn.resolve();
    s.turn = undefined;
  });
  child.on("error", (e) => s.turn && (s.emit({ type: "error", error: `Couldn't start Codex: ${e.message}` }), s.turn.resolve(), (s.turn = undefined)));
  child.stdin.end(prompt);
}

/** One line of `codex exec --json`: thread / turn / item events. */
function onCodexEvent(s: Session, dir: string, e: any) {
  const t = s.turn;
  if (e.type === "thread.started") s.id = e.thread_id;
  if (!t) return;
  const item = e.item ?? {};
  const id = `codex-${item.id ?? Date.now()}`;
  if (e.type === "item.started" || e.type === "item.completed") {
    const done = e.type === "item.completed";
    if (item.type === "agent_message" && done && item.text) {
      const delta = (t.text && !t.text.endsWith("\n\n") ? "\n\n" : "") + item.text;
      t.text += delta;
      s.emit({ type: "text", delta });
    } else if (item.type === "reasoning") {
      step(s, { id, icon: "think", label: "Thought it through", running: "Thinking", status: done ? "done" : "running" });
    } else if (item.type === "command_execution") {
      const failed = done && typeof item.exit_code === "number" && item.exit_code !== 0;
      const what = /\b(cat|sed|head|tail|less|rg|grep|ls|find)\b/.test(String(item.command ?? "")) ? { icon: "read" as const, label: "Read the project", running: "Reading the project" } : { icon: "code" as const, label: "Ran a command", running: "Running a command" };
      step(s, { id, ...what, status: !done ? "running" : failed ? "failed" : "done", ...(failed ? { icon: "fail" as const } : {}) });
    } else if (item.type === "file_change") {
      const path = String(item.changes?.[0]?.path ?? "");
      step(s, { id, status: done ? (item.status === "failed" ? "failed" : "done") : "running", ...describeTool("Edit", { file_path: path }) });
      if (done && (item.changes ?? []).some((c: any) => String(c.path).endsWith("plan.json"))) livePlan(s, dir);
    }
    return;
  }
  if (e.type === "turn.completed") {
    // Codex may have edited plan.json with a command rather than a file change: look once more.
    try {
      if (readFileSync(join(dir, "plan.json"), "utf8") !== JSON.stringify(t.current, null, 2)) livePlan(s, dir);
    } catch {}
    void finish(s, dir, { is_error: false });
  } else if (e.type === "turn.failed" || e.type === "error") {
    void finish(s, dir, { is_error: true, result: e.error?.message ?? e.message ?? "unknown error", api_error_status: "error" });
  }
}

/** One line of Claude's stream-json output. */
function onEvent(s: Session, dir: string, e: any) {
  const t = s.turn;
  if (e.type === "system" && e.subtype === "init" && e.session_id) {
    s.id = e.session_id;
    resumeIds.set(s.source, e.session_id);
  }
  if (!t) return;
  if (e.type === "stream_event") {
    const ev = e.event;
    if (ev.type === "content_block_start") {
      const b = ev.content_block;
      t.blocks.set(ev.index, { kind: b.type, started: Date.now(), tool: b.type === "tool_use" ? { id: b.id, name: b.name, json: "" } : undefined });
      if (b.type === "thinking") step(s, { id: `think-${Date.now()}`, icon: "think", label: "Thinking", running: "Thinking", status: "running" });
      if (b.type === "text" && t.text && !t.text.endsWith("\n\n")) (t.text += "\n\n"), s.emit({ type: "text", delta: "\n\n" });
    } else if (ev.type === "content_block_delta") {
      if (ev.delta.type === "text_delta") (t.text += ev.delta.text), s.emit({ type: "text", delta: ev.delta.text });
      if (ev.delta.type === "input_json_delta") {
        const b = t.blocks.get(ev.index);
        if (b?.tool) b.tool.json += ev.delta.partial_json;
      }
    } else if (ev.type === "content_block_stop") {
      const b = t.blocks.get(ev.index);
      if (b?.kind === "thinking") {
        const running = [...t.steps.values()].find((x) => x.icon === "think" && x.status === "running");
        const ms = Date.now() - b.started;
        if (running) step(s, { ...running, status: "done", ms, label: `Thought for ${(ms / 1000).toFixed(1)}s` });
      }
      if (b?.tool) {
        let input: any = {};
        try {
          input = JSON.parse(b.tool.json || "{}");
        } catch {}
        step(s, { id: b.tool.id, status: "running", ...describeTool(b.tool.name, input) });
      }
    }
    return;
  }
  // Tool results: mark the step done (or failed); an edit to the timeline shows up live.
  if (e.type === "user" && Array.isArray(e.message?.content)) {
    for (const c of e.message.content) {
      if (c.type !== "tool_result") continue;
      const st = t.steps.get(c.tool_use_id);
      if (!st) continue;
      step(s, { ...st, status: c.is_error ? "failed" : "done", icon: c.is_error ? "fail" : st.icon, label: c.is_error ? `${st.label} (failed)` : st.label });
      if (!c.is_error && st.icon === "edit") livePlan(s, dir);
    }
    return;
  }
  if (e.type === "result") void finish(s, dir, e);
}

function step(s: Session, st: Step) {
  s.turn!.steps.set(st.id, st);
  s.emit({ type: "step", step: st });
}

/** Shows the timeline as Claude just left it (when it's valid). */
function livePlan(s: Session, dir: string) {
  try {
    const parsed = EditPlan.safeParse(JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")));
    if (parsed.success) {
      s.turn!.changed = true;
      // B-roll Claude asked for by description shows once it's found and downloaded.
      s.emit({ type: "plan", plan: { ...parsed.data, broll: parsed.data.broll.filter((b) => !b.source.startsWith("stock:")), voiceovers: parsed.data.voiceovers.filter((v) => !/^(sfx|music|earshot):/.test(v.file)) } });
    }
  } catch {}
}

/** Claude's turn ended: check the edit (sending problems back to fix), then hand it over. */
async function finish(s: Session, dir: string, result: any) {
  const t = s.turn!;
  if (result.is_error) {
    s.emit({ type: "error", error: signInProblem(String(result.result ?? ""), s.kind === "codex" ? "ChatGPT" : "Claude") ?? `${s.kind === "codex" ? "ChatGPT" : "Claude"} ${result.api_error_status ?? "error"}: ${result.result ?? "unknown error"}` });
    s.turn = undefined;
    return t.resolve();
  }
  // Handed to the full edit: the turn stays open while it runs (electron/main.ts runs it).
  const { ask } = splitFullEdit(t.text);
  if (ask && s.kind === "claude") {
    s.emit({ type: "handoff", ask });
    s.turn = undefined;
    return t.resolve();
  }
  const { question } = splitAsk(t.text);
  if (t.changed) {
    const id = `check-${Date.now()}`;
    step(s, { id, icon: "check", label: "Checked the edit", running: "Checking the edit", status: "running" });
    const { plan, problems } = await check(dir, t.analysis, t.current, t.focus);
    if (problems.length && t.fixes < 2) {
      t.fixes++;
      step(s, { id, icon: "fail", label: `Found ${problems.length} problem${problems.length > 1 ? "s" : ""} to fix`, running: "", status: "failed" });
      s.send(`Creatro checked your work and found problems. Fix them, then reply again in one sentence:\n- ${problems.join("\n- ")}`);
      return;
    }
    step(s, { id, icon: "check", label: problems.length ? "Checked the edit (some problems left)" : "Checked the edit", running: "", status: problems.length ? "failed" : "done" });
    let final = problems.length ? undefined : plan;
    // B-roll asked for by description: find each shot in the stock library and download it.
    if (final?.broll.some((b) => b.source.startsWith("stock:"))) {
      const size = outputSize(final, t.analysis);
      const orientation: Orientation = size.height > size.width * 1.1 ? "portrait" : size.width > size.height * 1.1 ? "landscape" : "square";
      try {
        const r = await resolveStockBroll(final, orientation, (sid, what, done, found) =>
          step(s, { id: sid, icon: done && !found ? "fail" : "look", label: !done ? `Finding B-roll: ${what}` : found ? `Found B-roll: ${what}` : `No stock clip for: ${what}`, running: `Finding B-roll: ${what}`, status: done ? (found ? "done" : "failed") : "running" }),
        );
        final = r.plan;
        if (r.missing.length) s.emit({ type: "text", delta: `\n\nNo stock clip matched ${r.missing.map((m) => `"${m}"`).join(", ")}: attach your own and I'll place it.` });
      } catch (e) {
        final = { ...final, broll: final.broll.filter((b) => !b.source.startsWith("stock:")) };
        s.emit({ type: "text", delta: `\n\nCouldn't get stock B-roll: ${e instanceof Error ? e.message : e}` });
      }
    }
    // Sound effects and music asked for by description: find each in the free sound library.
    if (final?.voiceovers.some((v) => /^(sfx|music|earshot):/.test(v.file))) {
      try {
        const r = await resolveSounds(final, (sid, what, done, found) =>
          step(s, { id: sid, icon: done && !found ? "fail" : "look", label: !done ? `Finding sound: ${what}` : found ? `Found sound: ${what}` : `No sound found for: ${what}`, running: `Finding sound: ${what}`, status: done ? (found ? "done" : "failed") : "running" }),
        );
        final = r.plan;
        if (r.missing.length) s.emit({ type: "text", delta: `\n\nNo free sound matched ${r.missing.map((m) => `"${m}"`).join(", ")}: pick one in the SFX panel and I'll place it.` });
      } catch (e) {
        final = { ...final, voiceovers: final.voiceovers.filter((v) => !/^(sfx|music|earshot):/.test(v.file)) };
        s.emit({ type: "text", delta: `\n\nCouldn't get the sounds: ${e instanceof Error ? e.message : e}` });
      }
    }
    s.emit({ type: "done", plan: final, question, changed: Boolean(final) });
  } else s.emit({ type: "done", question, changed: false });
  s.turn = undefined;
  t.resolve();
}

/** What a tool call looks like in the chat: done and in-progress wording, and an icon. */
function describeTool(name: string, input: any): Omit<Step, "id" | "status"> {
  const file = String(input.file_path ?? input.path ?? "");
  const base = basename(file);
  const what =
    base === "plan.json" ? "the timeline"
    : base === "video.md" ? "the transcript"
    : base === "CREATRON.md" ? "the editing guide"
    : base === "plan.schema.json" ? "the timeline format"
    : /\.tsx?$/.test(base) ? `the ${base.replace(/\.tsx?$/, "")} animation`
    : base;
  if (name === "Read" && /\.(png|jpe?g|webp)$/i.test(base)) return { icon: "look", label: `Looked at ${base}`, running: `Looking at ${base}` };
  if (name === "Read") return { icon: "read", label: `Read ${what}`, running: `Reading ${what}` };
  if ((name === "Edit" || name === "Write") && /\.tsx?$/.test(base)) return { icon: "code", label: `Wrote ${what}`, running: `Writing ${what}` };
  if (name === "Edit" || name === "Write") return { icon: "edit", label: `Edited ${what}`, running: `Editing ${what}` };
  if (name === "Glob" || name === "Grep") return { icon: "search", label: "Searched the project", running: "Searching the project" };
  return { icon: "read", label: `Used ${name}`, running: `Using ${name}` };
}
