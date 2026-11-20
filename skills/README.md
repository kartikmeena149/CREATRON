# Creatro's own skills

These skills ship with Creatro. Before every AI job (storyboard, edit, fix), Creatro copies this folder
into the job's project as `.claude/skills/`. That way any Claude it starts, even a fresh account with no
skills installed, knows how Creatro storyboards and edits. The playbook (`src/autoedit-playbook.md`) points
to them by path as well, so they are read even where skills aren't auto-discovered.

| Skill | What it teaches |
|---|---|
| `storyboard-director/` | Planning a video as a professional storyboard: beats, one idea per shot, how to write shots so Creatro's sketches read cleanly, evidence shots. |
| `explainer-reels/` | How top science and tech explainer reels look and sound: hook, the face as bookends, visual-first shots, labels, captions, research shown as evidence, comparisons, charts, outro. |
| `editorial-reels/` | Voice-over documentary reels about business, money and history: kinetic type on warm paper (condensed capitals plus italic serif), ring charts, numbers as objects, archive with colour blocks, year cards, cinematic story scenes, a punchline ending. |
| `3d-animator/` | Cinematic 3D shots made in code (three.js, rendered frame by frame): camera, light, motion, sound. In Creatro it runs through the tool belt (`$T 3d new/still/render`, the `three` tool in toolchain.ts); see `IN-CREATRO.md`. |

Rules for editing these:
- They describe what good looks like. Never write them as if one specific tool exists (CLAUDE.md, part 1).
- When a skill and the playbook disagree, the playbook wins. It knows the project format and the tool wall.
- The research behind the style skills is in `docs/research/professional-storyboards.md`.
