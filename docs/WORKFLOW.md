# How Creatro's AI edits a video: brain, hands, editable output

Three parts. The brain decides, the hands do, and whatever gets made stays an open project you can
change yourself on this Mac.

## 1. Layers

```
BRAIN     Claude (claude -p), or any model through the edit plan.
          Editing judgment: hook, cuts, pacing, structure, style. Writes code, debugs.
          Decides WHAT should happen. Never depends on one specific tool.
------------------------------ the wall: src/toolchain.ts ------------------------------
HANDS     ffmpeg, ffprobe, whisper.cpp, Remotion, HyperFrames, yt-dlp, earshot, swiftc
          Each is found, health-checked and started in ONE place. No other file starts a tool:
          tools.ts run() sends every known tool name through the wall.
-----------------------------------------------------------------------------------------
OUTPUT    An open project folder (src/project.ts). The MP4 in Export/ is a by-product.
```

## 2. The wall

| Piece | Where | What it does |
| --- | --- | --- |
| Wrappers | `find(tool)` / `need(tool)` in `src/toolchain.ts` | Where the tool is, how to start it, its backup |
| The only hole | `run()` in `src/tools.ts` | Every ffmpeg / ffprobe / whisper-cli / yt-dlp / swiftc call goes through `need()` |
| Health check | `health()`, `healthReport()`; `node src/cli.ts doctor` | Starts every tool once; says what works and what each job uses now |
| Before each job | `autoEdit()` in `src/autoedit.ts` | Runs the health check, shows broken tools as one line each, writes `notes/TOOLS.md` for Claude |
| Claude's shell | `.creatron/bin/ffmpeg`, `ffprobe` in the job folder | Thin wrappers first on its PATH, so its own commands use the same tool or backup |
| Test hook | `CREATRON_BREAK=ffmpeg,yt-dlp:all` | Pretends a tool (or all its choices) is missing, to test fallbacks |

## 3. Fallback table

A broken tool is said in one line, the next choice is used, the job finishes.

| Job | First choice | Backup | Last resort |
| --- | --- | --- | --- |
| Cut, encode, probe | ffmpeg / ffprobe (Homebrew) | The ffmpeg bundled inside Remotion (cuts and encodes; no loudness meter, so audio is exported as mixed) | None: the one tool Creatro can't work without |
| Transcribe | whisper.cpp + small.en | Another Whisper model on the Mac, then HyperFrames' transcriber | No transcript: captions typed into timeline.json, cuts from pauses |
| Build and render | Remotion (`project/src` + `timeline.json`) | HyperFrames (`project/index.html`), same folder and commands | The starter project (footage + captions), or an edit plan on the timeline rendered with ffmpeg |
| Web video, CC music | yt-dlp | Stock clips (Pixabay) and Wikimedia | No B-roll: type, shapes, colour |
| Sound effects | earshot's bank | ffmpeg-made effects | None |
| Speaker cutout | Apple Vision (`tools/person-mask.swift`) | none | Speaker as a card or split screen |

A fallback is just as editable: every engine writes the same folder, the same `timeline.json`,
README and render command.

## 4. The project folder (everything the AI makes)

```
<Name>/
  source/        the original recording, linked in, never modified
  assets/        broll/  audio/  sfx/  cutouts/     one file per thing
  project/       the editable video
    timeline.json    cuts, captions, music, sfx, colours, caption style: plain values
    src/             the layers (Remotion). src/creatron/ reads timeline.json and plays the cuts
    public/          two links to source/ and assets/ (nothing is copied)
  Export/        <Name>.mp4, versions/v1.mp4..., Thumbnails/<Name>/
  notes/         transcript, brief, TOOLS.md, check frames (working files)
  README.md      "How to edit this": where captions, cuts, music and colours live
  render.command the one command that re-exports (double-click)
```

What makes it editable
- **Cuts** are `{ start, end }` in source seconds. The source file is played through them. There is no pre-cut video.
- **Captions** are text with source times. They are drawn at render time and follow their words when a cut changes.
- **Music, SFX, colours, sizes** are values in `timeline.json`; each sound is its own file in `assets/`.
- **Length** is the sum of the cuts. Nothing to keep in sync.
- **In Creatro's timeline**: *Open in timeline* (or Import Claude edit → the `project` folder) turns it into layers.
- **Re-export**: `render.command`, or `node src/cli.ts project render <folder>`. No hidden steps.

## 5. The rule, enforced

| Where | How |
| --- | --- |
| `src/autoedit-playbook.md` | Claude's instructions for every job: the three parts, the fallback table, "Editable, always" |
| `validateProject()` in `src/project.ts` | The rule as code: source untouched, cuts and captions are values, no pre-cut file, all media local, no absolute paths or internet media, README and render command present |
| `check` in the tool belt | Prints `EDITABLE: yes / NO` first, with what to fix |
| `ensureRendered()` in `src/autoedit.ts` | After every turn, anything `validateProject` finds is sent back to Claude to fix |
| `CLAUDE.md` | The same three rules for anyone (or any AI) changing Creatro's code |

## Commands

```bash
node src/cli.ts doctor                               # which tools work, what each job uses
node src/cli.ts project new <Name> <footage>         # scaffold (default ~/Movies/Creatron/<Name>)
node src/cli.ts project render <folder> [draft]      # re-export
node src/cli.ts project check <folder>               # still editable? + loudness and frames
node src/cli.ts project still <folder> <sec> <name>  # one frame
node src/cli.ts project cut <folder> <keep.json>     # set cuts and captions from ranges
node src/cli.ts project cutout <folder>              # speaker without background
```
