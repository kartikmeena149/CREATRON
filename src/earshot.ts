// Designed sound effects from earshot's bank (Kartik's sound tool, on this Mac): whooshes, impacts,
// risers, pops, clicks, shutters, dings… each rendered to the length it needs, with its loudest moment
// measured, so the edit can put that moment exactly on the word or cut it punches. Renders are kept
// in work/sfx/earshot and reused.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { find } from "./toolchain.ts";
import { ROOT, run } from "./tools.ts";
import type { EditPlan } from "./schema.ts";

/** earshot's Python, through the toolchain wall. */
const python = () => find("earshot")?.cmd ?? "";
const DIR = join(ROOT, "work", "sfx", "earshot");

export const earshotAvailable = () => Boolean(find("earshot"));

export type Knobs = { dur?: number; apex?: number; pitch?: string };
export type Rendered = { file: string; length: number; peak: number; onset: number };

/** "whoosh_fast/crisp?dur=0.8&apex=0.6" → the id and its knobs. */
export function parseSound(spec: string): { id: string; knobs: Knobs } {
  const [id, query = ""] = spec.trim().split("?");
  const q = new URLSearchParams(query);
  const num = (k: string) => (q.has(k) && Number.isFinite(Number(q.get(k))) && Number(q.get(k)) > 0 ? Number(q.get(k)) : undefined);
  return { id: id.trim(), knobs: { dur: num("dur"), apex: num("apex"), pitch: q.get("pitch") || undefined } };
}

/** Renders one bank sound (or reuses the earlier render of the same sound and knobs). */
export async function renderSound(id: string, knobs: Knobs = {}): Promise<Rendered> {
  if (!earshotAvailable()) throw new Error("earshot isn't installed on this Mac");
  mkdirSync(DIR, { recursive: true });
  const name = [id.replace(/\//g, "_"), knobs.dur && `d${knobs.dur}`, knobs.apex && `a${knobs.apex}`, knobs.pitch && `p${knobs.pitch}`].filter(Boolean).join("-");
  const file = join(DIR, `${name}.wav`);
  const meta = join(DIR, `${name}.json`);
  if (existsSync(file) && existsSync(meta)) return JSON.parse(readFileSync(meta, "utf8"));
  const args = ["-m", "earshot", "sfx", "render", id, "-o", file, "--json", "--threads", "2"];
  if (knobs.dur) args.push("--dur", String(knobs.dur));
  if (knobs.apex) args.push("--apex", String(knobs.apex));
  if (knobs.pitch) args.push("--pitch", knobs.pitch);
  const { stdout } = await run(python(), args).catch((e) => {
    throw new Error(`earshot couldn't render ${id}: ${String(e.message ?? e).split("\n").slice(-2).join(" ")}`);
  });
  const m = JSON.parse(stdout).meta;
  const out: Rendered = { file, length: m.dur_s, peak: m.peak_s, onset: m.onset_s };
  writeFileSync(meta, JSON.stringify(out));
  return out;
}

/**
 * Sounds the agent picked from the bank ("file": "earshot:impact/deep?dur=1.2"). For these, "at" is
 * when the sound HITS: each is rendered, then moved so its loudest moment lands exactly there.
 * Up to 4 render at once. Ones that fail are left out (named in `missing`).
 */
export async function resolveEarshot(
  plan: EditPlan,
  step: (id: string, what: string, done: boolean, found: boolean) => void,
): Promise<{ plan: EditPlan; missing: string[] }> {
  // A bank id written as "sfx:" (like "sfx:pro_pop_in/round") is a bank sound too.
  const asked = plan.voiceovers.flatMap((v, i) =>
    v.file.startsWith("earshot:") ? [{ i, v, spec: v.file.slice(8) }]
    : /^sfx:\s*[a-z_]+\/[a-z0-9_.]+(\?.*)?$/.test(v.file) ? [{ i, v, spec: v.file.slice(4).trim() }]
    : [],
  );
  if (!asked.length) return { plan, missing: [] };
  const got = new Map<number, Rendered | undefined>();
  const queue = [...asked];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const { id, knobs } = parseSound(a.spec);
        const sid = `earshot-${a.i}`;
        step(sid, id, false, false);
        // A knob the sound doesn't have (pitch on an unpitched pop) fails the render: then without it.
        const r = await renderSound(id, knobs)
          .catch(() => renderSound(id, { dur: knobs.dur, apex: knobs.apex }))
          .catch(() => renderSound(id))
          .catch(() => undefined);
        step(sid, id, true, Boolean(r));
        got.set(a.i, r);
      }
    }),
  );
  const missing = asked.filter((a) => !got.get(a.i)).map((a) => parseSound(a.spec).id);
  const voiceovers = plan.voiceovers.flatMap((v, i) => {
    if (!got.has(i)) return [v];
    const r = got.get(i);
    if (!r) return [];
    // The hit on the beat: the sound starts its peak-time earlier (clipped at the video's start).
    const at = Math.max(0, v.at - r.peak);
    const offset = Math.max(0, r.peak - v.at);
    return [{ ...v, kind: "sfx" as const, file: r.file, text: v.text || parseSound(v.file.replace(/^(earshot|sfx):\s*/, "")).id, at: Math.round(at * 1000) / 1000, offset, length: r.length, duration: Math.max(0.05, r.length - offset) }];
  });
  return { plan: { ...plan, voiceovers }, missing };
}
