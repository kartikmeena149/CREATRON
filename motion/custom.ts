// Animations the AI wrote for this project (agent/custom/<Name>.tsx), by name. The export's
// generated entry and the app's preview both fill this before the Overlay draws.
import type React from "react";

/** What a custom animation gets: its own props from the plan, plus the frame size and its length. */
export type CustomProps = Record<string, unknown> & { width: number; height: number; durationInFrames: number };

const registry = new Map<string, React.ComponentType<CustomProps>>();

export function registerCustom(components: Record<string, React.ComponentType<CustomProps>>) {
  registry.clear();
  for (const [name, c] of Object.entries(components)) registry.set(name, c);
}

export const customComponent = (name: string) => registry.get(name);
