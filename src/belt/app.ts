// Talking to the Creatro app: commands that need Chrome or the Vision helper run in the app during
// an AI job (the agent's shell may not start them), and B-roll comes from the app (it holds the keys).
import { request } from "node:http";
import { EXIT_MARK } from "../project.ts";
import { fail } from "./context.ts";

/**
 * Runs this command in the app and prints what it prints. Returns its exit code, or nothing when
 * the app couldn't be reached at all (then nothing has run yet).
 */
export function inApp(url: string, argv: string[]): Promise<number | undefined> {
  return new Promise((ok) => {
    const req = request(`${url}/tool`, { method: "POST" }, (res) => {
      if (res.statusCode !== 200) return res.resume(), ok(undefined);
      let tail = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => {
        // Everything is printed as it comes, except a last piece that may be (part of) the exit line.
        tail += d;
        const at = tail.lastIndexOf(EXIT_MARK[0]!);
        const keep = at >= 0 ? at : tail.length;
        process.stdout.write(tail.slice(0, keep));
        tail = tail.slice(keep);
      });
      const finish = () => {
        const m = tail.startsWith(EXIT_MARK) ? Number(tail.slice(EXIT_MARK.length)) : NaN;
        if (Number.isNaN(m)) console.error("error: Creatro stopped answering before the command finished. Run it again: finished render pieces are kept.");
        ok(Number.isNaN(m) ? 1 : m);
      };
      res.on("end", finish);
      res.on("error", finish);
    });
    req.on("error", () => ok(undefined));
    req.end(JSON.stringify({ args: argv }));
  });
}

/** B-roll search and download happen in Creatro itself (it has the keys); this just asks it. */
export async function broker(what: string, rest: string[]) {
  const url = process.env.CREATRON_BROKER ?? fail("Creatro isn't listening for B-roll requests");
  const res = await fetch(`${url}/broll/${what}`, { method: "POST", body: JSON.stringify({ args: rest }) }).catch((e) => fail(`couldn't reach Creatro: ${e.message}`));
  const text = await res.text();
  if (!res.ok) fail(text);
  console.log(text);
}

