// What the Effects section shows: its tab, the main-track cut picked on the timeline (the clip
// after it), or the transition laid over a cut that's picked (by id).
import { create } from "zustand";

export const useFx = create<{ tab: "transitions" | "effects"; cut: number | null; cutFx: string | null }>(() => ({ tab: "transitions", cut: null, cutFx: null }));
