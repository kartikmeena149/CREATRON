// Which AI model edits: one choice for the whole app (the Home box and the chat show the same one),
// remembered on this Mac. Until you pick, it is your own connected plan: Claude first, then
// ChatGPT, and an OpenRouter model only when no plan is connected.
import { create } from "zustand";
import type { ModelInfo } from "./env.d.ts";

type Models = { models: ModelInfo[]; credits: number | null; recommended: string };

let modelsOnce: Promise<Models | undefined> | undefined;
export const loadModels = () =>
  (modelsOnce ??= window.creatron.models().then((r) => (r.ok ? r.value : ((modelsOnce = undefined), undefined))));

// "creatro.model": a fresh key, so a pick made before your plans could be connected doesn't stick.
const KEY = "creatro.model";
const stored = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

const useChoice = create<{ model: string; data?: Models }>(() => ({ model: stored() }));

/** Loads the list again (after connecting or switching off an account) and keeps the choice valid. */
async function refresh() {
  const data = await loadModels();
  if (!data) return;
  const { model } = useChoice.getState();
  // Nothing picked yet, or the picked model is gone (its account was disconnected): your best one.
  const keep = model && data.models.some((m) => m.id === model);
  useChoice.setState({ data, model: keep ? model : data.recommended });
}
window.addEventListener("creatron:models", () => ((modelsOnce = undefined), void refresh()));
void refresh();

/** The chosen model and how to change it (shared by every place that shows it). */
export function useModelChoice(): [string, (id: string) => void] {
  const model = useChoice((s) => s.model);
  const choose = (id: string) => {
    useChoice.setState({ model: id });
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  };
  return [model, choose];
}

const isPlan = (m: ModelInfo) => m.id.startsWith("claude-code/") || m.id.startsWith("codex/");

export function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const data = useChoice((s) => s.data);
  const price = (m: ModelInfo) => (m.free ? "free" : `$${+m.inPerM.toFixed(2)} / $${+m.outPerM.toFixed(2)} per M`);
  const current = data?.models.find((m) => m.id === value);
  const plans = data?.models.filter(isPlan) ?? [];
  const free = data?.models.filter((m) => !isPlan(m) && m.free) ?? [];
  const paid = data?.models.filter((m) => !m.free) ?? [];
  return (
    <div className="model-picker">
      <select value={value} onChange={(e) => onChange(e.target.value)} title={current ? (isPlan(current) ? current.name : `${current.name}: ${price(current)}`) : value}>
        {!data && <option value={value}>{value.split("/").pop() || "Loading…"}</option>}
        {data && (
          <>
            {plans.length > 0 && (
              <optgroup label="Your plans (connected)">
                {plans.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </optgroup>
            )}
            {free.length > 0 && (
              <optgroup label="OpenRouter · free">
                {free.map((m) => <option key={m.id} value={m.id}>{m.name.replace(" (free)", "")} · free</option>)}
              </optgroup>
            )}
            {paid.length > 0 && (
              <optgroup label={data.credits !== null && data.credits <= 0 ? "OpenRouter · paid (needs credits)" : "OpenRouter · paid"}>
                {paid.map((m) => <option key={m.id} value={m.id}>{m.name} · {price(m)}</option>)}
              </optgroup>
            )}
          </>
        )}
      </select>
      {current && !isPlan(current) && data?.credits !== null && data?.credits !== undefined && (
        <span className={`credits ${data.credits <= 0 ? "empty" : ""}`} title="OpenRouter balance">${data.credits.toFixed(2)}</span>
      )}
    </div>
  );
}
