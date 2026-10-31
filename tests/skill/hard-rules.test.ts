/**
 * SKILL-AC-003: "The router states each hard rule, including the `FRAMEWORK-ISSUE.md` entry
 * contents and the next action after recording an entry." (docs/components/skill.md §4,
 * SKILL-REQ-003; Where: Local.)
 *
 * The rules are SKILL-REQ-003's list. skill.md §2 "Implementation" puts them in the router as a
 * numbered list; this test reads the numbered items of the router's "Hard rules" section and
 * requires each rule (every clause of it) to be stated by some item. `<package>` is the framework
 * package (DEC-0049): its name or its binary name is accepted in `npm exec --no -- <package> verify`;
 * `npm run verify` is accepted too. Both never install from the registry (DEC-0616).
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tag } from "../support/tags.js";
import { collapse, numberedItems, read, REPO_ROOT, ROUTER, sections, withoutFrontMatter } from "./support.js";

const pkg = JSON.parse(read(join(REPO_ROOT, "packages", "framework", "package.json"))) as { name: string; bin: Record<string, string> };
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const PACKAGE_COMMAND = new RegExp(`(?:npm run verify|npm exec --no -- (?:${[pkg.name, ...Object.keys(pkg.bin)].map(esc).join("|")}) verify)\\b`);

function hardRuleItems(): string[] {
  const section = sections(withoutFrontMatter(read(ROUTER))).find((s) => s.level >= 2 && /\bhard rules?\b/i.test(s.heading));
  return section === undefined ? [] : numberedItems(section.body);
}

interface Rule {
  readonly name: string;
  /** Every pattern must match one and the same item. */
  readonly clauses: readonly RegExp[];
}

const NOT = String.raw`(?:never|not|no|do not|don't|must not|only)`;

const RULES: readonly Rule[] = [
  { name: "use only the framework's public exports", clauses: [/\bonly\b/i, /\bpublic exports?\b/i] },
  { name: "never insert user text as HTML", clauses: [new RegExp(`\\b${NOT}\\b[^.]*\\binsert\\w*\\b[^.]*\\buser(?:-supplied|-provided)? (?:text|input)\\b[^.]*\\bHTML\\b`, "i")] },
  { name: "pass `npm run verify` before declaring work done", clauses: [new RegExp(`\\bpass\\w*\\b[^.]*${PACKAGE_COMMAND.source}`, "i"), /\bbefore\b[^.]*\b(?:declar\w*|claim\w*|call\w*)\b[^.]*\bdone\b/i] },
  {
    name: "claim an app works on a cloud only after its smoke test passed on a deployed stage there",
    clauses: [/\bclaim\w*\b[^.]*\bworks?\b[^.]*\bcloud\b/i, /\bonly after\b/i, /\bsmoke test\b[^.]*\bpass\w*\b[^.]*\bdeployed\b[^.]*\bstage\b/i],
  },
  { name: "never change framework version pins", clauses: [new RegExp(`\\b${NOT}\\b[^.]*\\bchange\\w*\\b[^.]*\\bframework\\b[^.]*\\bversion pins?\\b`, "i")] },
  {
    name: "record a suspected framework defect in FRAMEWORK-ISSUE.md instead of working around the framework",
    clauses: [/\bsuspect\w*\b[^.]*\bframework defects?\b/i, /FRAMEWORK-ISSUE\.md/, /\b(?:instead of|never|not|rather than)\b[^.]*\bwork(?:ing)?[ -]?around\b/i],
  },
  {
    name: "FRAMEWORK-ISSUE.md entry contents",
    clauses: [/FRAMEWORK-ISSUE\.md/, /\bentr(?:y|ies)\b/i, /\btask attempted\b/i, /\bcontract or reference consulted\b/i, /\bminimal reproduction\b/i, /\bobserved code or diagnostic\b/i, /\bworkaround not taken\b/i],
  },
  {
    name: "next action after recording an entry",
    clauses: [
      /\bafter recording\b/i,
      /\bstop(?:s|ping)? work(?:ing)? on the blocked requirements?\b/i,
      /\bcontinue only (?:with )?(?:the )?work that (?:does not|doesn't|do not) depend on it\b/i,
      /\breport\b[^;.]{0,40}\bissues?\b[^;.]{0,80}\bunfinished requirements\b[^;.]{0,40}\buser\b/i,
      /\b(?:do not|don't|never|not)\b (?:yet )?declare the app done\b/i,
    ],
  },
];

/**
 * plan-v0.2.0 §7a.3 widens two hard rules beyond SKILL-REQ-003's wording, so these carry no
 * criterion tag (plan.md §10.3): rule 3 covers the app's e2e projects, and rule 5's pins include Playwright.
 */
const PLAN_RULES: readonly Rule[] = [
  // plan-v0.2.0 §7a.3: "Hard rule 3 (`verify` before done) widens to cover the app's e2e projects."
  {
    name: "pass verify before declaring work done, covering the app's e2e projects",
    clauses: [new RegExp(`\\bpass\\w*\\b[^.]*${PACKAGE_COMMAND.source}`, "i"), /\be2e-api\b/i, /\be2e[:-]ui\b/i],
  },
  // plan-v0.2.0 §7a.3: "pinned Playwright, added to the hard-rule-5 pins".
  { name: "the framework version pins include Playwright", clauses: [new RegExp(`\\b${NOT}\\b[^.]*\\bchange\\w*\\b[^.]*\\bframework\\b[^.]*\\bversion pins?\\b`, "i"), /@playwright\/test/] },
];

describe("SKILL: the router's hard rules", () => {
  const items = hardRuleItems();

  it(tag("SKILL-AC-003", "the router has a \"Hard rules\" section with numbered rules"), () => {
    expect(items.length, "numbered items in the router's Hard rules section").toBeGreaterThan(0);
  });

  for (const rule of RULES) {
    it(tag("SKILL-AC-003", `the router's hard rules state: ${rule.name}`), () => {
      const plain = items.map(collapse);
      const hit = plain.some((item) => rule.clauses.every((c) => c.test(item)));
      if (!hit) {
        const best = plain
          .map((item) => ({ item, missing: rule.clauses.filter((c) => !c.test(item)).map(String) }))
          .sort((a, b) => a.missing.length - b.missing.length)[0];
        expect.fail(`no hard rule states "${rule.name}"; closest item misses ${JSON.stringify(best?.missing ?? [])}: ${best?.item.slice(0, 200) ?? "(none)"}`);
      }
    });
  }
});

describe("SKILL: hard rules widened by plan-v0.2.0 §7a.3", () => {
  const items = hardRuleItems().map(collapse);
  for (const rule of PLAN_RULES) {
    it(`the router's hard rules state: ${rule.name}`, () => {
      expect(items.some((item) => rule.clauses.every((c) => c.test(item))), rule.name).toBe(true);
    });
  }
});
