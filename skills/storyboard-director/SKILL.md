---
name: storyboard-director
description: Plan a short video as a professional storyboard (Creatro's notes/storyboard.json) before anything is built. Covers story beats, one idea per shot, writing shots so the pencil sketches read like a film board, camera and element motion, evidence shots for research and news, and the checks a director makes before showing the board. Use whenever you write or redraw a storyboard.
---

# Storyboard director

You plan the video the way a film director and a storyboard artist do together. The storyboard is the
contract: the user approves it, then the video is built from it shot by shot. The format and the fields are in
`notes/PLAYBOOK.md`, section "Storyboard first". This skill is about what makes a board good.

A storyboard looks amateur when every panel says everything at once. It looks professional when **each panel
shows one idea**, the movement is drawn in the frame, and the words sit under it. Creatro draws your shots for
you, so the way you fill the fields decides how the sketch looks.

## 0. Pick the house style

Creatro has two house styles, each a skill. Read the one that fits before you plan:
- **`explainer-reels`**: a presenter on camera, science, tech and news. The speaker is the bookends,
  visuals in one world, tags on objects, calm captions, research shown as highlighted documents.
- **`editorial-reels`**: voice-over with nobody on camera, about business, money, history and power. It
  alternates data mode (kinetic type on warm paper: huge condensed capitals with small italic serif
  connectors, ring charts, numbers as objects, no captions over type) with story mode (cinematic scenes,
  small captions), year cards between them, and ends on a punchline over a picture.

A reference video or the brief can ask for either. Without one, choose by whether there is a speaker on camera.

## 1. Story first: beats

Give every shot a `beat`, and make the video follow this shape:

| beat | job | typical length |
|---|---|---|
| `hook` | The claim or question, said in the first sentence, with the picture that proves it by second 3. | 1-3 s, 1-2 shots |
| `setup` | The rule or context the viewer needs ("the habitable zone is where water can be liquid"). | 15-25 % |
| `turn` | The surprise, the "but…": what everyone gets wrong, or what changed. | 1-2 shots |
| `proof` | Evidence: the study, the data, the real footage, the demonstration. | 25-35 % |
| `payoff` | What it means. The new idea, the answer, the scale of it. | 15-25 % |
| `cta` | One clear ask, or a tease of what's next. | 2-4 s |

- **The hook is never a title card, a logo, a greeting or "in this video".** Open on the speaker saying the claim
  (personal, surprising) or on the most striking picture (visual topics). Something moves in the first frame.
- **The speaker is the bookends.** The face opens with the claim, comes back for the `turn`, and closes the
  `cta`. Between those, the pictures carry the explanation: a talking head explaining something you could
  show is a missed shot. The last face shot is framed tighter than the first (`camera: "punch-in"`).
- **One idea per shot.** If a line has two ideas, make two shots. A new shot every 2-4 s, but vary it: a
  uniform rhythm stops being noticed. Hold a big image longer, and fire quick cuts through a list.

## 2. Visual first

Decide each shot's picture before you think about its text.
- For every claim, ask what concrete object or diagram would make it understandable in one second. Water
  becomes a flask labelled H₂O, a range becomes coloured rings, "heavy" becomes elephants on a balance scale.
- **Every big or tiny number gets a familiar comparison**: elephants, a skyscraper, Mount Everest, a dog, a
  human hair. Show it as two tags in two colours on a balance or side by side, or as a measurement bracket with
  a tag ("~20 µm").
- **One visual world per video.** Pick a single treatment for the explanatory shots and stay in it, for example
  3D glass on a dark grid, a flat illustration, or real footage with diagram overlays. Documents and archive
  footage are the only exceptions, because they are evidence.
- **One accent colour** (`look.palette`, the brightest) for every tag, highlight, hero title and the CTA.
  Everything else is neutral. Add a second accent only when two things are compared.

## 3. Evidence shots (research, studies, news)

When the video is about a study, a paper, an announcement or the news, show the sources as documents, in this order:

1. **Coverage**: the news headline.
2. **Primary source**: the paper, or the lab or company page.
3. **The key number or sentence** inside it.
4. **The paper itself**: a few dense pages, so it reads as real.
5. **How it was checked**: data, a repository scrolling, an independent test.
6. **The caveat or critic**: show the limitation, from the source itself. It builds trust.
7. **What it means**: back to your own visuals.

Each one is a `kind: "document"` shot of 2-3 s. `query` names the page ("Scientific American headline: OpenAI
unleashes hundreds of math results"). It gets a `text` layer with `effect: "highlight"` holding exactly the
words being said at that moment, placed where they sit on the page. The page fills the frame, pushed in until
the text runs off the edge (`camera: "zoom-in"`, `focus` on the highlight). Never put it in a card or show a
browser bar. Many papers or results are one shot with an `enter: "pop"` layer and a note ("pages stack, one per
beat").

Every real image, paper or chart also needs a source line. Add a small `text` layer top left: "SOURCE: NASA".

## 4. Writing shots so the sketch reads

Creatro turns your fields into a pencil panel. It draws movement in red and lists the notes under the panel.
To keep panels clean:

- **Layers are few and real.** At most 3-4 per shot: the title or tag, the caption, one card or element. Place
  them where they will really be. The caption sits low-middle (about y 0.74-0.80), inside the safe zone. Titles
  never cover the face or the subject.
- **Motion: one camera move plus at most two moving layers per shot.** More reads as noise, and the sketch only
  draws two. If more must move, split the shot.
- **`note` is a short build instruction**, 2-8 words ("counter rolls 0 to 330,000", "pages stack, one per
  beat"). It appears under the panel as a numbered callout, never as a sentence across the drawing.
- **Tags, not floating titles**, for naming things: `effect: "tag"` (accent box, dark text) placed against the
  object it names. The hero word of the video, at most one or two per video, is a big plain title
  (`effect: "none"`).
- **Kinetic-type shots** (editorial style): `kind: "text"`, one `text` layer per size of type: the key word big
  in a condensed face (`"font": "DIN Condensed Bold"`), the connecting words as their own small layer in an
  italic serif (`"font": "Bodoni 72 Book Italic"`, `"caps": false`), placed tight against it. No caption
  layer: the type is the caption.
- **`focus`** on every zoom or punch-in: where it ends (the face, the chip, the highlighted words).
- **`sketch`** (for shots with no footage): draw the subject big and simple, with a readable silhouette,
  in 6-16 strokes. Shade the subject (`shade` 0.5-0.8) and leave the background light or empty, so it reads
  by contrast. Draw the real object (wheels, windows, pins, eyes), not a blob, and never text.
- **Transitions are cuts.** Use `whip`, `zoom` or `flash` only between beats, at most 2-3 in a short.
- **`sound`** names a sound for a meaningful event ("riser into the turn", "pop as the tag lands"). Don't put the
  same whoosh on every shot.

## 5. Before you show the board

Check it like a director:
- [ ] The first shot says the claim and shows it by second 3, with no title card.
- [ ] The beats run hook, setup, turn, proof, payoff, cta, and every shot has one.
- [ ] Each shot has one idea, a picture decided first, and at most one camera move plus two moving layers.
- [ ] Every number has a familiar comparison, and every real source has a source line.
- [ ] Research or news has its evidence shots, the caveat included.
- [ ] One visual world and one accent colour. Hero effects (gold, chrome, glow, extrude) at most once.
- [ ] Captions are calm and consistent (see the explainer-reels skill). Nothing covers a face.
- [ ] The CTA is one ask, in the accent colour, with the speaker if they are on camera.

For how the finished video should look and sound, read `.claude/skills/explainer-reels/SKILL.md` (presenter
on camera) or `.claude/skills/editorial-reels/SKILL.md` (voice-over documentary). For cinematic
3D shots made in code, read `.claude/skills/3d-animator/SKILL.md` with `IN-CREATRO.md` next to it.
