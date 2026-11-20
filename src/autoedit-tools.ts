#!/usr/bin/env node
// The project tool belt: the commands that turn an editable project (src/project.ts) into pictures
// and a finished file. Auto Edit's AI runs it, and so does a person: `creatron project render
// <folder>` and the project's render.command call this file. Everything here reads and writes only
// the project folder (CREATRON_AUTOEDIT_DIR, never the shell's cwd), and every tool is started
// through the toolchain wall (toolchain.ts): a missing one is said in one line, never a crash.
//
// This file is only the list of commands. Each command loads what it needs when it runs, so a quick
// one (stage, cut, broll) never loads Remotion or webpack:
//   belt/context.ts   the project folder, its paths, errors
//   belt/picture.ts   stills and the render: kept bundle, one browser, pieces with a stall watchdog
//   belt/finish.ts    levelling on the WAV, one-pass finishing, one-pass measuring, the frame sheet
//   belt/cut.ts, belt/cutout.ts, belt/app.ts (commands that run in the app, and B-roll)
import { APP_COMMANDS } from "./project.ts";

type Command = { usage: string; run: (args: string[]) => Promise<unknown> | unknown };

const ctx = () => import("./belt/context.ts");

const COMMANDS: Record<string, Command> = {
  tools: {
    usage: "tools                                   which tools work now and what each job uses",
    run: async () => console.log((await import("./toolchain.ts")).healthReport()),
  },
  stage: {
    usage: "stage <name>                            tell Creatro which step you're on",
    run: ([name]) => console.log(`ok, stage: ${name ?? "?"}`),
  },
  cut: {
    usage: "cut keep.json                           keep these source ranges -> cuts + captions in project/timeline.json",
    run: async ([file]) => (await import("./belt/cut.ts")).cut(file ?? (await ctx()).fail("usage: cut keep.json")),
  },
  still: {
    usage: "still <seconds> [<seconds>...] [name]   frames -> notes/checks/<name>.png, all from one browser",
    run: async (args) => (await import("./belt/picture.ts")).stills(await stillShots(args)),
  },
  render: {
    usage: "render [draft]                          the finished video -> Export/<Name>.mp4 at -14 LUFS, then check",
    run: async ([mode]) => {
      const { DIR, P, config } = await ctx();
      const { mkdirSync } = await import("node:fs");
      const { finalFile } = await import("./project.ts");
      const { renderPictures } = await import("./belt/picture.ts");
      const { finish, check } = await import("./belt/finish.ts");
      mkdirSync(P.exports, { recursive: true });
      const r = await renderPictures(mode === "draft");
      const final = finalFile(DIR, config.name);
      const measured = await finish(r.pictures, r.sound, final);
      r.done();
      console.log(r.summary);
      await check(final, measured);
    },
  },
  check: {
    usage: "check [file]                            still editable? + loudness, peaks, a sheet of frames",
    run: async ([file]) => {
      const { DIR, config, inside } = await ctx();
      const { finalFile } = await import("./project.ts");
      await (await import("./belt/finish.ts")).check(file ? inside(file) : finalFile(DIR, config.name));
    },
  },
  cutout: {
    usage: "cutout                                  the speaker without background -> assets/cutouts/speaker.webm",
    run: async () => (await import("./belt/cutout.ts")).cutout(),
  },
  "3d": {
    usage: "3d new <name> [--seconds 5] | 3d still <name> <t>[,<t>] | 3d render <name> [--n 16]   a 3D shot in code (assets/3d/<name>) -> assets/broll/<name>.mp4",
    run: async (args) => (await import("./belt/scene3d.ts")).scene3d(args),
  },
  broll: {
    usage: 'broll search "<words>" [--landscape|--portrait|--web]  |  broll get <id> <name> [--from s --to s | --find "..."] [--audio]',
    run: async ([what, ...rest]) => {
      if (what !== "search" && what !== "get") return (await ctx()).fail(`usage: ${COMMANDS.broll!.usage}`);
      return (await import("./belt/app.ts")).broker(what, rest);
    },
  },
};

/** still 3.5 shot  |  still 1 4 9  |  still 1 4 9 hook  (names from the seconds when none is given). */
async function stillShots(args: string[]) {
  const number = (a: string) => /^-?\d+(\.\d+)?$/.test(a);
  const seconds = args.filter(number).map(Number);
  const name = args.find((a) => !number(a))?.replace(/\.png$/, "");
  if (!seconds.length) (await ctx()).fail(`usage: ${COMMANDS.still!.usage}`);
  return seconds.map((s, i) => ({
    seconds: s,
    name: name ? (seconds.length > 1 ? `${name}-${i + 1}` : name) : `still-${String(s).replace(".", "_")}`,
  }));
}

const [cmd, ...args] = process.argv.slice(2);
const command = cmd ? COMMANDS[cmd] : undefined;

// Every command but the two that only report (stage, tools) works on a project folder: said up front,
// before anything runs. A storyboard planned from a script has no video project yet, and still reports its stage.
if (cmd !== "stage" && cmd !== "tools") await ctx();

if (!command) {
  console.error(`error: unknown command "${[cmd, ...args].join(" ")}". Commands:\n${Object.values(COMMANDS).map((c) => `  ${c.usage}`).join("\n")}`);
  process.exit(1);
}

// Inside an AI job, the commands that start Chrome or the Vision helper run in the app, not here:
// the agent's shell may not be allowed to start them. If the app can't be reached, they run here.
if (APP_COMMANDS.includes(cmd!) && process.env.CREATRON_BROKER && !process.env.CREATRON_IN_APP) {
  const code = await (await import("./belt/app.ts")).inApp(process.env.CREATRON_BROKER, [cmd!, ...args]);
  if (code !== undefined) process.exit(code);
  console.log("note: Creatro didn't answer, so this runs here instead.");
}

await command.run(args);
