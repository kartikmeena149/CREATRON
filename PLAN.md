# CREATRON — Startup Plan

**One line:** Cursor for video. Drop raw footage, say what you want, pick any AI model, get an edited video. One subscription; Creatron pays the AI providers.

## How it works
1. User drops files → app runs locally: ffprobe (video info), Whisper (transcript), a few still frames.
2. User types a request and picks a model (Claude / GPT / Gemini / …).
3. App sends **text only** (transcript, metadata, frames, request) to the Creatron server. Video is never uploaded.
4. Server calls the chosen model with editing tools: cut, trim, captions, speed, zoom, reframe 9:16, color, music.
5. Model returns an **edit plan** (timeline JSON), not a finished video.
6. App shows it as a timeline + preview; user tweaks or chats more.
7. ffmpeg renders the final video locally on the user's Mac.

Why: rendering is free (customer's computer), footage stays private, edits stay editable.
No computer use — call ffmpeg directly via tools.

## Accounts / API keys
| Purpose | Service | Launch? |
|---|---|---|
| Many models, one key | OpenRouter | Yes |
| Direct models (later) | Anthropic, OpenAI, Google Gemini APIs | Later |
| Transcription | whisper.cpp bundled (local, free) | Yes |
| Login | Supabase or Clerk | Yes |
| Payments | Paddle or Lemon Squeezy (handle global tax), or Stripe | Yes |
| Server (keys + credits) | Supabase Edge Functions / Cloudflare Workers / Vercel | Yes |
| Mac signing + notarization | Apple Developer account ($99/yr) | Yes |
| Extras | ElevenLabs, stock music, AI b-roll | Later |

Users can't "log in with Claude" to use their Claude.ai plan in a third-party app. Options: Creatron subscription (main), or bring-your-own API key (optional plan).

## Pricing (draft)
- **Free:** few exports/month, watermark, basic models
- **Pro:** ~$20/month, credits, all models, no watermark
- **Max:** ~$50–60/month, more credits
- **BYOK:** cheaper, user pays AI provider
Credits scale with model cost. Estimated AI cost: a few cents to ~$0.50 per edit (verify current token prices).

## Tech stack
Electron + React, with LGPL ffmpeg and whisper.cpp bundled. Mac first, Windows later from the same code. Phone app later, using the same server.

## Launch budget
About $200–400: Apple Developer $99, domain ~$15–30, free-tier hosting, $50–200 AI test credits. Payments take a % per sale.

## 1-month roadmap (features to be finalized)
- **Week 1:** app shell, drag & drop, Whisper transcript, ffmpeg render from edit plan
- **Week 2:** AI brain with ~5 tools (silences, captions, trim, 9:16, speed) + preview/timeline
- **Week 3:** server, login, credits, payments, model picker
- **Week 4:** signing/notarization, landing page, 10–20 beta users

Competitors: Descript, CapCut, Opus Clip, Submagic, Captions.
Angle: chat to edit, any model, local and private.
