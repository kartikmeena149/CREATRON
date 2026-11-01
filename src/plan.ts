// Step 2: ask a model for an edit plan. Only text goes out (video info, timed transcript,
// pauses, the user's request); the video itself never leaves the machine.
import { z } from "zod";
import type { Analysis } from "./schema.ts";
import { EditPlan, checkPlan } from "./schema.ts";
import { round } from "./round.ts";

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
- Never invent times outside 0..duration.
- In notes, tell the user in one or two plain sentences what you did.`;

export type PlanResult = { plan: EditPlan; model: string; inputTokens: number; outputTokens: number; cost?: number };

export async function makePlan(
  analysis: Analysis,
  request: string,
  model = process.env.CREATRON_MODEL || DEFAULT_MODEL,
  log = console.error,
  current?: EditPlan,
): Promise<PlanResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key.");

  const tool = {
    type: "function",
    function: {
      name: "submit_edit_plan",
      description: "Submit the edit plan for this video.",
      parameters: z.toJSONSchema(EditPlan, { io: "input" }),
    },
  };
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
        `\nREQUEST: ${request}`,
      ].join("\n"),
    },
  ];

  const totals = { inputTokens: 0, outputTokens: 0, cost: 0 };
  // One retry: if the plan is invalid, the model gets the exact problems back and fixes them.
  for (let attempt = 1; attempt <= 2; attempt++) {
    log(`plan: asking ${model}${attempt > 1 ? " (retry)" : ""}`);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Creatron" },
      body: JSON.stringify({
        model,
        messages,
        tools: [tool],
        tool_choice: { type: "function", function: { name: "submit_edit_plan" } },
        usage: { include: true },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as any;
    totals.inputTokens += data.usage?.prompt_tokens ?? 0;
    totals.outputTokens += data.usage?.completion_tokens ?? 0;
    totals.cost += data.usage?.cost ?? 0;

    const message = data.choices?.[0]?.message;
    const call = message?.tool_calls?.[0];
    if (!call) throw new Error(`model did not return an edit plan: ${JSON.stringify(message).slice(0, 300)}`);

    let problems: string[];
    try {
      const plan = EditPlan.parse(JSON.parse(call.function.arguments));
      problems = checkPlan(plan, analysis);
      if (!problems.length) return { plan, model, ...totals };
    } catch (e) {
      problems = [e instanceof z.ZodError ? z.prettifyError(e) : String(e)];
    }
    if (attempt === 2) throw new Error(`model returned an invalid plan twice:\n${problems.join("\n")}`);
    messages.push(message, {
      role: "tool",
      tool_call_id: call.id,
      content: `That plan is invalid. Fix these and call submit_edit_plan again:\n${problems.join("\n")}`,
    });
  }
  throw new Error("unreachable");
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
