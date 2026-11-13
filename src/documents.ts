// Documents the user attaches to a request (a storyboard spreadsheet, a script, notes, a brief),
// read as plain text for the AI. Spreadsheets come out as one table per sheet. Uses only what
// every Mac has (unzip, textutil), plus pdftotext for PDFs when it's installed.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { run } from "./tools.ts";

const DOCS = /\.(xlsx|xlsm|csv|tsv|txt|md|markdown|json|docx|doc|rtf|rtfd|odt|pages|pdf)$/i;
/** How much of a document goes to the AI: plenty for a storyboard or a script. */
const MAX = 40_000;

export const isDocument = (path: string) => DOCS.test(path);

/** The document's text (spreadsheets as tables), cut off at MAX characters. */
export async function readDocument(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  let text: string;
  if (ext === ".xlsx" || ext === ".xlsm") text = await readXlsx(path);
  else if (ext === ".pdf") text = (await run("pdftotext", ["-layout", path, "-"]).catch(() => { throw new Error(`Can't read PDFs yet: install pdftotext (brew install poppler), or attach the text instead.`); })).stdout;
  else if ([".docx", ".doc", ".rtf", ".rtfd", ".odt", ".pages"].includes(ext)) text = (await run("textutil", ["-convert", "txt", "-stdout", path])).stdout;
  else text = readFileSync(path, "utf8");
  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error(`"${path.split("/").pop()}" has no text Creatro can read.`);
  return text.length > MAX ? `${text.slice(0, MAX)}\n…(cut off: the document is longer)` : text;
}

/** Every sheet of an Excel workbook as a table: "## Sheet name", then one row per line, cells split by " | ". */
async function readXlsx(path: string): Promise<string> {
  const part = async (name: string) => (await run("unzip", ["-p", path, name]).catch(() => ({ stdout: "" }))).stdout;
  const workbook = await part("xl/workbook.xml");
  const rels = await part("xl/_rels/workbook.xml.rels");
  const shared = [...(await part("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")]));
  const out: string[] = [];
  for (const [, tag] of workbook.matchAll(/(<sheet\b[^>]*>)/g)) {
    const target = targets.get(attr(tag, "r:id"));
    if (!target) continue;
    const xml = await part(target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    const rows: string[] = [];
    for (const [, row] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const [, open, body = ""] of row.matchAll(/(<c\b[^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = colIndex(attr(open, "r"));
        const type = attr(open, "t");
        const value = type === "s" ? shared[Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1])] ?? ""
          : type === "inlineStr" ? texts(body)
          : unescape(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        cells[col >= 0 ? col : cells.length] = value.replace(/\s*\n\s*/g, " / ").trim();
      }
      if (cells.some(Boolean)) rows.push(Array.from(cells, (c) => c ?? "").join(" | ").replace(/( \| )+$/, ""));
    }
    if (rows.length) out.push(`## Sheet: ${unescape(attr(tag, "name"))}\n${rows.join("\n")}`);
  }
  return out.join("\n\n");
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
/** The text runs inside a cell or shared string. */
const texts = (xml: string) => unescape([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
/** "C7" → 2 (column C). */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0];
  if (!letters) return -1;
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}
