#!/usr/bin/env node
// creatron: chat-to-edit video from the terminal.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { analyze } from "./analyze.ts";
import { outputDuration } from "./timeline.ts";
import { DEFAULT_MODEL, describe, makePlan } from "./plan.ts";
import { render } from "./render.ts";
import { EditPlan } from "./schema.ts";
import { snapEdges } from "./snap.ts";
import { ROOT } from "./tools.ts";

const USAGE = `creatron - edit video by describing what you want

  creatron edit <video> "<request>" [-o out.mp4] [-m model]   analyze, plan with AI, render
  creatron analyze <video>                                   transcript + pauses (local only)
  creatron plan <video> "<request>" [-m model]               write an edit plan, no render
  creatron render <video> <plan.json> [-o out.mp4]           render a plan you wrote or tweaked
  creatron prompt <video>                                    show exactly what text the AI would see

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
  else if (command === "analyze") {
    const a = await analyze(need(video, "video"));
    console.log(`${a.words.length} words, ${a.silences.length} pauses, ${a.duration}s. Saved next to the cache.`);
  } else if (command === "prompt") {
    console.log(describe(await analyze(need(video, "video"))));
  } else if (command === "plan" || command === "edit") {
    const a = await analyze(need(video, "video"));
    const result = await makePlan(a, need(third, "request"), values.model);
    result.plan = snapEdges(result.plan, a);
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
