// Step 2: ask a model for an edit plan. Only text goes out (video info, timed transcript,
// pauses, the user's request); the video itself never leaves the machine.
import { z } from "zod";
import type { Analysis } from "./schema.ts";
import { EditPlan, type Segment, checkPlan } from "./schema.ts";
import { round } from "./round.ts";
import type { Orientation, StockClip } from "./stock.ts";
import { outputDuration, toOutputTime } from "./timeline.ts";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM = `You are Creatron, a video editor. You cannot see the video; you get its info, a transcript
split into timed phrases, and detected pauses. Turn the user's request into an edit plan by calling
submit_edit_plan exactly once.

Editing rules:
- segments are the parts of the SOURCE to keep, in playback order; anything not listed is cut.
- Cut on phrase boundaries, never inside a word. Leave ~0.08s before a phrase starts and after it ends.
- To remove pauses or dead air, end a segment just after one phrase and start the next just before the next phrase.
- To remove a fumbled or repeated line, drop that phrase and keep the better take.
- Punch-in zoom (1.1-1.25) on alternating segments keeps talking-head footage lively; only use it when it suits the request.
- Reels/Shorts/TikTok mean aspect 9:16 and usually captions on.
- Captions follow the transcript automatically. To change their wording (fix a misheard word, add an
  emoji, shorten a line), write captions.cues: every caption with start/end in SOURCE seconds and text.
  Keep the user's existing cues and positions unless the request is about them.
- B-roll (clips shown over the speaker while they keep talking): only when the user asks for it.
  Search with 1-3 concrete words for what should be ON SCREEN ("watering plants", "city street night"):
  search_broll finds clean stock footage (best for general visuals); search_web_video searches the whole web
  (YouTube, Vimeo, Dailymotion, Wikimedia Commons…), best for specific things: a named place, product,
  person, event or meme. For a web video the app finds the right few seconds inside it and checks the frames.
  Pick results whose title promises the visual (footage, close-up, timelapse) over talks and tutorials.
  Search again with other words if nothing fits, then add broll entries using ids those searches returned,
  with query = what should be on screen. Set atSource to the transcript second where the matching words are
  said and duration 2-5 s. Keep the first 2 s on the speaker (the hook) unless asked. Never use a clip id you
  did not get from a search.
- Animated captions: when the user asks for animated / word-by-word / highlighted / TikTok-style captions,
  set captions.enabled true and captions.animation to "pop" (each caption pops in), "highlight" (the word
  being said lights up in captions.highlight) or "word" (one big word at a time). "none" = plain.
- Animated text (motion): a "title" is big centered text that pops in (hooks, section headings: "3 PLANT
  MISTAKES"); a "lower-third" is a name/label bar near the bottom (who is speaking, a place, a product).
  Add motion entries only when asked or when the request clearly wants on-screen text. Keep text to 2-6
  words, set atSource to the transcript second where it should appear and duration 2-4 s. Keep the user's
  existing motion entries unless the request is about them.
- PICKED CLIPS: when the user has picked clips on the timeline, the request is about those clips only
  ("make it short", "mute it", "voice down to 20%", "zoom in", "speed it up"). Change only those segments:
  shorter = keep the best phrases inside that clip's own range (you may split it into several segments);
  volume 0.2 = 20%, 0 = muted; zoom 1.2 = 20% closer. Every other segment must stay exactly as it is, in the
  same order. If a B-roll clip is picked, change only that B-roll entry (move, trim, replace via a new search).
- Never invent times outside 0..duration.
- In notes, tell the user in one or two plain sentences what you did.`;

/** What the user picked on the timeline: segment indexes, and maybe one B-roll id. */
export type Focus = { clips: number[]; broll?: string };

export type PlanResult = {
  plan: EditPlan;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  /** Stock clips the model saw, by id, so the app can download the ones it chose. */
  clips: Map<string, StockClip>;
};

