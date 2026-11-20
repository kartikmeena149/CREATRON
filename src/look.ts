// The AI looking at its own edit: the moments a change touched (or ones it asked to see), rendered
// as frames by the export itself, so what it sees is exactly what the user will get. The chat
// shows them to the AI after each change, and it fixes whatever looks wrong.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { render } from "./render.ts";
import type { Scene } from "./scene.ts";
import { sceneClips } from "./sceneClips.ts";
import type { Analysis, EditPlan } from "./schema.ts";
import { buildCues, clipLength, clipStarts, editDuration } from "./timeline.ts";
import { cutEffectStart } from "./effectTiming.ts";

export type Moment = { t: number; what: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (t: number) => `${t.toFixed(2)}s`;

/**
 * The moments worth looking at after a change from `before` to `after`: where a new or changed
 * clip, title, effect, transition, B-roll or caption style shows. At most `max`, a little apart.
 */
export function changedMoments(before: EditPlan, after: EditPlan, analysis: Analysis, max = 6): Moment[] {
  const out: Moment[] = [];
  const add = (t: number, what: string) => out.push({ t, what });
  // Main-track clips: a new or changed one, and the cut into it when it has a transition.
  const starts = clipStarts(after);
  after.segments.forEach((s, i) => {
    const old = before.segments.find((o) => o.start === s.start && o.end === s.end);
    if (old && same(old, s)) return;
    if (s.transition && !same(old?.transition, s.transition)) add(starts[i], `${s.transition.type} transition into clip ${i + 1}`);
    else add(starts[i] + Math.min(0.6, clipLength(s) / 2), `clip ${i + 1}${old ? " (changed)" : ""}`);
  });
  if (!same(before.transform, after.transform) || before.aspect !== after.aspect) {
    const d = editDuration(after);
    add(d * 0.25, "the framing"), add(d * 0.6, "the framing");
  }
  // Titles, effects and Claude edits on the text tracks.
  for (const m of after.motion) {
    const old = before.motion.find((o) => o.id === m.id);
    if (old && same(old, m)) continue;
    if (m.template === "scene") {
      for (const t of sceneMoments(old, m)) add(t.t, t.what);
      continue;
    }
    const mid = m.template === "effect" ? m.at + m.duration * 0.35 : m.at + Math.min(0.8, m.duration / 2);
    add(mid, `${m.template === "effect" ? `${m.effect} effect` : `${m.template} "${m.text}"`}${old ? " (changed)" : ""}`);
  }
  for (const c of after.cutEffects ?? []) {
    const old = (before.cutEffects ?? []).find((o) => o.id === c.id);
    if (old && same(old, c)) continue;
    add(cutEffectStart(c.effect, c.at, c.duration) + c.duration * 0.3, `${c.effect} on the cut at ${fmt(c.at)}`);
  }
  for (const b of after.broll) {
    const old = before.broll.find((o) => o.id === b.id);
    if (old && same(old, b)) continue;
    add(b.at + b.duration / 2, `B-roll "${b.query ?? b.source}"${old ? " (changed)" : ""}`);
  }
  // Captions: their style or words changed, two of them.
  if (!same({ ...before.captions }, { ...after.captions }) && after.captions.enabled) {
    const cues = buildCues(after, analysis.words);
    for (const c of [cues[0], cues[Math.floor(cues.length / 2)]].filter(Boolean)) add((c.start + c.end) / 2, `caption "${c.text}"`);
  }
  // A little apart, inside the edit, in time order.
  const end = editDuration(after) - 0.05;
  const picked: Moment[] = [];
  for (const m of out.map((m) => ({ ...m, t: Math.max(0, Math.min(end, m.t)) })).sort((a, b) => a.t - b.t))
    if (!picked.some((p) => Math.abs(p.t - m.t) < 0.4)) picked.push(m);
  // Too many: spread across them.
  if (picked.length <= max) return picked;
  return Array.from({ length: max }, (_, k) => picked[Math.round((k * (picked.length - 1)) / (max - 1))]);
}

/** Moments inside a Claude edit whose clips were changed: each changed clip, mid-way. */
function sceneMoments(old: EditPlan["motion"][number] | undefined, m: EditPlan["motion"][number]): Moment[] {
  let scene: Scene | undefined;
  try {
    scene = m.scene ? (JSON.parse(readFileSync(m.scene, "utf8")) as Scene) : undefined;
  } catch {}
  if (!scene) return [{ t: m.at + 1, what: "the Claude edit" }];
  const changed = new Set(Object.keys({ ...old?.layers, ...m.layers }).filter((k) => !same(old?.layers?.[k], m.layers?.[k])));
  const at = (t: number) => m.at - (m.offset ?? 0) + t;
  return sceneClips(scene, m.layers)
    .filter((c) => changed.has(`clip:${c.id}`) || [...c.members, ...c.textLayers, ...c.videos, ...c.parts].some((id) => changed.has(id)))
    .map((c) => ({ t: at((c.start + c.end) / 2), what: `${c.kind} "${c.name}" in the Claude edit` }));
}

/** Moments the AI asked to see in look.json ({"times": [seconds, …]}), read once. */
export function requestedMoments(dir: string, plan: EditPlan): Moment[] {
  const file = join(dir, "look.json");
  if (!existsSync(file)) return [];
  try {
    const { times } = JSON.parse(readFileSync(file, "utf8")) as { times?: unknown };
    const end = editDuration(plan) - 0.05;
    return (Array.isArray(times) ? times : []).filter((t): t is number => typeof t === "number" && Number.isFinite(t))
      .slice(0, 6).map((t) => ({ t: Math.max(0, Math.min(end, t)), what: "you asked to see this" }));
  } catch {
    return [];
  } finally {
    rmSync(file, { force: true });
  }
}

/**
 * Frames of the edited video at `moments`, drawn by the export (everything in them: footage,
 * framing, B-roll, titles, captions, effects, Claude edits), saved as look/frame-NN.png in `dir`.
 * Returns each file (relative to dir) with what it shows.
 */
export async function lookFrames(dir: string, analysis: Analysis, plan: EditPlan, moments: Moment[]): Promise<{ file: string; t: number; what: string }[]> {
  const folder = join(dir, "look");
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const sorted = [...moments].sort((a, b) => a.t - b.t);
  await render(plan, analysis, join(folder, "frame-%02d.png"), () => {}, undefined, {
    resolution: 720, fps: analysis.fps > 0 ? (analysis.fps > 45 ? 60 : analysis.fps > 27 ? 30 : 24) : 30, quality: "small", codec: "h264", mp3: false,
    stills: sorted.map((m) => m.t),
  });
  const files = readdirSync(folder).filter((f) => /^frame-\d+\.png$/.test(f)).sort();
  return files.map((f, i) => ({ file: join("look", f), t: sorted[i]?.t ?? 0, what: sorted[i]?.what ?? "" }));
}
