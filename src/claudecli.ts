// "Claude (your subscription)": runs the planner through the Claude Code CLI in headless mode
// (claude -p), which uses the Claude plan this Mac's `claude` is signed in with. For your own
// testing only: a shipped app can't use someone's subscription and needs an API key instead.
// Claude Code has no function tools of its own here, so each turn asks for one JSON object,
// {tool, arguments}, checked against a schema, and hands it back shaped like an OpenAI tool call.
import { spawn, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";

let available: boolean | undefined;
export const claudeAvailable = () => (available ??= spawnSync("claude", ["--version"]).status === 0);

type Tool = { type: "function"; function: { name: string; description?: string; parameters: unknown } };

/** One planner turn through `claude -p`. Returns { choices: [{ message }] } like the chat API. */
export async function claudeChat(model: string, messages: any[], tools: Tool[], toolChoice: unknown): Promise<any> {
  const forced = typeof toolChoice === "object" && toolChoice ? (toolChoice as any).function?.name : undefined;
  const allowed = tools.filter((t) => !forced || t.function.name === forced);
  // Claude Code's structured output takes one schema, without a choice of shapes at the top: with
  // one tool its arguments are checked exactly; with several, the planner checks them itself.
  const schema = {
    type: "object",
    properties: {
      tool: { type: "string", enum: allowed.map((t) => t.function.name) },
      arguments: allowed.length === 1 ? allowed[0].function.parameters : { type: "object" },
    },
    required: ["tool", "arguments"],
  };
  const system = [
    messages.find((m) => m.role === "system")?.content ?? "",
    "",
    "HOW TO ANSWER: each reply is exactly one tool call as JSON {\"tool\": name, \"arguments\": {...}}. Tools and their arguments (JSON Schema):",
    ...allowed.map((t) => `- ${t.function.name}: ${t.function.description ?? ""}\n  arguments: ${JSON.stringify(t.function.parameters)}`),
    forced ? `Call ${forced} now.` : "",
  ].join("\n");
  const out = await runClaude(model.replace(/^claude-code\//, ""), system, transcript(messages), JSON.stringify(schema));
  if (out.is_error) throw new Error(`Claude ${out.api_error_status ?? "error"}: ${out.result ?? "unknown error"}`);
  const call = out.structured_output ?? JSON.parse(String(out.result ?? "null"));
  if (!call?.tool) throw new Error("Claude didn't answer with a tool call");
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: `c${Date.now().toString(36)}`, type: "function", function: { name: call.tool, arguments: JSON.stringify(call.arguments ?? {}) } }],
        },
      },
    ],
    usage: { prompt_tokens: out.usage?.input_tokens ?? 0, completion_tokens: out.usage?.output_tokens ?? 0 },
  };
}

/** The conversation so far as plain text (claude -p takes one prompt, not a message list). */
function transcript(messages: any[]): string {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "user") return `USER:\n${m.content}`;
      if (m.role === "tool") return `RESULT:\n${m.content}`;
      const calls = (m.tool_calls ?? []).map((c: any) => `${c.function.name} ${c.function.arguments}`).join("\n");
      return `YOU CALLED:\n${calls || m.content || ""}`;
    })
    .join("\n\n");
}

/** Runs claude -p with no tools, settings or MCP servers of its own, prompt on stdin. */
function runClaude(model: string, system: string, prompt: string, schema: string): Promise<any> {
  // A clean environment: no API key (that would bill the API instead of the plan) and none of a
  // parent Claude session's settings, so it's the same whether the app was opened from Finder or a terminal.
  const env = { HOME: homedir(), USER: process.env.USER ?? "", PATH: process.env.PATH ?? "", LANG: process.env.LANG ?? "en_US.UTF-8", TMPDIR: tmpdir() };
  const args = [
    "-p", "--model", model, "--output-format", "json", "--json-schema", schema, "--system-prompt", system,
    "--tools", "", "--strict-mcp-config", "--no-session-persistence",
  ];
  return new Promise((ok, fail) => {
    const child = spawn("claude", args, { env, cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => fail(new Error(`could not start claude: ${e.message}`)));
    child.on("close", () => {
      try {
        ok(JSON.parse(stdout));
      } catch {
        fail(new Error(`Claude error: ${(stderr || stdout).trim().slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}
