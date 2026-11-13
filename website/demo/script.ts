// The demo's AI. No model runs in the browser, so this reads the request for a few plain words and
// makes the matching edits with the app's own local tools (src/autocut.ts). It says so in its reply.
import { removePauses, roughCut } from "../../src/autocut.ts";
import type { ChatEvent, Step } from "../../src/chatTypes.ts";
import type { Analysis, EditPlan } from "../../src/schema.ts";

type Action = { step: Pick<Step, "icon" | "label" | "running">; run: (plan: EditPlan) => EditPlan; says: (before: EditPlan, after: EditPlan) => string };

function actions(request: string, a: Analysis): Action[] {
  const r = request.toLowerCase();
  const want = {
    cut: /cut|pause|silen|tight|rough|dead air|trim|shorter|retake/.test(r),
    captions: /caption|subtitle/.test(r),
    vertical: /9:16|vertical|reel|shorts|tiktok/.test(r),
    square: /1:1|square/.test(r),
    wide: /16:9|landscape|youtube video/.test(r),
    title: /title|headline/.test(r),
  };
  // A request with none of those words gets the usual first pass on a talking video.
  if (!Object.values(want).some(Boolean)) Object.assign(want, { cut: true, captions: true, vertical: a.width >= a.height });

  const list: Action[] = [];
  if (want.cut)
    list.push({
      step: { icon: "edit", label: "Cut dead air and retakes", running: "Cutting dead air and retakes" },
      run: (p) => (a.words.length ? roughCut(p, a).plan : removePauses(p, a)),
      says: (b, n) => (n === b ? "found nothing to cut" : `cut it into ${n.segments.length} clips, keeping only the spoken lines`),
    });
  if (want.captions)
    list.push({
      step: { icon: "edit", label: "Turn on captions", running: "Writing captions" },
      run: (p) => (a.words.length ? { ...p, captions: { ...p.captions, enabled: true } } : p),
      says: (b, n) => (n === b ? "couldn't caption it: the browser demo has no speech-to-text, the desktop app transcribes on your Mac" : "turned on captions, timed to the words"),
    });
  const aspect = want.vertical ? "9:16" : want.square ? "1:1" : want.wide ? "16:9" : undefined;
  if (aspect)
    list.push({
      step: { icon: "edit", label: `Set the frame to ${aspect}`, running: `Setting the frame to ${aspect}` },
      run: (p) => ({ ...p, aspect }),
      says: () => `set the frame to ${aspect}`,
    });
  if (want.title) {
    const text = (request.match(/["“']([^"”']{2,60})["”']/)?.[1] ?? "Watch this").trim();
    list.push({
      step: { icon: "edit", label: "Add a title", running: "Adding a title" },
      run: (p) => ({ ...p, motion: [...p.motion, { id: `demo-${Date.now()}`, track: 1, template: "title" as const, props: {}, text, subtext: "", at: 0, duration: 2.5, color: "#facc15" }] }),
      says: () => `added the title "${text}" at the start`,
    });
  }
  return list;
}

/** The plan after the scripted edit (for models that answer in one go). */
export function scriptedPlan(request: string, plan: EditPlan, a: Analysis): EditPlan {
  return actions(request, a).reduce((p, x) => x.run(p), plan);
}

const stopped = new Set<object>();
const running = new Map<string, object>();
export const stopScript = (path: string) => void (running.has(path) && stopped.add(running.get(path)!));

/** Plays the edit out like Claude's live chat: steps, the timeline changing as it goes, then a summary. */
export async function runScript(path: string, request: string, plan: EditPlan, a: Analysis, emit: (e: ChatEvent) => void) {
  const turn = {};
  running.set(path, turn);
  const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const gone = () => stopped.has(turn);
  const step = async (id: string, s: Action["step"], ms: number, work?: () => void) => {
    emit({ type: "step", step: { id, ...s, status: "running" } });
    await wait(ms);
    if (gone()) return;
    work?.();
    emit({ type: "step", step: { id, ...s, status: "done", ms } });
  };
  const say = async (text: string) => {
    for (const word of text.split(/(?<= )/)) {
      if (gone()) return;
      emit({ type: "text", delta: word });
      await wait(18);
    }
  };

  emit({ type: "start" });
  await say("This is the browser demo, so I'm following a script instead of a real model. In the desktop app, Claude or any model you pick does this part.\n\n");
  await step("read", { icon: "read", label: a.words.length ? `Read the transcript (${a.words.length} words)` : "Looked at the sound", running: "Reading the video" }, 700);

  const did: string[] = [];
  let now = plan;
  for (const [i, x] of actions(request, a).entries()) {
    if (gone()) return;
    await step(`edit-${i}`, x.step, 650, () => {
      const next = x.run(now);
      did.push(x.says(now, next));
      if (next !== now) emit({ type: "plan", plan: (now = next) });
    });
  }
  if (gone()) return;
  await say(`Done: I ${did.join(", ")}. Undo with ⌘Z, or change anything by hand on the timeline.`);
  if (gone()) return;
  emit({ type: "done", plan: now, changed: now !== plan });
  running.delete(path);
}
