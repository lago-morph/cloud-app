// Every reference to the runbook that the runner prints points at the section and step it means.
// Root-cause record 2026-11-08-live-pass-closing-text-section.md: the closing text named section 4
// for the analysis after the runbook was renumbered (DEC-0793). A reference is written
// `the runbook's section N ("Heading")` or `the runbook's section "Heading"` (an unnumbered section),
// optionally followed by `, step M`; the test reads the runbook's headings and numbered steps at run time.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNBOOK = readFileSync(join(HERE, "..", "..", "ai", "implementation", "live-pass-v0.2.0.md"), "utf8");
const SOURCES = [join(HERE, "live-pass.mjs"), ...readdirSync(join(HERE, "lib")).filter((f) => f.endsWith(".mjs")).map((f) => join(HERE, "lib", f))];
/** Source lines that are code, not comments (a comment's reference is not printed). */
const printed = (file: string) => readFileSync(file, "utf8").split("\n").map((line, i) => ({ file: file.slice(HERE.length + 1), line: i + 1, text: line })).filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l.text));

/** The runbook's `## ` sections: number (or "") → { heading, body }. */
function sections() {
  const out: { n: string; heading: string; body: string }[] = [];
  const parts = RUNBOOK.split(/^## /m).slice(1);
  for (const p of parts) {
    const [first, ...rest] = p.split("\n");
    const m = first.match(/^(?:(\d+)\. )?(.+)$/)!;
    out.push({ n: m[1] ?? "", heading: m[2].trim(), body: rest.join("\n") });
  }
  return out;
}

const REF = /runbook's section (?:(\d+) \("([^"]+)"\)|"([^"]+)")(?:, step (\d+))?/g;

describe("the runner's references to the runbook", () => {
  const lines = SOURCES.flatMap(printed);
  const refs = lines.flatMap((l) => [...l.text.matchAll(REF)].map((m) => ({ ...l, n: m[1], heading: m[2] ?? m[3], step: m[4] })));

  it("are all in the checkable form, naming the section's heading", () => {
    // Whatever is left after the checkable references are taken out must not point into the runbook.
    const loose = lines.filter((l) => /runbook('s)? section|runbook says \(/i.test(l.text.replace(REF, "")));
    expect(loose.map((l) => `${l.file}:${l.line}`)).toEqual([]);
    expect(refs.length).toBeGreaterThanOrEqual(4);
  });

  it("name a section that exists with that number and heading, and a step that exists in it", () => {
    const all = sections();
    for (const r of refs) {
      const where = `${r.file}:${r.line}`;
      const s = all.find((x) => x.heading === r.heading);
      expect(s, `${where}: no runbook section "${r.heading}"`).toBeDefined();
      if (r.n !== undefined) expect(s!.n, `${where}: "${r.heading}" is section ${s!.n}, not ${r.n}`).toBe(r.n);
      if (r.step !== undefined) expect(s!.body, `${where}: section "${r.heading}" has no step ${r.step}`).toMatch(new RegExp(`^${r.step}\\. `, "m"));
    }
  });

  it("send the owner to the analysis section at the end of the pass", () => {
    const finish = refs.filter((r) => r.file === "live-pass.mjs" && /analysis session/.test(r.text));
    expect(finish.length).toBe(1);
    expect(finish[0].heading).toMatch(/analysis/i);
  });
});
