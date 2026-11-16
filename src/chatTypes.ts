// What the live chat (src/chat.ts) streams to the window, and reading Claude's question out of its
// reply. Pure, no Node or browser APIs: the app imports it too.
import type { EditPlan } from "./schema.ts";

export type StepIcon = "read" | "edit" | "code" | "look" | "search" | "think" | "check" | "fail";
export type Step = { id: string; icon: StepIcon; label: string; running: string; status: "running" | "done" | "failed"; ms?: number };
export type Question = { question: string; detail?: string; options: { label: string; detail?: string }[] };

/**
 * Claude handing a request to the full edit (src/fulledit.ts): a whole finished video from the raw
 * footage (`brief`), or a change to the finished video it made before (`change`).
 */
export type FullEditAsk = { brief?: string; change?: string; reference?: string };
/** A finished full edit: the open project folder, the part the timeline imports, the exported video. */
export type FullEditResult = { dir: string; project: string; final: string; notes: string; version: number; url?: string };
/** Where a running full edit is: its step, how far along, and the time left. */
export type FullEditProgress = { stage: string; label: string; fraction: number; elapsedMs: number; remainingMs: number };

export type ChatEvent =
  | { type: "start" }
  | { type: "handoff"; ask: FullEditAsk }
  | { type: "job"; progress: FullEditProgress }
  | { type: "result"; result: FullEditResult }
  | { type: "text"; delta: string }
  | { type: "step"; step: Step }
  | { type: "plan"; plan: EditPlan }
  | { type: "done"; plan?: EditPlan; question?: Question; changed: boolean }
  | { type: "error"; error: string };

/** Claude's reply without its hand-off block, and what it hands to the full edit. */
export function splitFullEdit(text: string): { text: string; ask?: FullEditAsk } {
  const m = text.match(/```fulledit\s*([\s\S]*?)(```|$)/);
  if (!m) return { text };
  let ask: FullEditAsk | undefined;
  try {
    const a = JSON.parse(m[1]);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    if (str(a?.brief) || str(a?.change)) ask = { brief: str(a.brief), change: str(a.change), reference: str(a.reference) };
  } catch {}
  return { text: (text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length)).trim(), ask };
}

/** Claude's reply without its ask block (or hand-off block), and the question in it. */
export function splitAsk(full: string): { text: string; question?: Question } {
  const text = splitFullEdit(full).text;
  const m = text.match(/```ask\s*([\s\S]*?)(```|$)/);
  if (!m) return { text };
  let question: Question | undefined;
  try {
    const q = JSON.parse(m[1]);
    if (q?.question && Array.isArray(q.options)) question = { question: String(q.question), detail: q.detail ? String(q.detail) : undefined, options: q.options.slice(0, 4).map((o: any) => ({ label: String(o.label ?? o), detail: o.detail ? String(o.detail) : undefined })) };
  } catch {}
  return { text: text.slice(0, m.index).trim(), question };
}


/**
 * Claude's sign-in on this Mac is missing or has run out (never signed in, logged out, or the
 * session expired and couldn't renew). Then the plain fix to show instead of Claude's raw error.
 */
export function signInProblem(text: string, who: "Claude" | "ChatGPT" = "Claude"): string | undefined {
  if (!/not logged in|failed to authenticate|oauth|session expired|invalid api key|please run \/login|authentication_error|401|login required|not signed in/i.test(text)) return undefined;
  return /expired|could not be refreshed|failed to authenticate|oauth/i.test(text)
    ? `${who}'s sign-in on this Mac has expired. Open Connections (top left) and press Sign in next to ${who}, then send your message again.`
    : `${who} isn't signed in on this Mac yet. Open Connections (top left) and press Sign in next to ${who}, then send your message again.`;
}

/** A connector's state on this Mac (src/agents.ts finds it out). */
export type AgentId = "claude" | "codex";
export type AgentState = {
  installed: boolean;
  version?: string;
  signedIn: boolean;
  account?: string;
  busy?: "signing-in" | "installing";
  error?: string;
};
/** Everything the Connections page shows. */
export type Connections = {
  claude: AgentState;
  codex: AgentState;
  openrouter: boolean;
  enabled: Record<AgentId, boolean>;
  install: Record<AgentId, string>;
};
