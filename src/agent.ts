// The agent mode: instead of filling in a fixed form, Claude edits the project like a person at
// a keyboard. It gets a folder (work/<video>/agent) with the edit as plan.json, the transcript,
// a guide, and custom/ for Remotion animations it writes itself. It may only use file tools in
// that folder (no commands, no internet). Creatron then checks the work, sends back problems, and
// shows Claude real frames of its animations over the video so it can fix what looks wrong.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { agentDir, compileCustom, customDir, customFiles } from "./customcode.ts";
import { outputSize } from "./frame.ts";
import { hasOverlay, overlayProps } from "./motion.ts";
import { type Focus, type Marker, describe, describeFocus, keepsUnpicked, placeBroll, unknownAudio, useAttachments } from "./plan.ts";
import { renderOverlayStill } from "./remotion.ts";
import { type Analysis, EditPlan, checkPlan } from "./schema.ts";
import { outputDuration, toSourceTime } from "./timeline.ts";
import { run } from "./tools.ts";

export type AgentResult = { plan: EditPlan; notes: string; model: string };

/** One request in agent mode. model is "claude-code/<sonnet|opus>". */
export async function runAgent(
  analysis: Analysis,
  request: string,
  current: EditPlan,
  model: string,
  log: (m: string) => void,
  focus?: Focus,
): Promise<AgentResult> {
  const dir = agentDir(analysis.source);
  prepare(dir, analysis, current);
  const claudeModel = model.replace(/^claude-code\//, "");

  const pictures = focus?.markers?.length ? await markerFrames(dir, analysis, current, focus.markers) : [];
  log(`Claude (${claudeModel}) is editing`);
  let turn = await claude(dir, claudeModel, [
    `REQUEST: ${request}`,
    focus ? describeFocus(current, focus) : "",
    pictures.length ? `\nWhat the user is pointing at (Read each image; the red box is the spot they clicked):\n${pictures.join("\n")}` : "",
    "",
    "Read CREATRON.md first, then video.md and plan.json, and make the change.",
  ].join("\n"));

  // Check, and let Claude fix what's wrong: twice for problems, once after looking at its frames.
  let looked = false;
  for (let fixes = 0; ; ) {
    log("checking Claude's work");
    const { plan, problems } = await check(dir, analysis, current, focus);
    if (problems.length) {
      if (++fixes > 2) throw new Error(`Claude's edit still has problems:\n${problems.join("\n")}`);
      log(`Claude is fixing ${problems.length} problem${problems.length > 1 ? "s" : ""}`);
      turn = await claude(dir, claudeModel, `Creatron checked your work and found problems. Fix them:\n- ${problems.join("\n- ")}`, turn.session);
      continue;
    }
    const custom = plan!.motion.filter((m) => m.template === "custom");
    if (looked || !custom.length) return { plan: plan!, notes: turn.text, model };
    looked = true;
    log("rendering frames for Claude to check");
    const frames = await reviewFrames(dir, analysis, plan!);
    log("Claude is checking its animations");
    turn = await claude(
      dir,
      claudeModel,
      [
        "Here is how your animations look over the video (Read each image):",
        ...frames.map((f) => `- ${f.file} (${f.what})`),
        "If anything is wrong (cut off, hard to read, in the wrong place, clashing with captions, not what the user asked), fix it.",
        "Then reply again with your one or two sentences for the user.",
      ].join("\n"),
      turn.session,
    );
  }
}

/** Writes the folder Claude works in: guide, video description, schema, and the current edit. */
function prepare(dir: string, analysis: Analysis, current: EditPlan) {
  mkdirSync(join(dir, "custom"), { recursive: true });
  rmSync(join(dir, "checks"), { recursive: true, force: true });
  mkdirSync(join(dir, "checks"), { recursive: true });
  const size = outputSize(current, analysis);
  writeFileSync(join(dir, "CREATRON.md"), GUIDE);
  writeFileSync(join(dir, "plan.schema.json"), JSON.stringify(z.toJSONSchema(EditPlan, { io: "input" }), null, 1));
  writeFileSync(join(dir, "plan.json"), JSON.stringify(current, null, 2));
  writeFileSync(
    join(dir, "video.md"),
    [
      `# The video`,
      `Edited output: ${size.width}x${size.height} px, ${analysis.fps} fps, ${outputDuration(current).toFixed(2)} s long.`,
      `Custom animations already in custom/: ${customFiles(customDir(analysis.source)).map((f) => f.name).join(", ") || "none"}`,
      "",
      describe(analysis),
    ].join("\n"),
  );
}

/** Reads plan.json back and checks everything Creatron can check. */
async function check(dir: string, analysis: Analysis, current: EditPlan, focus?: Focus): Promise<{ plan?: EditPlan; problems: string[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
  } catch (e) {
    return { problems: [`plan.json is not valid JSON: ${e instanceof Error ? e.message : e}`] };
  }
  const parsed = EditPlan.safeParse(raw);
  if (!parsed.success) return { problems: [`plan.json doesn't match plan.schema.json:\n${z.prettifyError(parsed.error)}`] };
  const plan = useAttachments(placeBroll(parsed.data, new Map()), focus);
  const problems = [...checkPlan(plan, analysis), ...unknownAudio(plan, current, focus)];
  if (focus?.clips.length) problems.push(...keepsUnpicked(current, plan, focus.clips).problems);
  // B-roll already on the timeline, or a video the user attached to this request.
  const known = new Set([...current.broll.map((b) => b.source), ...(focus?.attachments ?? []).filter((a) => a.kind === "video").map((a) => `library:${a.path}`)]);
  for (const b of plan.broll) if (!known.has(b.source)) problems.push(`broll ${b.source}: new B-roll can't be added in this mode yet; remove it`);
  const custom = plan.motion.filter((m) => m.template === "custom");
  if (custom.length) {
    const compiled = await compileCustom(customDir(analysis.source));
    problems.push(...compiled.errors);
    for (const m of custom) {
      if (!m.component) problems.push(`motion ${m.id}: a custom item needs "component"`);
      else if (!compiled.code[m.component] && !compiled.errors.some((e) => e.startsWith(`${m.component}.tsx`)))
        problems.push(`motion ${m.id}: there is no custom/${m.component}.tsx`);
    }
  }
  return { plan, problems };
}

/** The edited frame at each marker (video, plus animations when there are any) with a red box where the user clicked. */
async function markerFrames(dir: string, analysis: Analysis, plan: EditPlan, markers: Marker[]): Promise<string[]> {
  const size = outputSize(plan, analysis);
  const fps = analysis.fps;
  const props = overlayProps(plan, analysis.words, size, fps);
  const overlay = hasOverlay(plan, analysis.words);
  rmSync(join(dir, "markers"), { recursive: true, force: true });
  mkdirSync(join(dir, "markers"), { recursive: true });
  const out: string[] = [];
  for (const m of markers) {
    const t = Math.min(m.time, outputDuration(plan) - 0.05);
    const file = join("markers", `marker-${m.n}.png`);
    const layer = join(dir, "markers", `layer-${m.n}.png`);
    if (overlay) await renderOverlayStill(props, Math.round(t * fps), layer, customDir(analysis.source));
    const box = Math.round(Math.min(size.width, size.height) * 0.14);
    const bx = Math.round(m.x * size.width - box / 2);
    const by = Math.round(m.y * size.height - box / 2);
    const base = `[0:v]scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height}`;
    await run("ffmpeg", [
      "-y", "-v", "error", "-ss", toSourceTime(plan, t).toFixed(3), "-i", analysis.source, ...(overlay ? ["-i", layer] : []),
      "-filter_complex",
      `${base}[v];${overlay ? "[v][1:v]overlay[v2];[v2]" : "[v]"}drawbox=x=${bx}:y=${by}:w=${box}:h=${box}:color=red@0.95:t=${Math.max(4, Math.round(box / 18))},scale=-2:'min(960,ih)'`,
      "-frames:v", "1", join(dir, file),
    ]);
    rmSync(layer, { force: true });
    out.push(`- #${m.n}: ${file}`);
  }
  return out;
}

/** Two frames of each custom animation (up to 3), drawn over the real video frame, saved in checks/. */
async function reviewFrames(dir: string, analysis: Analysis, plan: EditPlan) {
  const size = outputSize(plan, analysis);
  const fps = analysis.fps;
  const props = overlayProps(plan, analysis.words, size, fps);
  const out: { file: string; what: string }[] = [];
  for (const m of plan.motion.filter((x) => x.template === "custom").slice(0, 3)) {
    for (const k of [0.3, 0.7]) {
      const t = Math.min(m.at + m.duration * k, outputDuration(plan) - 0.05);
      const layer = join(dir, "checks", `${m.id}-${k}-layer.png`);
      const file = join("checks", `${m.id}-${Math.round(k * 100)}.png`);
      await renderOverlayStill(props, Math.round(t * fps), layer, customDir(analysis.source));
      await run("ffmpeg", [
        "-y", "-v", "error", "-ss", toSourceTime(plan, t).toFixed(3), "-i", analysis.source, "-i", layer,
        "-filter_complex", `[0:v]scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height}[v];[v][1:v]overlay,scale=-2:'min(960,ih)'`,
        "-frames:v", "1", join(dir, file),
      ]);
      rmSync(layer, { force: true });
      out.push({ file, what: `${m.component} at ${t.toFixed(1)} s, ${Math.round(k * 100)}% through it` });
    }
  }
  return out;
}

/** One claude -p turn in the agent folder: file tools only, confined to it. */
function claude(dir: string, model: string, prompt: string, session?: string): Promise<{ text: string; session: string }> {
  // A clean environment: no API key (that would bill the API instead of the plan) and none of a
  // parent Claude session's settings.
  const env = { HOME: homedir(), USER: process.env.USER ?? "", PATH: process.env.PATH ?? "", LANG: process.env.LANG ?? "en_US.UTF-8", TMPDIR: tmpdir() };
  const args = [
    "-p", "--model", model, "--output-format", "json",
    "--restricted", "--tools", "Read,Write,Edit,Glob,Grep", "--permission-mode", "acceptEdits",
    "--strict-mcp-config", "--setting-sources", "project", "--disable-slash-commands",
    ...(session ? ["--resume", session] : []),
  ];
  return new Promise((ok, fail) => {
    const child = spawn("claude", args, { env, cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => fail(new Error(`could not start claude: ${e.message}`)));
    child.on("close", () => {
      let out: any;
      try {
        out = JSON.parse(stdout);
      } catch {
        return fail(new Error(`Claude error: ${(stderr || stdout).trim().slice(0, 300)}`));
      }
      if (out.is_error) return fail(new Error(`Claude ${out.api_error_status ?? "error"}: ${out.result ?? "unknown error"}`));
      ok({ text: String(out.result ?? "").trim(), session: out.session_id });
    });
    child.stdin.end(prompt);
  });
}

const GUIDE = `# Editing a video in Creatron

You are the editor. You can change anything about this edit by editing plan.json, and you can
write new Remotion animations. You only have file tools, in this folder.

## Files
- video.md: the edited video's size, fps and length, the transcript as timed phrases (SOURCE seconds) and pauses.
- plan.json: the current edit. Change it to do what the user asked and keep everything else as it is.
  It must stay valid JSON matching plan.schema.json (read the schema's descriptions).
- custom/: your Remotion animations. One component per file, custom/<Name>.tsx with a PascalCase name and a
  default export. Helpers can go in custom/lib/. Existing files belong to earlier edits: change them only if asked.

## Times
- segments, captions.cues and atSource use SOURCE seconds (the original recording).
- motion[].at / duration and broll at / duration use OUTPUT seconds (the edited video, after cuts and speed).
  For motion items you can set "atSource" (a transcript second) instead of "at"; Creatron converts it.

## Built in (no code needed)
captions (style, size, colour, position, animation none / pop / highlight / word), motion templates "title" and
"lower-third", per-segment speed / zoom / volume, transform (scale, x, y, rotate), aspect, audio cleanup.
New B-roll can't be searched for in this mode (keep existing broll entries as they are). Files the user attached
to the request are the exception: add those exactly as the request's ATTACHED FILES section says.

## Custom animations (Remotion)
Anything the built-in options can't do: animated text in any style, shapes, icons drawn with SVG, emoji pops,
progress bars, highlights, arrows, counters, transitions-like wipes, subscribe buttons, kinetic typography...
1. Write custom/<Name>.tsx.
2. Add to plan.json "motion": {"id": "<unique>", "template": "custom", "component": "<Name>",
   "at": <output s> (or "atSource"), "duration": <s>, "props": {...}, "text": "...", "color": "#rrggbb"}.

The component gets: everything in "props", plus text, subtext, color, width and height (the output frame in px)
and durationInFrames. useCurrentFrame() is 0 when the item starts; useVideoConfig().fps gives the frame rate.
It's drawn on a TRANSPARENT layer above the video and captions: don't paint a full-frame background unless asked.
Size everything from width / height so it works at any resolution. Keep text inside the frame with some margin.

Rules for the code:
- Import only from "react" and "remotion" (and your own files in custom/). No other packages, no network, no files,
  no CSS imports. Use inline styles.
- Fonts: system fonts only, e.g. "Helvetica Neue", "Avenir Next", "Futura", "Gill Sans", "Georgia", "Impact",
  "Arial Black", "Menlo", "Snell Roundhand", "Marker Felt", "Chalkboard SE".
- Animate with interpolate (pass extrapolateLeft / extrapolateRight: "clamp"), spring and Easing from "remotion".
- Deterministic: no Math.random() or Date (use random() from "remotion" with a seed if needed).

Example, custom/PopWord.tsx:
\`\`\`tsx
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export default function PopWord({ text, color, width, height, durationInFrames }: { text: string; color: string; width: number; height: number; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12 } });
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: height * 0.3, textAlign: "center", opacity: out, transform: \`scale(\${pop})\` }}>
      <span style={{ fontFamily: "Impact", fontSize: width * 0.14, color, textShadow: "0 6px 0 #000" }}>{text}</span>
    </div>
  );
}
\`\`\`

## When you're done
Reply with one or two plain sentences for the user saying what you changed (no code, no file names).
Creatron then checks your work (the JSON, that the code compiles, the edit fits the video) and may send you
problems to fix or frames of your animations to look at.
`;