/** Lets the model look for B-roll; absent when no stock-video key is configured. */
export type BrollSearch = (query: string, orientation: Orientation) => Promise<StockClip[]>;
/** Lets the model search the web for video; absent when yt-dlp isn't installed. */
export type WebSearch = (query: string) => Promise<StockClip[]>;

export async function makePlan(
  analysis: Analysis,
  request: string,
  model = process.env.CREATRON_MODEL || DEFAULT_MODEL,
  log = console.error,
  current?: EditPlan,
  searchBroll?: BrollSearch,
  searchWeb?: WebSearch,
  focus?: Focus,
): Promise<PlanResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key.");

  const submit = {
    type: "function",
    function: {
      name: "submit_edit_plan",
      description: "Submit the edit plan for this video. Call it once, at the end.",
      parameters: z.toJSONSchema(EditPlan, { io: "input" }),
    },
  };
  const search = {
    type: "function",
    function: {
      name: "search_broll",
      description: "Search licensed stock video for B-roll. Returns clip ids with a description, length and size.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "1-3 concrete words for what should be on screen" },
          orientation: { type: "string", enum: ["portrait", "landscape", "square"], description: "Match the output frame" },
        },
        required: ["query"],
      },
    },
  };
  const web = {
    type: "function",
    function: {
      name: "search_web_video",
      description:
        "Search the whole web for video B-roll (YouTube, Vimeo, Dailymotion, Wikimedia Commons…). " +
        "Returns ids with title, site, channel, length and licence when known.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "1-4 concrete words for what should be on screen" } },
        required: ["query"],
      },
    },
  };
  const searchTools = [...(searchBroll ? [search] : []), ...(searchWeb ? [web] : [])];
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        describe(analysis),
        // In the app the user is mid-edit: the model changes their timeline instead of starting over.
        current
          ? `\nCURRENT EDIT PLAN (the user's timeline; keep everything the request doesn't ask to change):\n${JSON.stringify(current)}`
          : "",
        current && focus ? describeFocus(current, focus) : "",
        searchTools.length ? "" : "\n(B-roll search is not available: no stock video key or yt-dlp is set up. Don't add broll.)",
        searchTools.length && !searchBroll ? "\n(Stock search is off: no stock video key. Use search_web_video for B-roll.)" : "",
        `\nREQUEST: ${request}`,
      ].join("\n"),
    },
  ];

  const totals = { inputTokens: 0, outputTokens: 0, cost: 0 };
  const clips = new Map<string, StockClip>();
  const shape = (current?.aspect ?? "source") === "9:16" || (current?.aspect === "source" && analysis.height > analysis.width)
    ? "portrait" : current?.aspect === "1:1" ? "square" : "landscape";
  let invalid = 0;
  let searches = 0;
  // A few rounds: the model may search for B-roll several times, then submits the plan.
  for (let round = 1; round <= 10; round++) {
    const mustSubmit = !searchTools.length || searches >= 6 || round === 10;
    log(`plan: asking ${model}${invalid ? " (fixing the plan)" : searches ? ` (looked for B-roll ${searches}×)` : ""}`);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Creatron" },
      body: JSON.stringify({
        model,
        messages,
        tools: mustSubmit ? [submit] : [...searchTools, submit],
        tool_choice: mustSubmit ? { type: "function", function: { name: "submit_edit_plan" } } : "required",
        usage: { include: true },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as any;
    // OpenRouter can answer 200 with an error inside (e.g. the model's provider is overloaded).
    if (data.error) throw new Error(`OpenRouter ${data.error.code ?? res.status}: ${data.error.message ?? "unknown error"}`);
    totals.inputTokens += data.usage?.prompt_tokens ?? 0;
    totals.outputTokens += data.usage?.completion_tokens ?? 0;
    totals.cost += data.usage?.cost ?? 0;

    const message = data.choices?.[0]?.message;
    const calls: any[] = message?.tool_calls ?? [];
    if (!calls.length) {
      if (!message) throw new Error(`model did not return an edit plan: ${String(JSON.stringify(data)).slice(0, 300)}`);
      messages.push(message, { role: "user", content: "Call submit_edit_plan with the edit plan now." });
      continue;
    }
    messages.push(message);

    for (const call of calls) {
      let args: any;
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = undefined;
      }
      if (call.function.name === "search_broll" && searchBroll) {
        searches++;
        const query = String(args?.query ?? "").slice(0, 80);
        log(`plan: searching stock video for "${query}"`);
        let content: string;
        try {
          const found = (await searchBroll(query, args?.orientation ?? shape)).slice(0, 8);
          found.forEach((c) => clips.set(c.id, { ...c, query }));
          content = found.length
            ? JSON.stringify(found.map((c) => ({ id: c.id, description: c.description, seconds: c.duration, size: `${c.width}x${c.height}` })))
            : "No clips found. Try different, simpler words.";
        } catch (e) {
          content = `Search failed: ${e instanceof Error ? e.message : e}`;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content });
        continue;
      }
      if (call.function.name === "search_web_video" && searchWeb) {
        searches++;
        const query = String(args?.query ?? "").slice(0, 80);
        log(`plan: searching the web for "${query}" video`);
        let content: string;
        try {
          const found = await searchWeb(query);
          found.forEach((c) => clips.set(c.id, { ...c, query }));
          content = found.length
            ? JSON.stringify(found.map((c) => ({ id: c.id, title: c.description, channel: c.author, seconds: Math.round(c.duration), licence: c.license })))
            : "No videos found. Try different, simpler words.";
        } catch (e) {
          content = `Search failed: ${e instanceof Error ? e.message : e}`;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content });
        continue;
      }
      if (call.function.name !== "submit_edit_plan") {
        messages.push({ role: "tool", tool_call_id: call.id, content: "Unknown tool." });
        continue;
      }

      let problems: string[];
      try {
        const plan = placeBroll(EditPlan.parse(args), clips);
        // B-roll already on the user's timeline is fine; anything new must come from a search.
        const known = (id: string) => clips.has(id) || Boolean(current?.broll.some((b) => b.source === id && b.file));
        problems = [
          ...checkPlan(plan, analysis),
          ...(current && focus ? keepsUnpicked(current, plan, focus.clips).problems : []),
          ...plan.broll.filter((b) => !known(b.source)).map((b) => `broll ${b.source}: not a clip id returned by search_broll or search_web_video`),
        ];
        if (!problems.length) return { plan, model, ...totals, clips };
      } catch (e) {
        problems = [e instanceof z.ZodError ? z.prettifyError(e) : String(e)];
      }
      if (++invalid >= 2) throw new Error(`model returned an invalid plan twice:\n${problems.join("\n")}`);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `That plan is invalid. Fix these and call submit_edit_plan again:\n${problems.join("\n")}`,
      });
    }
  }
  throw new Error("the model didn't finish the edit plan");
}

