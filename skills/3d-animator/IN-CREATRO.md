# Using the 3D animator inside Creatro

`SKILL.md` was written for making a 3D film on its own. Inside a Creatro job, the playbook (`notes/PLAYBOOK.md`)
comes first. Where they differ:

- **Use the tool belt, not the kit's scripts.** Creatro has three.js and a rendering Chrome built in, behind
  its tool wall (`three` in `notes/TOOLS.md`):
  - `$T 3d new <name> [--seconds 5]` copies the kit's scene (`film.js`, `lib.js`, `styles.js`,
    `index.html`) into `assets/3d/<name>/`, sized to this video (W/H set), with the given length and the
    kit's own captions off (captions live in timeline.json).
  - `$T 3d still <name> 0.5,2,4 [--n 16]` renders frames to `notes/checks/3d-<name>-<t>.png`. Read them.
  - `$T 3d render <name> [--n 16] [--from s --to s]` renders `assets/broll/<name>.mp4` (no sound) and writes the
    command to `notes/how-assets-were-made.md`.
  Skip the skill's Setup section: no `npm install`, no `render.mjs`, no `mix.py`.
- **If `three` is BROKEN in notes/TOOLS.md**, don't try: make the shot another way (Remotion or HyperFrames
  layers, stock B-roll, an illustration), say so in one line, and finish. A BACKUP line means it works, only
  slower: keep `--n` at 4-8.
- **Don't stop to ask or wait.** Skip the skill's "ask up to 3 questions" and "wait for the user's OK". The
  approved storyboard is the plan, and Creatro's storyboard step is where the user approves it.
- **Nothing gets installed and no API keys are read.** No `.env`, no ElevenLabs: the recording is the voice,
  and Creatro's timeline mixes the music and sound effects.
- **It stays editable.** The scene's code lives in `assets/3d/<name>/`, and the clip is listed in timeline.json
  `"broll"` and played with `<Video muted src={staticFile("assets/broll/<name>.mp4")} />`. Name both in README's
  "How to edit this", so the user can change `film.js` and run the render line again.
- **The starter is a 16:9 desk scene.** In 9:16 its camera crops the sides: replace the props, camera and
  light for your shot (stages 2-5 of the skill). Frame for the format you are in.
- **Match the storyboard**: its accent colour, its visual world, the shot's camera move and `focus`.
- **Time budget.** On this Mac's GPU, a 3 s 1080×1920 shot at `--n 8` takes about 25 s. Preview at `--n 4-8`.
  Use `--n 16-24` for the final, and 48 only for the hero shot. Measure first and keep 3D within the job's time.
