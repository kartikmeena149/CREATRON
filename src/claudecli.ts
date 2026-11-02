// "Claude (your subscription)": the agent (src/agent.ts) runs the Claude Code CLI headless
// (claude -p), signed in with this Mac's Claude plan. For your own testing only: a shipped app
// can't use someone's subscription and needs an API key instead.
import { spawnSync } from "node:child_process";

let available: boolean | undefined;
export const claudeAvailable = () => (available ??= spawnSync("claude", ["--version"]).status === 0);
