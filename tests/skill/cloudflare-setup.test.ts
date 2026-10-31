/**
 * SKILL-AC-007 and SKILL-AC-008 (docs/components/skill.md §4, SKILL-REQ-007, SKILL-REQ-008;
 * Where: Local):
 * - SKILL-AC-007: "The router's front matter description contains "set up Cloudflare", "continue
 *   prototype setup", "continue setup" and `/prototype-framework`; the router names
 *   `npm run version-check` (or `npm exec --no -- <package> version-check`) as the first step of a
 *   session, with its newer-npm-release suggestion once per session, names no
 *   `npx prototype-framework`, and says to skip the check while the app is not installed; and its "Cloudflare setup" section runs `npm run cloudflare-setup`
 *   on those phrases and says to relay its output as is."
 * - SKILL-AC-008: "The router says never to open, print or search `.env.cloudflare` and never to
 *   echo `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_BOOTSTRAP_TOKEN`; it gives both git commands, when to
 *   run them (a session starting work on the app, before every commit or push), to remind the user
 *   when either finds a problem, and never to refuse a commit. The template's `.claude/settings.json`
 *   parses as JSON and its `permissions.deny` holds `Read(.env.cloudflare)`, and an app made with
 *   the starter has the same file."
 *
 * Written from the criteria. Each statement must be made in one sentence of the router (prose
 * outside code blocks, emphasis and code ticks removed), so a word in one place and its object in
 * another does not pass. `<package>` is the framework package or its binary name (DEC-0049). The
 * command must be one that never installs from the registry (DEC-0616): `npm run version-check` or
 * `npm exec --no -- <package> version-check`. `npx prototype-framework` fails: when the app is not
 * installed, npx would download and run whatever is published under the unscoped name. The
 * starter's copy is checked here with the starter's own `create` from the repository's template;
 * the packed starter's copy is checked by the offline run (tests/compliance/criteria/setup/
 * starter-offline.test.ts).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../support/tags.js";
import { filesUnder, read, repoPath, REPO_ROOT, ROUTER, sections, SKILL_DIR, withoutFrontMatter } from "./support.js";

/** Whitespace collapsed, emphasis stars and code ticks removed (underscores kept: they are in the variable names). */
const flat = (text: string): string => text.replace(/[*`]/g, "").replace(/\s+/g, " ").trim();

const pkg = JSON.parse(read(join(REPO_ROOT, "packages", "framework", "package.json"))) as { name: string; bin: Record<string, string> };
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const NAMES = [pkg.name, ...Object.keys(pkg.bin)].map(esc).join("|");
/** The safe forms (DEC-0616): the app's npm script, or `npm exec --no` (which refuses to install). */
const VERSION_CHECK = new RegExp(`(?:npm run version-check|npm exec --no -- (?:${NAMES}) version-check)\\b`);
/** npx of the unscoped binary name, or npx told to install without asking: either may run a stranger's package. */
const UNSAFE_NPX = /\bnpx\s+(?:prototype-framework\b|-y\b|--yes\b)/;
const PHRASES = ["set up Cloudflare", "continue prototype setup", "continue setup"] as const;
const TEMPLATE_SETTINGS = join(REPO_ROOT, "apps", "template", ".claude", "settings.json");

/** The router's front-matter `description` (one line, quoted or not, or a folded block). */
function description(text: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (m === null) return "";
  const lines = (m[1] ?? "").split("\n");
  const at = lines.findIndex((l) => /^description:/.test(l));
  if (at < 0) return "";
  const first = (lines[at] ?? "").replace(/^description:\s*/, "");
  if (/^[>|][-+]?$/.test(first.trim())) {
    const block: string[] = [];
    for (const l of lines.slice(at + 1)) {
      if (!/^\s/.test(l)) break;
      block.push(l.trim());
    }
    return block.join(" ");
  }
  return first.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
}

/** `text` without fenced code blocks (inline code is kept: the commands and file names are in it). */
function withoutFences(text: string): string {
  let inFence = false;
  return text
    .split("\n")
    .filter((line) => {
      if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence;
        return false;
      }
      return !inFence;
    })
    .join("\n");
}

/** The router's prose sentences: front matter and fenced code removed; paragraphs and list items end a sentence; collapsed. */
function sentences(text: string): string[] {
  const blocks = withoutFences(withoutFrontMatter(text))
    .split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+[.)])\s)|\n(?=#)/)
    .map(flat)
    .filter((b) => b !== "");
  return blocks.flatMap((b) => b.split(/(?<=[.!?])\s+(?=[A-Z"(])/)).map((x) => x.trim()).filter((x) => x !== "");
}

/** The router's raw text with only front matter removed (code ticks kept, for command lookups). */
const routerText = (): string => withoutFrontMatter(read(ROUTER));

/** A sentence matching every pattern, or undefined. */
const sentenceWith = (all: readonly string[], patterns: readonly RegExp[]): string | undefined => all.find((s) => patterns.every((p) => p.test(s)));

describe("SKILL: Cloudflare setup in the router", () => {
  const text = read(ROUTER);
  const all = sentences(text);

  it(tag("SKILL-AC-007", "the front matter description lists the trigger phrases and the /prototype-framework invocation"), () => {
    const d = description(text);
    expect(d, "a description in the front matter").not.toBe("");
    for (const phrase of PHRASES) expect(d, `the phrase "${phrase}"`).toContain(phrase);
    expect(d).toContain("/prototype-framework");
  });

  it(tag("SKILL-AC-007", "the first step of a session is npm run version-check, its newer-npm-release suggestion relayed once per session"), () => {
    const raw = flat(routerText());
    expect(raw, "the version-check command").toMatch(VERSION_CHECK);
    expect(raw, "no npx of the unscoped name (it would install from the registry when the app is not installed)").not.toMatch(UNSAFE_NPX);
    expect(sentenceWith(all, [/version-check|check/i, /not (?:yet )?installed|npm install|node_modules/i, /skip/i]), "what to do when the app is not installed yet: skip the check").toBeDefined();
    const first = sentenceWith(all, [/first step/i, /session/i, /version-check/]);
    expect(first, "one sentence makes version-check the first step of every session").toBeDefined();
    expect(flat(routerText()).match(new RegExp(`first step[^.]*session[^.]*${VERSION_CHECK.source}|${VERSION_CHECK.source}[^.]*first step`, "i")), "the command in that statement").not.toBeNull();
    expect(sentenceWith(all, [/npm/i, /newer|new release|latest/i, /once per session/i]), "the newer-npm-release suggestion once per session").toBeDefined();
  });

  it(tag("SKILL-AC-007", 'its "Cloudflare setup" section runs npm run cloudflare-setup on the three phrases and says to relay its output as is'), () => {
    const section = sections(withoutFrontMatter(text)).find((s) => s.level >= 2 && /cloudflare setup/i.test(s.heading));
    expect(section, 'a "Cloudflare setup" section').toBeDefined();
    const body = flat(section?.body ?? "");
    expect(body).toContain("npm run cloudflare-setup");
    for (const phrase of PHRASES) expect(body, `the phrase "${phrase}" in the section`).toContain(phrase);
    const run = sentences(section?.body ?? "").find((s) => s.includes("npm run cloudflare-setup") && PHRASES.every((p) => s.includes(p)));
    expect(run, "one sentence: on the phrases, run npm run cloudflare-setup").toBeDefined();
    expect(run ?? "", "and relay its output as is").toMatch(/relay[^.]*output[^.]*as is/i);
  });

  it(tag("SKILL-AC-008", "never open, print or search .env.cloudflare, and never echo CLOUDFLARE_API_TOKEN or CLOUDFLARE_BOOTSTRAP_TOKEN"), () => {
    expect(sentenceWith(all, [/never/i, /\bopen\b/i, /\bprint\b/i, /\bsearch\b/i, /\.env\.cloudflare/]), "never open, print or search the file").toBeDefined();
    expect(sentenceWith(all, [/never/i, /\becho\b/i, /CLOUDFLARE_API_TOKEN/, /CLOUDFLARE_BOOTSTRAP_TOKEN/]), "never echo either token variable").toBeDefined();
  });

  it(tag("SKILL-AC-008", "both git commands, when to run them, a reminder when either finds a problem, and never refusing a commit"), () => {
    const raw = flat(routerText());
    expect(raw).toContain("git check-ignore -q .env.cloudflare");
    expect(raw).toContain("git ls-files --error-unmatch .env.cloudflare");
    const when = sentenceWith(all, [/git check-ignore -q \.env\.cloudflare/, /git ls-files --error-unmatch \.env\.cloudflare/]) ?? "";
    const context = all.slice(Math.max(0, all.indexOf(when) - 1), all.indexOf(when) + 3).join(" ");
    expect(context, "when a session starts work on the app").toMatch(/session starts work/i);
    expect(context, "before every commit or push").toMatch(/before every commit or push/i);
    expect(context, "remind the user").toMatch(/remind the user/i);
    expect(sentenceWith(all, [/never refuse/i, /commit/i]), "never refuse to commit").toBeDefined();
  });
});

describe("SKILL: no command text installs the framework from the registry (DEC-0616)", () => {
  it("no skill file, quickstart, template or package README runs npx prototype-framework or npx --yes", () => {
    const files = [
      ...filesUnder(SKILL_DIR),
      ...filesUnder(join(REPO_ROOT, "apps", "template")),
      join(REPO_ROOT, "QUICKSTART.md"),
      join(REPO_ROOT, "packages", "framework", "README.md"),
      join(REPO_ROOT, "packages", "create-prototype-app", "README.md"),
      join(REPO_ROOT, "packages", "prototype-framework-skill", "README.md"),
      join(REPO_ROOT, "packages", "framework", "src", "testing", "connect.ts"),
    ];
    const found = files.flatMap((f) =>
      read(f)
        .split("\n")
        .flatMap((line, i) => (UNSAFE_NPX.test(line) ? [`${repoPath(f)}:${String(i + 1)}`] : [])),
    );
    expect(found).toEqual([]);
  });
});

describe("SKILL: the template's .claude/settings.json", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it(tag("SKILL-AC-008", "the template's .claude/settings.json parses as JSON and its permissions.deny holds Read(.env.cloudflare)"), () => {
    const settings = JSON.parse(readFileSync(TEMPLATE_SETTINGS, "utf8")) as { permissions?: { deny?: unknown } };
    const deny = settings.permissions?.deny;
    expect(Array.isArray(deny), "permissions.deny is a list").toBe(true);
    expect((deny as unknown[]).every((r) => typeof r === "string"), "every rule is a string").toBe(true);
    expect(deny).toContain("Read(.env.cloudflare)");
  });

  it(tag("SKILL-AC-008", "an app made with the starter's create from the repository's template has the same .claude/settings.json"), async () => {
    const { create } = (await import(pathToFileURL(join(REPO_ROOT, "packages", "create-prototype-app", "lib", "create.mjs")).href)) as {
      create(options: { target: string; templateDir: string; skillDir?: string | null; frameworkSpec: string }): { target: string };
    };
    const root = mkdtempSync(join(tmpdir(), "skill-ac-008-"));
    roots.push(root);
    const app = create({ target: join(root, "myapp"), templateDir: join(REPO_ROOT, "apps", "template"), skillDir: join(REPO_ROOT, "skill"), frameworkSpec: "0.0.0-test" });
    expect(readFileSync(join(app.target, ".claude", "settings.json"), "utf8")).toBe(readFileSync(TEMPLATE_SETTINGS, "utf8"));
  });

  // plan-v0.2.0 §7a.3 (TS-14): installing the framework never creates or changes an app's CI.
  it("an app made with the starter's create has no CI file", async () => {
    const { create } = (await import(pathToFileURL(join(REPO_ROOT, "packages", "create-prototype-app", "lib", "create.mjs")).href)) as {
      create(options: { target: string; templateDir: string; skillDir?: string | null; frameworkSpec: string }): { target: string };
    };
    const root = mkdtempSync(join(tmpdir(), "starter-no-ci-"));
    roots.push(root);
    const app = create({ target: join(root, "myapp"), templateDir: join(REPO_ROOT, "apps", "template"), skillDir: join(REPO_ROOT, "skill"), frameworkSpec: "0.0.0-test" });
    const CI = /^(?:\.github\/|\.gitlab-ci\.ya?ml$|\.circleci\/|\.buildkite\/|azure-pipelines\.ya?ml$|bitbucket-pipelines\.ya?ml$|\.travis\.ya?ml$|Jenkinsfile$|\.woodpecker)/;
    const files = filesUnder(app.target).map((f) => relative(app.target, f).split(sep).join("/"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => CI.test(f))).toEqual([]);
  });
});
