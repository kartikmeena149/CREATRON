// Connectors: the AI accounts Creatron can edit with, each signed in by the user on this Mac.
//  - Claude: the Claude Code app (claude), signed in with a Claude plan.
//  - ChatGPT: OpenAI's Codex app (codex), signed in with a ChatGPT plan.
//  - OpenRouter: an API key (pay per use, or free models), kept in Creatron's .env.
// This module is the only place that starts these apps for sign-in, sign-out, install and status.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./tools.ts";

import type { AgentId, AgentState } from "./chatTypes.ts";
export type { AgentId, AgentState };

/** The apps' own command names, and how to install each (npm puts them on the PATH). */
const BIN: Record<AgentId, string> = { claude: "claude", codex: "codex" };
const PACKAGE: Record<AgentId, string> = { claude: "@anthropic-ai/claude-code", codex: "@openai/codex" };
export const INSTALL_COMMAND = (id: AgentId) => `npm install -g ${PACKAGE[id]}`;

// A clean environment: the user's own sign-in, never an API key from Creatron's .env (that would
// bill an API account instead of their plan).
export const cleanEnv = () => ({ HOME: homedir(), USER: process.env.USER ?? "", PATH: process.env.PATH ?? "", LANG: process.env.LANG ?? "en_US.UTF-8", TMPDIR: tmpdir() });

const busy = new Map<AgentId, { kind: AgentState["busy"]; child: ReturnType<typeof spawn> }>();
const lastError = new Map<AgentId, string>();

function version(id: AgentId): string | undefined {
  const r = spawnSync(BIN[id], ["--version"], { env: cleanEnv(), encoding: "utf8", timeout: 10_000 });
  return r.status === 0 ? r.stdout.trim().split("\n")[0].replace(/\s*\(.*\)$/, "") : undefined;
}

/** Whether the app is installed and signed in. Asks the app itself; nothing is sent anywhere. */
export function agentState(id: AgentId): AgentState {
  const v = version(id);
  const b = busy.get(id);
  const base = { busy: b?.kind, error: lastError.get(id) };
  if (!v) return { installed: false, signedIn: false, ...base };
  if (id === "claude") {
    const r = spawnSync("claude", ["auth", "status", "--json"], { env: cleanEnv(), encoding: "utf8", timeout: 15_000, cwd: tmpdir() });
    try {
      const s = JSON.parse(r.stdout);
      const plan = s.subscriptionType ? `Claude ${String(s.subscriptionType).replace(/^\w/, (c: string) => c.toUpperCase())}` : "Claude plan";
      return { installed: true, version: v, signedIn: Boolean(s.loggedIn), account: s.loggedIn ? (s.authMethod === "api_key" ? "API key" : plan) : undefined, ...base };
    } catch {
      return { installed: true, version: v, signedIn: false, ...base };
    }
  }
  // codex login status: exit 0 and "Logged in using ChatGPT" (or "...an API key") when signed in.
  const r = spawnSync("codex", ["login", "status"], { env: cleanEnv(), encoding: "utf8", timeout: 15_000 });
  const text = `${r.stdout}\n${r.stderr}`;
  const signedIn = r.status === 0 && /logged in/i.test(text) && !/not logged in/i.test(text);
  return { installed: true, version: v, signedIn, account: signedIn ? (/api key/i.test(text) ? "API key" : "ChatGPT plan") : undefined, ...base };
}

/**
 * Signs in through the browser: the app opens the provider's sign-in page and waits for it. Resolves
 * when the app finishes (signed in, closed, or cancelled). `changed` fires when the state moves.
 */
export function signIn(id: AgentId, changed: () => void): Promise<void> {
  if (busy.has(id)) return Promise.resolve();
  lastError.delete(id);
  const args = id === "claude" ? ["auth", "login", "--claudeai"] : ["login"];
  return run(id, "signing-in", BIN[id], args, changed, "Sign-in didn't finish");
}