/** The picked clips, as the model sees them. Clip numbers match the timeline ("Clip 2" = segments[1]). */
function describeFocus(plan: EditPlan, focus: Focus): string {
  const lines = focus.clips
    .filter((i) => plan.segments[i])
    .map((i) => {
      const s = plan.segments[i];
      return `- Clip ${i + 1} = segments[${i}]: source ${s.start.toFixed(2)}-${s.end.toFixed(2)}s, speed ${s.speed}, zoom ${s.zoom}, volume ${s.volume ?? 1}`;
    });
  const b = focus.broll ? plan.broll.find((x) => x.id === focus.broll) : undefined;
  if (b) lines.push(`- B-roll id "${b.id}" (${b.query ?? b.source}) at ${b.at.toFixed(2)}s for ${b.duration.toFixed(2)}s`);
  if (!lines.length) return "";
  return `\nPICKED ON THE TIMELINE (apply the request to these only; keep everything else exactly as it is):\n${lines.join("\n")}`;
}

/**
 * Checks that an edit left every clip the user didn't pick exactly as it was, in order; picked clips
 * may become any number of segments inside their own source range. kept = indexes in `after` that
 * are untouched clips (so later steps, like snapping cuts, leave them alone).
 */
export function keepsUnpicked(before: EditPlan, after: EditPlan, picked: number[]): { problems: string[]; kept: Set<number> } {
  const same = (a: Segment, b: Segment) =>
    Math.abs(a.start - b.start) < 0.01 && Math.abs(a.end - b.end) < 0.01 && a.speed === b.speed && a.zoom === b.zoom && (a.volume ?? 1) === (b.volume ?? 1);
  const kept = new Set<number>();
  const problems: string[] = [];
  let j = 0;
  before.segments.forEach((orig, i) => {
    if (picked.includes(i)) {
      const next = before.segments.slice(i + 1).find((_, k) => !picked.includes(i + 1 + k));
      while (j < after.segments.length) {
        const s = after.segments[j];
        if (next && same(s, next)) break;
        if (s.start < orig.start - 0.05 || s.end > orig.end + 0.05) break;
        j++;
      }
    } else if (j < after.segments.length && same(after.segments[j], orig)) kept.add(j++);
    else problems.push(`segments: Clip ${i + 1} was not picked, so it must stay exactly {start: ${orig.start}, end: ${orig.end}, speed: ${orig.speed}, zoom: ${orig.zoom}, volume: ${orig.volume ?? 1}} at this place in the order`);
  });
  if (!problems.length && j < after.segments.length)
    problems.push("segments: picked clips may only use parts of their own source range; remove the extra segments");
  return { problems, kept };
}

