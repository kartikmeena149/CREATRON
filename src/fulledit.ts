// The full edit, run from the chat. When the chat's Claude decides a request is a whole finished video
// (B-roll, music, sound, motion graphics, a reference's style), it hands it over with a `fulledit`
// block (src/chat.ts). This runs Auto Edit (src/autoedit.ts) on that brief and streams it into the same
// chat turn: its stage, how far along, the time left, then the result. Later changes to that finished
// video go back to the same Auto Edit session.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AutoEditEvent, type StoryboardReview, autoEdit, autoEditDir, autoEditFix, cancelAutoEdit, lastSessionFile } from "./autoedit.ts";
import type { ChatEvent, FullEditAsk, FullEditResult, Step } from "./chatTypes.ts";

const STAGE_LABELS: Record<string, string> = {
  board: "Drawing the storyboard", look: "Watching the footage", cut: "Cutting", plan: "Planning the edit", broll: "Finding B-roll and sound",
  build: "Building the video", render: "Rendering", check: "Checking its work", fix: "Polishing",
};

/** What the chat remembers about a video's full edit, kept in its project folder. */
type Saved = { session: string; version: number; notes: string; model: string };
const savedFile = (video: string) => join(autoEditDir(video), ".creatron", "chat-session.json");

/** The video's last full edit (for the chat to mention), if there is one. */
export function fullEditInfo(video: string): Saved | undefined {
  try {
    return existsSync(savedFile(video)) ? (JSON.parse(readFileSync(savedFile(video), "utf8")) as Saved) : undefined;
  } catch {
    return undefined;
  }
}

/** Only one full edit runs at a time (it takes the Mac's renderer for a while). */
let running: string | undefined;
export const fullEditRunning = (video: string) => running === video;
export function stopFullEdit(video: string) {
  if (running === video) cancelAutoEdit();
}

/**
 * Runs the handed-over request: a new full edit (`brief`) or a change to the last one (`change`).
 * `model` is Claude's ("sonnet" or "opus"). Progress and steps go to `emit` as chat events.
 */
export async function runFullEdit(
  video: string, ask: FullEditAsk, model: string, emit: (e: ChatEvent) => void, opts: { clips?: string[]; review?: StoryboardReview } = {},
): Promise<FullEditResult> {
  if (running) throw new Error("A full edit is already running. Wait for it to finish, or stop it first.");
  running = video;
  const before = fullEditInfo(video);
  const change = ask.change && before ? ask.change : undefined;
  const steps = toSteps(emit);
  try {
    const r = change
      ? await autoEditFix(video, before!.session, model, change, [], steps.on)
      : await autoEdit({ video, brief: ask.brief ?? ask.change ?? "", reference: ask.reference, model, clips: opts.clips, review: opts.review }, steps.on);
    steps.end();
    writeFileSync(savedFile(video), JSON.stringify({ session: r.session, version: r.version, notes: r.notes, model } satisfies Saved, null, 1));
    return { dir: r.dir, project: r.project, final: r.final, notes: r.notes, version: r.version };
  } catch (e) {
    // A new edit that stopped part way still leaves its project and its session. Saved, the next
    // request ("render it again", a change) continues that work instead of starting over for 20 minutes.
    if (!change) keepUnfinished(video, model, e);
    throw e;
  } finally {
    running = undefined;
  }
}

function keepUnfinished(video: string, model: string, e: unknown) {
  const dir = autoEditDir(video);
  const session = existsSync(lastSessionFile(dir)) ? readFileSync(lastSessionFile(dir), "utf8").trim() : "";
  if (!session || !existsSync(join(dir, "project", "timeline.json")) || /^Stopped/.test(String((e as Error)?.message ?? e))) return;
  const why = String(e instanceof Error ? e.message : e).split("\n")[0]!.slice(0, 200);
  const notes = `NOT FINISHED: the last full edit stopped before it was done; its project is built and kept. Any request about this video (render it, finish it, a change) continues it: hand it over with "change", never a new "brief". It stopped because: ${why}`;
  writeFileSync(savedFile(video), JSON.stringify({ session, version: fullEditInfo(video)?.version ?? 0, notes, model } satisfies Saved, null, 1));
}

/**
 * Auto Edit's events as the chat shows them: progress becomes the turn's progress bar, its own
 * notes become steps, and the tool it's using shows as the one running step.
 */
function toSteps(emit: (e: ChatEvent) => void) {
  let n = 0;
  let live: Step | undefined;
  const settle = () => live && (emit({ type: "step", step: { ...live, status: "done" } }), (live = undefined));
  return {
    on(e: AutoEditEvent) {
      if (e.type === "progress") {
        emit({ type: "job", progress: { stage: e.stage, label: STAGE_LABELS[e.stage] ?? e.stage, fraction: e.fraction, elapsedMs: e.elapsedMs, remainingMs: e.remainingMs } });
        return;
      }
      const text = e.text.trim().replace(/\s+/g, " ").slice(0, 120);
      if (!text) return;
      settle();
      live = { id: `full-${++n}`, icon: e.kind === "tool" ? "code" : e.kind === "note" ? "think" : "look", label: text, running: text, status: "running" };
      emit({ type: "step", step: live });
    },
    end: settle,
  };
}