export function signOut(id: AgentId): void {
  lastError.delete(id);
  spawnSync(BIN[id], id === "claude" ? ["auth", "logout"] : ["logout"], { env: cleanEnv(), timeout: 15_000 });
}

/** Installs the app with npm (only when the user presses Install). */
export function install(id: AgentId, changed: () => void): Promise<void> {
  if (busy.has(id)) return Promise.resolve();
  lastError.delete(id);
  const npm = spawnSync("npm", ["--version"], { env: cleanEnv(), timeout: 10_000 });
  if (npm.status !== 0) {
    lastError.set(id, `npm isn't installed. Install Node.js from nodejs.org, then press Install again (or run: ${INSTALL_COMMAND(id)}).`);
    changed();
    return Promise.resolve();
  }
  return run(id, "installing", "npm", ["install", "-g", PACKAGE[id]], changed, "Install failed");
}

/** Stops a sign-in or install that's waiting. */
export function cancel(id: AgentId): void {
  busy.get(id)?.child.kill();
}

function run(id: AgentId, kind: AgentState["busy"], cmd: string, args: string[], changed: () => void, failure: string): Promise<void> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    busy.set(id, { kind, child });
    changed();
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const finish = (code: number | null, err?: Error) => {
      busy.delete(id);
      if (err) lastError.set(id, `${failure}: ${err.message}`);
      else if (code !== 0 && code !== null) lastError.set(id, `${failure}: ${out.trim().split("\n").slice(-2).join(" ").slice(0, 200) || `exit ${code}`}`);
      changed();
      done();
    };
    child.on("close", (code) => finish(code));
    child.on("error", (e) => finish(null, e));
  });
}

// ---- Which connectors the chat may use (the user's switches), kept next to the app's work files.

const SETTINGS = () => join(ROOT, "work", "connections.json");
export type Enabled = Record<AgentId, boolean>;
export function enabled(): Enabled {
  try {
    return { claude: true, codex: true, ...JSON.parse(readFileSync(SETTINGS(), "utf8")) };
  } catch {
    return { claude: true, codex: true };
  }
}
export function setEnabled(id: AgentId, on: boolean): void {
  mkdirSync(join(ROOT, "work"), { recursive: true });
  writeFileSync(SETTINGS(), JSON.stringify({ ...enabled(), [id]: on }, null, 2));
}

// ---- OpenRouter: an API key in Creatron's own .env (never sent anywhere but OpenRouter).

export function openRouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || undefined;
}

/** Saves (or with "" removes) the OpenRouter key in .env and uses it right away. */
export function setOpenRouterKey(key: string): void {
  const file = join(ROOT, ".env");
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*OPENROUTER_API_KEY\s*=/.test(l)) : [];
  if (key) lines.push(`OPENROUTER_API_KEY=${key.trim()}`);
  writeFileSync(file, lines.filter((l, i, a) => l || i < a.length - 1).join("\n") + "\n");
  if (key) process.env.OPENROUTER_API_KEY = key.trim();
  else delete process.env.OPENROUTER_API_KEY;
}

/** One plain question to ChatGPT through Codex, read-only (used to improve a prompt). */
export function askCodex(prompt: string): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn("codex", ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-"], { env: cleanEnv(), cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => fail(new Error(`could not start Codex: ${e.message}`)));
    child.on("close", () => {
      const lines = out.split("\n").flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      const failed = lines.find((e) => e.type === "turn.failed" || e.type === "error");
      if (failed) return fail(new Error(`ChatGPT error: ${failed.error?.message ?? failed.message ?? "unknown"}`));
      const text = lines.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").map((e) => e.item.text).join("\n").trim();
      text ? ok(text) : fail(new Error(`ChatGPT error: ${(err || out).trim().slice(0, 300) || "no reply"}`));
    });
    child.stdin.end(prompt);
  });
}
