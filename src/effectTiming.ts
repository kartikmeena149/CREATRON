// When an effect laid over a cut plays, shared by the renderer, the timeline and the app (plain
// TypeScript, so the command-line export can use it too).

/** Where an effect over a cut at `cut` starts: a dip and a light leak are centred on it, the others start on it. */
export const cutEffectStart = (effect: string, cut: number, duration: number) =>
  Math.max(0, effect === "dip" || effect === "leak" ? cut - duration / 2 : cut);
