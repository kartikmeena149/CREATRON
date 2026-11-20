---
name: explainer-reels
description: Make short science, tech and news explainers (Reels, Shorts, TikTok, 30-60 s) look and sound like the best creators. Covers the hook, the speaker as bookends, one visual world, labels as tags, calm captions, research and news shown as highlighted documents, familiar comparisons, redrawn charts, mid-roll and outro asks, sound and colour. Use when building or fixing a talking-head or voice-over explainer, or when the user asks for a "professional", "creator", "Instagram" or "YouTube" look.
---

# Explainer reels

This skill is based on frame-by-frame study of top science and tech explainer reels. The research is in
Creatro's `docs/research/professional-storyboards.md`. What makes those reels look professional is
restraint and consistency, not more effects. Build to these patterns, with this video's own palette and
fonts. Never copy another creator's brand: their colour, logo or name.

## The shape (36-60 s)

1. **Hook, 0-3 s.** The speaker, close and expressive, says the claim or question as the first sentence. The
   first visual proving it lands by about second 3. No title card, logo, intro or "hey guys".
2. **Explain with pictures.** In most good reels the speaker is on screen only about 25-30 % of the time:
   the opening claim, the "but…" turn, and the outro. Everything else is full-frame visuals.
3. **Proof.** Real evidence: documents, data, archive footage, a demonstration (see "Research as evidence").
4. **Payoff.** What it means, often a callback to the opening picture.
5. **Outro.** The speaker again, framed tighter, pointing at the viewer. An accent pill with one ask ("FOLLOW")
   pops, sometimes with a little cursor clicking it. The last caption is the ask. Use the same outro in every
   video of a series.
6. **Mid-roll ask.** The same accent pill appears for about 1 s at 25-45 % of the length, over the visuals,
   just above the captions.

## Layouts: two, used with intent
- **The speaker, full frame**, for the claim, the turn and the outro.
- **The visual, full frame**, for everything that explains.
- Use a split screen or a floating card only when two things must be seen together. Variety comes from the
  pictures, not from changing layouts.

## The visual world
- One treatment for the whole video, for example 3D objects on a dark reflective grid, a flat 2D
  illustration, or real footage with diagram overlays. Every shot that explains stays in it.
- Turn each abstract idea into an object: a flask labelled H₂O, coloured zones around a star, molecules as
  coloured balls, a cutaway of a machine under the ice.
- Camera moves are slow and purposeful: a push-in on the detail, a pull-out to reveal scale, a move from the
  globe down to the place. One move per shot.

## Type
- **Tags** name things in the picture: a small box in the accent colour with dark bold capitals, slightly
  tilted (-3° to 3°), sitting against the object (`H₂O`, `IONIC LIQUID`, `5 ELEPHANTS`). For a comparison,
  use a second tag in a second colour.
- **Diagram labels** follow the shape: curved along an orbit ring, along a layer band (`STRATOSPHERE`).
- **The hero word**: once or twice per video, a big heavy sans in the accent colour, with no effect, over the
  picture. A long word may break with a hyphen ("CHLOROFLUORO-" / "CARBONS").
- **Numbers**: big, in an accent box ("330,000"), often over a speed-blur, a fast push or a counter.
- **Measurements**: a thin bracket with a tag ("~20 µm"), or height lines with tags (`2,450 m` against a
  famous building's tag).
- **Source lines**: tiny white text top left ("* SOURCE: NASA") on every real photo, paper, chart or
  archive clip.
- Fonts: one heavy grotesk for everything (SF Pro Heavy or Black, Helvetica Neue Condensed Black, Avenir Next
  Condensed Heavy). Gold, chrome, extrude and glow are not part of this look.

## Captions
- **One line, 3-5 words, white bold capitals, small** (about 40-52 px on a 1080-wide frame), **no box**. Add a
  thin dark outline or soft shadow so they read over white pages.
- **Always at the same height**, about 76-80 % down the frame, inside the Reels and Shorts safe zone (keep
  text between y ≈ 210 and 1600 of 1920, and x ≤ 996).
- The same style from the first frame to the last. Every spoken word appears once, on time.
- A bigger, word-by-word "punchy" style (1-3 words, heavy, keyword in accent) is a different look. Use it only
  when the brief or the reference asks for it.

## Research as evidence

Show sources as documents, in this order, each for 2-3 s:
1. **The news headline.** The page fills the frame with no card and no browser bar. It is pushed in so the
   headline runs off the edge, with the date line visible. A highlighter in the accent colour sweeps over
   **exactly the words being said**.
2. **The primary source** (the paper, or the lab or company page), with its title highlighted.
3. **The key number or sentence** in the body text, pushed in close, with only that phrase highlighted.
4. **The paper itself**: dense pages, two or three stacked, shown long enough to feel real, not long
   enough to read.
5. **The verification**: data, results, a repository listing. A fast scroll says "there are a lot".
6. **The caveat or the critics**, highlighted as well: "Some results could have issues", "draws concerns from
   experts". Showing it builds trust.
7. **Many papers or results**: page cut-outs that land one on another, tilted ±4°, with soft shadows, over a
   blurred background.

How to make a document shot editable: build the page in the video's code as live text (the headline, date,
byline and a few body lines, in the publication's kind of typeface), with the highlight as its own layer that
draws on. A real screenshot of the page in `assets/` works too, if you can get one. The highlight and its
timing go in `timeline.json`, never baked into the picture. Credit the source with a source line.

## Data
Redraw charts in the video's style; never paste a screenshot of a chart. Show the real data points, one
vertical marker with a label at the key event ("Montreal Protocol – 1987"), and the trend traced by a thick
accent stroke that draws on.

## Sound
- A music bed low under the voice, ducked. It changes or drops at the turn.
- One sound per meaningful visual event: a pop when a tag lands, a soft whoosh on a camera move, a riser into
  the turn, a click on the follow pill. Different events get different sounds, never the same whoosh on
  every cut.
- Sounds must have air (2-8 kHz) to survive phone speakers. Master at about -14 LUFS, true peak ≤ -1 dBTP.

## Cuts and pacing
- Hard cuts. Use a whip or flash only between sections, at most 2-3 per video.
- Something new on screen every 2-4 s, but not uniformly: linger on the big image, and speed through lists.
- A question to the viewer ("Can you guess how much this weighs?") with 3-4 choices on screen holds attention
  through the setup.

## Done means
- [ ] Hook: the claim in the first sentence, and the picture by second 3.
- [ ] The speaker as bookends (claim, turn, outro); visuals carry the middle.
- [ ] One visual world, one accent colour, tags on objects, source lines on real images.
- [ ] Captions: one calm style, small, no box, a fixed height, inside the safe zone.
- [ ] Research shown as highlighted documents in the evidence order, the caveat included.
- [ ] Every number has a familiar comparison; charts are redrawn.
- [ ] A mid-roll ask and an outro ask in the accent colour.
- [ ] Sounds on events, varied, audible on a phone; about -14 LUFS.
