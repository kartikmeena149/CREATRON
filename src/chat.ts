// The live AI chat: one Claude Code session per video that stays open between messages (no start-up
// wait after the first), streaming everything it does so the chat can show it as it happens: its
// words, its thinking, each file it reads or edits, and the timeline changing under it. When a choice
// is the user's, Claude ends its turn with a question card; the answer goes into the same session.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { GUIDE, check, markerFrames, prepare } from "./agent.ts";
import { agentDir } from "./customcode.ts";
import { type Focus, describeFocus } from "./plan.ts";
import { type Analysis, EditPlan } from "./schema.ts";
import { type Orientation, resolveStockBroll } from "./stock.ts";
import { resolveSounds } from "./sfx.ts";
import { outputSize } from "./frame.ts";
import { type ChatEvent, type Question, type Step, splitAsk } from "./chatTypes.ts";

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

type Session = {
  source: string;
  child: ChildProcessWithoutNullStreams;
  model: string;
  id?: string;
  emit: (e: ChatEvent) => void;
  turn?: Turn;
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
  const claudeModel = model.replace(/^claude-code\//, "");
  let s = sessions.get(analysis.source);
  if (s && (s.model !== claudeModel || s.child.exitCode !== null)) (stop(analysis.source), (s = undefined));
  const first = !s && !resumeIds.has(analysis.source);
  // The timeline as it is now (the user may have changed it by hand since the last message).
  prepare(dir, analysis, current);
  if (!s) s = start(analysis.source, dir, claudeModel, emit);
  s.emit = emit;

  const pictures = opts.focus?.markers?.length ? await markerFrames(dir, analysis, current, opts.focus.markers) : [];
  const content = [
    opts.answer ? `My answer: ${message}` : `REQUEST: ${message}`,
    opts.focus ? describeFocus(current, opts.focus) : "",
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
    send(s!, content);
  });
}

/** Stops the video's session (the next message resumes the conversation). */
export function stop(source: string) {
  const s = sessions.get(source);
  if (!s) return;
  sessions.delete(source);
  s.child.kill();
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
    "--append-system-prompt", GUIDE + CHAT_RULES,
    ...(resume ? ["--resume", resume] : []),
  ];
  const child = spawn("claude", args, { env, cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  const s: Session = { source, child, model, emit };
  sessions.set(source, s);
  let buf = "";
  let err = "";
  child.stdout.on("data", (d) => {
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
  child.stderr.on("data", (d) => (err += d));
  child.on("close", () => {
    if (sessions.get(source) === s) sessions.delete(source);
    if (!s.turn) return;
    const msg = /not logged in/i.test(err + buf) ? "Claude isn't signed in on this Mac yet. Open Terminal, type claude, then /login." : `Claude stopped: ${(err || buf).trim().slice(0, 300) || "no reply"}`;
    s.emit({ type: "error", error: msg });
    s.turn.resolve();
    s.turn = undefined;
  });
  child.on("error", (e) => s.turn && (s.emit({ type: "error", error: `Couldn't start Claude: ${e.message}` }), s.turn.resolve(), (s.turn = undefined)));
  return s;
}

const send = (s: Session, text: string) => s.child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");

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
    s.emit({ type: "error", error: `Claude ${result.api_error_status ?? "error"}: ${result.result ?? "unknown error"}` });
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
      send(s, `Creatron checked your work and found problems. Fix them, then reply again in one sentence:\n- ${problems.join("\n- ")}`);
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
