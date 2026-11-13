# Creatron design language

How Creatron's website and brand look, and why. It starts from a close reading of
[nothing.tech](https://in.nothing.tech/) (studied November 2026). We take its principles, not its assets:
Nothing's typefaces (NType, Ndot), logo and product imagery are theirs and are never used here.

---

## Part 1. What nothing.tech does

Values below were measured on the live page (computed styles), not guessed.

### 1.1 The idea behind it

Nothing sells hardware as if it were an instrument panel. The site has no decoration that is not also
information: a dot grid, a label, a number in brackets. Everything else is the product, photographed on grey
or black. The result feels engineered and calm at the same time.

Five principles hold the whole site together:

1. **Monochrome first, one signal colour.** Black, white and greys do 98% of the work. Colour shows up only
   where something is *live*: a red dot on a product, a yellow sign-up button. Because colour is rare, it
   always means something.
2. **The dot as the unit.** A faint dot grid sits behind every section, and the brand's display type is
   built from dots (a dot-matrix face). Dots say "screen", "signal", "made of pixels" without saying it.
3. **Three voices of type, each with one job.** A plain, slightly mechanical text face for reading. A
   dot-matrix face for labels, numbers and big nav words. A small uppercase mono for buttons and links.
   They never swap jobs.
4. **Technical punctuation.** Names carry brackets: `Headphone (1) Pro`, `NOTHING ( CHARLI XCX )`.
   Labels are dated like a log entry: `NYC, SEPT 2026`. The brand speaks like a spec sheet.
5. **Full-bleed bands, quiet controls.** Sections are edge-to-edge bands (black, white, light grey) with
   huge imagery. Controls are small, square-ish and exact. Nothing is rounded into softness.

### 1.2 Colour (measured)

| Role | Value | Where |
| --- | --- | --- |
| Page | `#F4F4F4` | Body background, product bands |
| Ink | `#040404` (and `#000000`) | Text on light, black bands, dark buttons |
| White | `#FFFFFF` | Text on dark, light buttons, cards |
| Mid grey | `#595A5A` | Secondary text |
| Soft grey | `#D8D9D9`, `#B1B3B3` | Hairlines, disabled, tile backgrounds |
| Tint | `rgba(89,90,90,0.05)` / `rgba(255,255,255,0.05)` | Card fills on light / dark |
| Signal | `#FFC700` (yellow), product red | Only the newsletter button and product details |

### 1.3 Type (measured)

| Voice | Face | Size | Notes |
| --- | --- | --- | --- |
| Reading + headings | NType82 Regular | 16 body · 24 h3 · 32 h2 · 48 h1 | Weight 400 everywhere. Headings are big, never bold. Line-height 1.0 on headings, 1.4 on body. |
| Labels + nav words | Ndot (dot-matrix) | 20 labels · ~40 footer nav | Uppercase. Used for dates, tags, the wordmark and the footer menu. |
| Controls | Geist Mono | 12 | Uppercase, normal tracking. Every button and link label. |

Hierarchy comes from **size and voice, never weight**. There is no bold on the page.

### 1.4 Shape and spacing (measured)

- **Buttons:** 40px tall, `12px 16px` padding, **4px radius**, mono uppercase 12px label + a small chevron `>`.
  White button on dark, black button on light. No shadows.
- **Cards and tiles:** **8px radius**, flat light-grey fill, no border, no shadow.
- **Nav:** a floating bar, centred, 576 × 48, `rgba(255,255,255,0.8)` with `backdrop-filter: blur(45px)`,
  8px radius. Menu icon on the left, the dot-matrix wordmark in the middle.
- **Footer:** black, the main links as huge centred dot-matrix words, then a narrow column of list rows
  (`SUPPORT ?`, `STORE: INDIA`), then a single row of tiny mono links at the very bottom.
- **Dot grid:** dots about 64px apart over every section, light grey on light and dark grey on black.

### 1.5 Motion and imagery

- Products sit on grey gradients or pure black, lit from above, nothing else in frame.
- Video plays full-bleed with a headline set over it in white.
- Motion is slow and physical. Nothing bounces.

---

## Part 2. Creatron's version

The same discipline, our own material. Creatron is a video editor that thinks, so our signal is a
**red recording light**: the one dot that says "live", "recording", "the AI is working".

### 2.1 Principles

1. **Black, white, grey. One red dot.** Red appears once per view at most: the dot in the logo, a live
   state, the main call to action on a dark band. Never as decoration, never as a gradient.
2. **The frame is the unit.** Where Nothing uses the dot, we use dots *as frames*: a strip of dots is a
   timeline, a gap in it is a cut. The dot grid behind every section is a sheet of frames.
3. **Three voices of type.**
   - Reading and headings: **Geist** (400; headings large, never bold).
   - Labels, numbers, big nav words: **Doto** (an open dot-matrix face), uppercase.
   - Buttons and links: **Geist Mono** 12px uppercase.
   All three are open-source (SIL OFL) and load from Google Fonts. The logo itself does not use a font:
   its letters are drawn dot by dot from code.
4. **Speak like a timeline.** Timecodes and brackets carry meaning: `00:00:12:04`, `CREATRON ( DEMO )`,
   `( 01 ) THE MODEL DECIDES`. Steps are numbered, versions are dated.
5. **Bands and exact controls.** Full-width sections that alternate paper / ink. Buttons 40px tall,
   4px corners. Cards 8px corners, flat. No shadows, no glows, no gradients on UI.

### 2.2 Tokens

```css
:root {
  --paper:   #F2F2F2;  /* page */
  --white:   #FFFFFF;  /* cards on paper, text on ink */
  --ink:     #0A0A0A;  /* text on paper, dark bands */
  --ink-2:   #161616;  /* cards on ink */
  --grey:    #5C5C5C;  /* secondary text on paper */
  --grey-2:  #9A9A9A;  /* secondary text on ink */
  --line:    #D9D9D9;  /* hairlines on paper */
  --line-2:  #2A2A2A;  /* hairlines on ink */
  --red:     #E5231B;  /* the recording light: one per view */

  --r-control: 4px;
  --r-card:    8px;
  --h-control: 40px;
  --grid:      32px;   /* dot grid pitch */

  --font-text:  "Geist", system-ui, sans-serif;
  --font-dot:   "Doto", ui-monospace, monospace;
  --font-mono:  "Geist Mono", ui-monospace, monospace;
}
```

### 2.3 Type scale

| Use | Face | Size / line | Case |
| --- | --- | --- | --- |
| Hero headline | Geist 400 | clamp(44px, 7vw, 96px) / 0.95, tracking -0.03em | Sentence |
| Section headline | Geist 400 | 40 / 1.0, tracking -0.02em | Sentence |
| Card title | Geist 400 | 22 / 1.15 | Sentence |
| Body | Geist 400 | 16 / 1.5 | Sentence |
| Label, timecode | Doto 700 | 16–20 / 1 | UPPER |
| Footer nav | Doto 700 | 44 / 1.1 | UPPER |
| Button, link, meta | Geist Mono 400 | 12 / 1, tracking 0.02em | UPPER |

### 2.4 Components

- **Button.** 40px, 4px radius, mono 12px uppercase, chevron `>` after the label. Primary: ink on paper /
  white on ink. The red button exists only once per page.
- **Nav.** Floating, centred, frosted (`rgba(255,255,255,0.8)`, blur 40px), 8px radius, 48px tall. Logo mark
  left, links as mono labels, one button right.
- **Card.** Flat fill (`--white` on paper, `--ink-2` on ink), 8px radius, a Doto label top-left like
  `( 01 )`, then a Geist title and grey body.
- **Dot grid.** `radial-gradient(circle, currentColor 1px, transparent 1.5px)` at `--grid` pitch, 10–14%
  opacity, behind every band.
- **Footer.** Ink band. Big Doto words for the main links, centred. A narrow list of rows. A last line of
  mono links.

### 2.5 The logo

- **Mark: the reel.** Ten dots in a ring of twelve places: frames, a loop, a reel, a clock face. The two
  missing frames on the right are the **cut**, and they turn the ring into a **C**. In the centre sits one
  red dot: the recording light, the lens, the AI at work. One shape: frames, the cut, the name, and the
  live moment. (A red dot placed *in* the cut was tried and dropped: the ring then read as a loading
  spinner.)
- **Small mark.** Below 48px the twelve frames blur together, so small uses (favicon, 16–32px) draw the
  same C from eight places with six bigger dots.
- **Wordmark.** `CREATRON` in our own dot-matrix letters, drawn on a 5 × 7 grid, one dot per pixel. It sits
  on the same dot pitch as the mark, so mark and word are made of the same material.
- **Colour.** Ink or white only, plus the single red dot. A one-colour version replaces red with the ink.
- **Clear space.** One mark-dot gap (the distance between two dots in the ring) times three, on all sides.
- **Smallest size.** Mark: 16px. Wordmark: 72px wide. Below that, use the mark alone.
- **Never:** a gradient, a glow, a second colour, rounded containers behind it, the dots redrawn as other
  shapes.

All logo files come from `website/brand/make-logo.ts`; change a number there and regenerate.

### 2.6 What we left out on purpose

- Nothing's own typefaces and wordmark. We use open faces and drew our own dot letters.
- Product photography conventions. We show the editor and real footage instead of hardware.
- The yellow sign-up button. Our one signal is red, and it means "live".
