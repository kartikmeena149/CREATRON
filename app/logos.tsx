// The AI makers' logos, shown beside each model so you know at a glance whose it is.
// Files in app/logos/: from LobeHub's icon set (@lobehub/icons-static-svg 1.98.0, MIT), checked to
// be plain drawings. The logos themselves belong to their companies and only name their models.
import claude from "./logos/claude.svg?raw";
import gemini from "./logos/gemini.svg?raw";
import gemma from "./logos/gemma.svg?raw";
import nvidia from "./logos/nvidia.svg?raw";
import openai from "./logos/openai.svg?raw";
import openrouter from "./logos/openrouter.svg?raw";

const LOGOS = { claude, openai, gemini, gemma, nvidia, openrouter };
export type Maker = keyof typeof LOGOS;

/** Whose model this is, from its id ("claude-code/sonnet", "google/gemma-4-31b-it:free", ...). */
export function makerOf(id: string): Maker | undefined {
  if (id.startsWith("claude-code/") || id.startsWith("anthropic/")) return "claude";
  if (id.startsWith("codex/") || id.startsWith("openai/")) return "openai";
  if (id.startsWith("google/gemma")) return "gemma";
  if (id.startsWith("google/")) return "gemini";
  if (id.startsWith("nvidia/")) return "nvidia";
  return undefined;
}

/** A maker's logo at `size` px. One-colour logos (OpenAI, OpenRouter) take the text colour. */
export function Logo({ maker, size = 16, className = "" }: { maker: Maker; size?: number; className?: string }) {
  return (
    <span
      className={`logo ${className}`}
      style={{ width: size, height: size, fontSize: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: LOGOS[maker] }}
    />
  );
}
