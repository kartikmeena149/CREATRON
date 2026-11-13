// Which AI models the editor can use: your connected plans (Claude, ChatGPT) first, then
// OpenRouter's tool-capable models when there is a key, free ones first without credits. Cached for an hour so the picker opens instantly.
import { claudeAvailable } from "./claudecli.ts";
import { agentState, enabled } from "./agents.ts";
import { DEFAULT_MODEL } from "./plan.ts";

export type ModelInfo = { id: string; name: string; free: boolean; inPerM: number; outPerM: number };
export type ModelList = { models: ModelInfo[]; credits: number | null; recommended: string };

// Paid models worth offering, best first. Others are reachable by id via CREATRON_MODEL.
const PAID = ["anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-haiku-5.5", "google/gemini-3-flash-preview"];
// Free models that handled edit plans well in testing come first; small or gated ones are left out.
const FREE_PREFERRED = [
  "nvidia/nemotron-3.5-super-vl:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "google/gemma-4-26b-a4b-it:free",
];

let cache: { at: number; models: ModelInfo[] } | undefined;

export async function listModels(key = process.env.OPENROUTER_API_KEY): Promise<ModelList> {
  // OpenRouter's models are offered only with an OpenRouter key; without one they can't run.
  if (key && (!cache || Date.now() - cache.at > 3600_000)) cache = { at: Date.now(), models: await fetchModels().catch(() => cache?.models ?? []) };
  const router = key ? (cache?.models ?? []) : [];
  // Your own plans, connected on the Dashboard: listed first, they need no OpenRouter credits.
  const on = enabled();
  const claude: ModelInfo[] = on.claude && claudeAvailable()
    ? [
        { id: "claude-code/sonnet", name: "Claude Sonnet (your subscription)", free: true, inPerM: 0, outPerM: 0 },
        { id: "claude-code/opus", name: "Claude Opus (your subscription)", free: true, inPerM: 0, outPerM: 0 },
      ]
    : [];
  const codex: ModelInfo[] = on.codex && agentState("codex").installed
    ? [{ id: "codex/default", name: "ChatGPT (your subscription, via Codex)", free: true, inPerM: 0, outPerM: 0 }]
    : [];
  const models = [...claude, ...codex, ...router];
  const c = await credits(key);
  // A plan you connected comes first (Claude, then ChatGPT): that's what the connectors are for.
  // Only with no plan: OpenRouter, on the best free model when there are no credits.
  const plan = claude[0] ?? codex[0];
  const recommended = plan ? plan.id : c !== null && c <= 0 ? (router.find((m) => m.free)?.id ?? DEFAULT_MODEL) : DEFAULT_MODEL;
  return { models, credits: c, recommended };
}

async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`couldn't load the model list (${res.status})`);
  const all = ((await res.json()) as any).data as any[];
  const byId = new Map(all.filter((m) => m.supported_parameters?.includes("tools")).map((m) => [m.id as string, m]));
  const info = (id: string): ModelInfo | undefined => {
    const m = byId.get(id);
    if (!m) return undefined;
    return {
      id,
      name: String(m.name).replace(/^[^:]+:\s*/, ""), // "NVIDIA: Nemotron ..." -> "Nemotron ..."
      free: id.endsWith(":free"),
      inPerM: Number(m.pricing?.prompt ?? 0) * 1e6,
      outPerM: Number(m.pricing?.completion ?? 0) * 1e6,
    };
  };
  return [...FREE_PREFERRED, ...PAID].map(info).filter((m): m is ModelInfo => Boolean(m));
}

/** Remaining OpenRouter credit in dollars, or null if it can't be read (no key, offline). */
async function credits(key?: string): Promise<number | null> {
  if (!key) return null;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/credits", { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const d = ((await r.json()) as any).data;
    return Number(d.total_credits) - Number(d.total_usage);
  } catch {
    return null;
  }
}

/** Other free models to try, in order, when a free model is busy. */
export const freeFallbacks = (model: string, list: ModelInfo[]) =>
  list.filter((m) => m.free && m.id !== model && !m.id.startsWith("claude-code/")).map((m) => m.id); // Claude only when picked
