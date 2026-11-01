# Creatron

Cursor for video. Describe the edit, pick any AI model, get a finished video. Rendering happens on your Mac and your footage never leaves it. See [PLAN.md](PLAN.md) for the product plan.

This is the **command-line prototype** of the core loop:

```
video ──► analyze (local) ──► plan (AI, text only) ──► snap cuts to waveform ──► render (local ffmpeg)
          ffprobe, whisper.cpp,     edit-plan JSON                                  cuts, speed, zoom,
          silence detection                                                         9:16, captions, loudness
```

## Setup

Needs Node 24+, `ffmpeg`, and `whisper-cli` (whisper.cpp) on your PATH, plus a Whisper model (`models/ggml-small.en.bin`, or set `CREATRON_WHISPER_MODEL`).

```bash
npm install
cp .env.example .env   # then add your OpenRouter key
```

## Use

```bash
node src/cli.ts edit talk.mp4 "cut the pauses, make it a 9:16 reel with captions"
node src/cli.ts prompt talk.mp4                       # see the exact text the AI receives
node src/cli.ts render talk.mp4 talk.plan.json        # re-render after tweaking the plan by hand
node src/cli.ts edit talk.mp4 "..." -m google/gemini-3-flash-preview   # any OpenRouter model
```

## The edit plan

[src/schema.ts](src/schema.ts) is the contract between the AI, the future timeline UI and the renderer. Example: [examples/k2-reel.plan.json](examples/k2-reel.plan.json).

| Field | Meaning |
|---|---|
| `segments[]` | Parts of the source to keep, in order: `start`, `end` (source seconds), `speed` (0.5–2), `zoom` (1–2) |
| `aspect` | `source`, `9:16`, `1:1`, `16:9` |
| `reframeX` | Horizontal crop center when narrowing (0 left to 1 right) |
| `captions` | `enabled`, `style` (`bold` / `minimal`), `wordsPerCaption` |
| `notes` | What the AI did, in plain words |

## Code

| File | Job |
|---|---|
| `src/analyze.ts` | Video info, word-timed transcript, pauses (cached in `work/`) |
| `src/plan.ts` | Prompt + OpenRouter call with a forced `submit_edit_plan` tool; one self-repair retry |
| `src/snap.ts` | Moves cut edges onto the real waveform (Whisper times drift ~0.2 s) |
| `src/captions.ts` | Groups words into cues on the output timeline, draws them as PNGs |
| `src/loudness.ts` | Measures the edit and sets gain + limiter so every export is -14 LUFS, true peak under -1.5 dBTP |
| `src/render.ts` | Builds the ffmpeg graph: per-segment seek, speed, zoom, 10 ms audio fades, reframe, overlay, loudness |

## Known limits (prototype)

- Captions are drawn as PNG overlays because the Homebrew ffmpeg has no libass/freetype. The shipped app will bundle an **LGPL** ffmpeg with libass (the Homebrew build is GPL and can't be shipped).
- Reframing is a fixed horizontal position; speakers who move need face tracking.
- Whisper model is English-only (`small.en`); Hindi/Hinglish needs a multilingual model.
- Render runs at about real time with x264; VideoToolbox hardware encoding will be several times faster.
