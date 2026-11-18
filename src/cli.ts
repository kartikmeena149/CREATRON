#!/usr/bin/env node
// creatron: chat-to-edit video from the terminal.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { analyze } from "./analyze.ts";
import { outputDuration } from "./timeline.ts";
import { DEFAULT_MODEL, describe, makePlan } from "./plan.ts";
import { projectName, scaffoldProject } from "./project.ts";
import { render } from "./render.ts";
import { EditPlan } from "./schema.ts";
import { snapEdges } from "./snap.ts";
import { fetchBroll, searchStock, stockAvailable } from "./stock.ts";
import { health, healthReport } from "./toolchain.ts";
import { ROOT } from "./tools.ts";

const USAGE = `creatron - edit video by describing what you want

  creatron edit <video> "<request>" [-o out.mp4] [-m model]   analyze, plan with AI, render
  creatron analyze <video>                                   transcript + pauses (local only)
  creatron plan <video> "<request>" [-m model]               write an edit plan, no render
  creatron render <video> <plan.json> [-o out.mp4]           render a plan you wrote or tweaked
  creatron prompt <video>                                    show exactly what text the AI would see
  creatron doctor                                            which tools work now, and what each job will use
  creatron project new <Name> <footage> [-o folder]          an open, editable project (default ~/Movies/Creatron/<Name>)
  creatron project render <folder> [draft]                   re-export it -> <folder>/Export/<Name>.mp4
  creatron project check <folder>                            is it still hand-editable? + loudness and frames
  creatron project still <folder> <seconds> <name>           one frame -> <folder>/notes/checks/<name>.png
  creatron project cut <folder> <keep.json>                  set the cuts (and captions) from a list of ranges
  creatron project cutout <folder>                           the speaker without background -> assets/cutouts/

Default model: ${DEFAULT_MODEL} (any OpenRouter model id works). Needs OPENROUTER_API_KEY in .env.`;

const envFile = join(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", short: "o" }, model: { type: "string", short: "m" }, help: { type: "boolean", short: "h" } },
});
const [command, video, third] = positionals;

const defaultOut = (v: string) => resolve(`${basename(v, extname(v))}-creatron.mp4`);
const need = (value: string | undefined, what: string) => {
  if (!value) fail(`missing ${what}\n\n${USAGE}`);
  return value!;
};
function fail(message: string): never {
  console.error(`creatron: ${message}`);
  process.exit(1);
}

try {
  if (values.help || !command) console.log(USAGE);
  else if (command === "doctor") console.log(healthReport(health(true)));
  else if (command === "project") {
    const [, sub, a, b, c] = positionals;
    if (sub === "new") {
      const footage = resolve(need(b, "footage"));
      const name = projectName(need(a, "project name"));
      const dir = resolve(values.out ?? join(homedir(), "Movies", "Creatron", name));
      if (existsSync(join(dir, "project", "timeline.json"))) fail(`${dir} is already a project`);
      // The health check comes first: a broken tool is said in one line and the backup is used.
      for (const h of health(true)) if (!h.ok || h.backup) console.error(`tools: ${h.tool} ${h.ok ? h.note : "isn't working"}`);
      const t = scaffoldProject(dir, { name, video: footage, analysis: await analyze(footage) });
      console.log(`project made: ${dir}\n${t.cuts.length} cut, ${t.captions.length} captions. Edit project/timeline.json, then: creatron project render "${dir}"`);
    } else if (["render", "check", "still", "cut", "cutout", "tools"].includes(sub ?? "")) {
      // The project tool belt does the work, on that folder only.
      const dir = resolve(need(a, "project folder"));
      const r = spawnSync(process.execPath, [join(ROOT, "src", "autoedit-tools.ts"), sub!, ...[b, c].filter((x): x is string => Boolean(x))], {
        stdio: "inherit",
        env: { ...process.env, CREATRON_AUTOEDIT_DIR: dir, CREATRON_ROOT: ROOT },
      });
      process.exitCode = r.status ?? 1;
    } else fail(`unknown project command "${sub ?? ""}"\n\n${USAGE}`);
  }
  else if (command === "analyze") {
    const a = await analyze(need(video, "video"));
    console.log(`${a.words.length} words, ${a.silences.length} pauses, ${a.duration}s. Saved next to the cache.`);
  } else if (command === "prompt") {
    console.log(describe(await analyze(need(video, "video"))));
  } else if (command === "plan" || command === "edit") {
    const a = await analyze(need(video, "video"));
    const result = await makePlan(a, need(third, "request"), values.model, console.error, undefined, stockAvailable() ? searchStock : undefined);
    result.plan = await fetchBroll(snapEdges(result.plan, a), result.clips, console.error);
    const planFile = resolve(`${basename(video, extname(video))}.plan.json`);
    writeFileSync(planFile, JSON.stringify(result.plan, null, 2) + "\n");
    const cost = result.cost ? `, $${result.cost.toFixed(4)}` : "";
    console.error(`plan: ${result.inputTokens} in / ${result.outputTokens} out tokens${cost}`);
    console.error(`plan: ${result.plan.segments.length} segments, ${a.duration.toFixed(1)}s -> ${outputDuration(result.plan).toFixed(1)}s`);
    if (result.plan.notes) console.log(`\n${result.plan.notes}\n`);
    console.log(`plan saved: ${planFile}`);
    if (command === "edit") console.log(`video saved: ${await render(result.plan, a, values.out ?? defaultOut(video))}`);
  } else if (command === "render") {
    const a = await analyze(need(video, "video"));
    const plan = EditPlan.parse(JSON.parse(readFileSync(need(third, "plan.json"), "utf8")));
    console.log(`video saved: ${await render(plan, a, values.out ?? defaultOut(video))}`);
  } else fail(`unknown command "${command}"\n\n${USAGE}`);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

// An export leaves Remotion's headless browser open, which would keep the command running after
// it's done: once everything is written out, the command ends.
process.stdout.write("", () => process.exit(process.exitCode ?? 0));
