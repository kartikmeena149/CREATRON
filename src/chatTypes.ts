// What the live chat (src/chat.ts) streams to the window, and reading Claude's question out of its
// reply. Pure, no Node or browser APIs: the app imports it too.
import type { EditPlan } from "./schema.ts";

export type StepIcon = "read" | "edit" | "code" | "look" | "search" | "think" | "check" | "fail";
export type Step = { id: string; icon: StepIcon; label: string; running: string; status: "running" | "done" | "failed"; ms?: number };
export type Question = { question: string; detail?: string; options: { label: string; detail?: string }[] };

export type ChatEvent =
  | { type: "start" }
  | { type: "text"; delta: string }
  | { type: "step"; step: Step }
  | { type: "plan"; plan: EditPlan }
  | { type: "done"; plan?: EditPlan; question?: Question; changed: boolean }
  | { type: "error"; error: string };

/** Claude's reply without its ask block, and the question in it. */
export function splitAsk(text: string): { text: string; question?: Question } {
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
