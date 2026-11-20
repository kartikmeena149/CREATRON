# __NAME__

An open Creatro project. Everything is on this Mac and stays editable: nothing is baked in.

```
source/    the original recording, never changed
assets/    broll/  audio/ (music, voiceover)  sfx/  cutouts/  clips/ (your own)   one file each
project/   the editable video
             timeline.json   cuts, captions, music, colours, sizes  (plain values)
             src/            the layers and looks (Remotion code)
Export/    __NAME__.mp4  +  versions/  +  Thumbnails/__NAME__/
notes/     storyboard.json (the approved plan), transcript, brief, check frames (working files)
```

## Re-export (one command)

Double-click `render.command`, or in Terminal:

```bash
__RENDER__
```

The result is always `Export/__NAME__.mp4`, levelled to -14 LUFS.

## Edit it in Creatro's timeline

In Creatro choose **Import Claude edit** and pick the `project` folder (after an Auto Edit, press
**Open in timeline**). Every caption, clip, picture and sound becomes a layer you can move, trim and retype.

## How to edit this by hand

Open `project/timeline.json` in any text editor. All times are seconds of the ORIGINAL recording.

| I want to change | Where in `project/timeline.json` | What to edit |
| --- | --- | --- |
| A caption's words | `captions` | the `text` of that line |
| When a caption shows | `captions` | its `start` and `end` |
| The highlighted word | `captions` | `accent` (one word of the text) |
| A cut | `cuts` | `start` / `end` of that part of the recording |
| Add or remove a cut | `cuts` | add or delete a line; they play in order |
| The music | `music` | `file` (a file in `assets/audio/`) and `volume` (0 to 1) |
| A sound effect | `sfx` | `file`, `volume`, and `at` (seconds of the finished video) |
| Colours | `colors` | any value |
| Caption font, size, position | `captionStyle` | `font`, `size`, `bottom` (pixels from the bottom), `uppercase`, `outline` |
| Size or frame rate | top of the file | `width`, `height`, `fps` |

Good to know
- The video's length is the sum of the cuts. There is no length to keep in sync.
- Captions follow their words: shorten or remove a cut and its captions move or disappear by themselves.
- Looks and layers (backgrounds, B-roll cards, animations) are in `project/src/`. `Main.tsx` lists the layers back to front.
- The storyboard you approved is `notes/storyboard.json`: every shot, its line, layout, camera move and sound.
  Its PDF is in `Export/` when you made one. It is the plan, not the video: edits go in `timeline.json`.
- Then run the render command again. Nothing else is needed.
