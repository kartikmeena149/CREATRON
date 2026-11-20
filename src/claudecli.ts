// "Claude (your subscription)": the agent (src/agent.ts) runs the Claude Code CLI headless
// (claude -p), signed in with this Mac's Claude plan. For your own testing only: a shipped app
// can't use someone's subscription and needs an API key instead.
import { spawn, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";

let available: boolean | undefined;
export const claudeAvailable = () => (available ??= spawnSync("claude", ["--version"]).status === 0);

/**
 * One question to Claude: the text of its answer. Plain by default (no editing, nothing to read);
 * `tools` lets it use just those for this one task (WebSearch and WebFetch to look something up on
 * the web, Read to look at a picture in `cwd`), allowed without asking, and nothing else.
 */
export function askClaude(model: string, prompt: string, opts: { tools?: string[]; cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  // Same clean environment as the agent: the plan's sign-in, not an API key or a parent session's settings.
  const env = { HOME: homedir(), USER: process.env.USER ?? "", PATH: process.env.PATH ?? "", LANG: process.env.LANG ?? "en_US.UTF-8", TMPDIR: tmpdir() };
  const tools = opts.tools?.length ? opts.tools.join(",") : "Read";
  const args = [
    "-p", "--model", model, "--output-format", "json", "--restricted", "--tools", tools,
    ...(opts.tools?.length ? ["--allowedTools", tools] : []),
    "--strict-mcp-config", "--setting-sources", "project", "--disable-slash-commands",
  ];
  return new Promise((ok, fail) => {
    const child = spawn("claude", args, { env, cwd: opts.cwd ?? tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs) : undefined;
    child.on("close", () => clearTimeout(timer));
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => fail(new Error(`could not start claude: ${e.message}`)));
    child.on("close", () => {
      try {
        const out = JSON.parse(stdout);
        if (out.is_error) return fail(new Error(`Claude ${out.api_error_status ?? "error"}: ${out.result ?? "unknown error"}`));
        ok(String(out.result ?? "").trim());
      } catch {
        fail(new Error(`Claude error: ${(stderr || stdout).trim().slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}