/** Turns each B-roll's and text item's transcript time (atSource) into a timeline position; drops ones over cut parts. */
function placeBroll(plan: EditPlan, clips: Map<string, StockClip>): EditPlan {
  plan = placeMotion(plan);
  const total = outputDuration(plan);
  const broll = plan.broll.flatMap((b, i) => {
    const at = b.atSource !== undefined ? toOutputTime(plan, b.atSource) : b.at;
    if (at === undefined || at >= total - 0.3) return [];
    const clip = clips.get(b.source);
    const duration = Math.min(b.duration, total - at, clip?.duration ?? b.duration);
    return [{ ...b, id: b.id || `b${Date.now().toString(36)}${i}`, at: round(at, 3), duration: round(duration, 3), atSource: undefined }];
  });
  return { ...plan, broll };
}

function placeMotion(plan: EditPlan): EditPlan {
  const total = outputDuration(plan);
  const motion = plan.motion.flatMap((m, i) => {
    const at = m.atSource !== undefined ? toOutputTime(plan, m.atSource) : m.at;
    if (at === undefined || at >= total - 0.3) return [];
    return [{ ...m, id: m.id || `m${Date.now().toString(36)}${i}`, at: round(at, 3), duration: round(Math.min(m.duration, total - at), 3), atSource: undefined }];
  });
  return { ...plan, motion };
}

/** The text the model sees: video info, phrases with times, and pauses. */
export function describe(a: Analysis): string {
  const phrases: { start: number; end: number; text: string }[] = [];
  for (const w of a.words) {
    const last = phrases.at(-1);
    // A new phrase after a gap, at sentence ends, or when a phrase gets long.
    if (!last || w.start - last.end > 0.3 || /[.!?]$/.test(last.text) || last.text.split(" ").length >= 14)
      phrases.push({ start: w.start, end: w.end, text: w.text });
    else {
      last.text += ` ${w.text}`;
      last.end = w.end;
    }
  }
  const t = (n: number) => round(n).toFixed(2);
  return [
    `VIDEO: ${a.width}x${a.height}, ${a.fps} fps, ${t(a.duration)}s, ${a.hasAudio ? "has audio" : "no audio"}`,
    "",
    "TRANSCRIPT (start-end seconds: text):",
    phrases.length ? phrases.map((p) => `${t(p.start)}-${t(p.end)}: ${p.text}`).join("\n") : "(no speech)",
    "",
    "PAUSES (start-end seconds):",
    a.silences.length ? a.silences.map((s) => `${t(s.start)}-${t(s.end)}`).join(", ") : "(none detected)",
  ].join("\n");
}
