# Creatro: rules for working on this code

Creatro's AI editing has three parts. Every change must keep all three true. Details: `docs/WORKFLOW.md`.

## 1. The brain decides
- Editing judgment (hook, cuts, pacing, structure, style) belongs to the model, not to a tool.
- Prompts and playbooks describe what should happen; they never assume one specific tool exists.

## 2. Tools stay behind the wall
- `src/toolchain.ts` is the only place that knows where a tool is, whether it works and what replaces it.
- Never `spawn`/`exec` ffmpeg, ffprobe, whisper-cli, yt-dlp, swiftc, earshot or a HyperFrames/Remotion CLI directly.
  Use `run()` from `src/tools.ts` (it goes through the wall) or `find()` / `need()`.
- Adding a tool = one entry in `candidates()`, `FALLBACK` and `routing()` in `toolchain.ts`, with its backup.
- A tool failing must never end a job or hand the problem to the user: say it in one line, use the fallback, finish.
  Test it with `CREATRON_BREAK=<tool>` (or `<tool>:all`).
- Every AI job starts with `health()` and passes the report to the model (`notes/TOOLS.md`).
- Ask Kartik before installing anything (brew, npm, models) or adding a skill.

## 3. Everything the AI makes is an open, local, editable project
- Output is a project folder from `scaffoldProject()` (`src/project.ts`): `source/`, `assets/`, `project/`, `Export/`,
  plus `README.md` and `render.command`. Never only a finished file.
- `source/` is never modified. Cuts are values in `project/timeline.json`; never write a pre-cut video.
- Captions stay live text in `timeline.json`; never burn them into pixels before the final export.
- Text, timings, colours and layers are plain values in `timeline.json`, read by the code.
- Everything is local: paths relative to the project, no cloud render, no remote media, no absolute paths.
- Re-export is one command (`render.command` → `creatron project render`). Any new step goes into the tool belt
  (`src/autoedit-tools.ts`), never only into a prompt or command history.
- The project README's "How to edit this" must stay true.
- A fallback engine produces the same layout, `timeline.json`, README and render command.
- `validateProject()` is this rule in code. New ways to break editability get a new check there.

## Before saying it's done
- `npx tsc --noEmit` passes.
- `node src/cli.ts doctor` runs, healthy and with a tool broken (`CREATRON_BREAK=ffmpeg node src/cli.ts doctor`).
- A sample project renders and still says `EDITABLE: yes`: `node src/cli.ts project render <folder>`.
- Do not run an earshot audio check before handing over an export unless Kartik asks for one.
