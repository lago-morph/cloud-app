// The docs' Cloudflare permission tables are generated from the permission list (scripts/permission-tables.mjs,
// DEC-0602): this fails when a committed table differs from `permissionTableMarkdown`, so a change to the list
// that is not followed by `node scripts/permission-tables.mjs` cannot be merged.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BOOTSTRAP, EVERYDAY, permissionTableMarkdown } from "../packages/framework/src/provision/cloudflare/permissions.js";
import { TABLE_FILES, withTables } from "../scripts/permission-tables.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("permission tables in the docs", () => {
  for (const file of TABLE_FILES) {
    it(`${file}: every marked table equals the one generated from the permission list`, () => {
      const text = readFileSync(join(REPO, file), "utf8");
      expect(withTables(text, permissionTableMarkdown, file), `run node scripts/permission-tables.mjs, then commit ${file}`).toBe(text);
    });
  }

  it("every table file holds both tokens' tables", () => {
    for (const file of TABLE_FILES) {
      const text = readFileSync(join(REPO, file), "utf8");
      expect(text, file).toContain("<!-- permission-table: everyday -->");
      expect(text, file).toContain("<!-- permission-table: bootstrap -->");
    }
  });

  it("the generated tables list every group of the list, by ID", () => {
    for (const [kind, list] of [["everyday", EVERYDAY], ["bootstrap", BOOTSTRAP]] as const) {
      const table = permissionTableMarkdown(kind);
      expect(table.trimEnd().split("\n")).toHaveLength(list.length + 2);
      for (const g of list) expect(table).toContain(`\`${g.id}\``);
    }
  });

  it("replaces only what is between the markers, and refuses an unclosed or missing marker", () => {
    const fake = (kind: string): string => `| ${kind} |\n`;
    const text = "a\n<!-- permission-table: everyday -->\nold\nold\n<!-- /permission-table -->\nb\n<!-- permission-table: bootstrap -->\n<!-- /permission-table -->\n";
    expect(withTables(text, fake)).toBe("a\n<!-- permission-table: everyday -->\n| everyday |\n<!-- /permission-table -->\nb\n<!-- permission-table: bootstrap -->\n| bootstrap |\n<!-- /permission-table -->\n");
    expect(() => withTables("<!-- permission-table: everyday -->\nx\n", fake, "f.md")).toThrow(/f\.md: line 1 opens a permission table that is never closed/);
    expect(() => withTables("no tables\n", fake, "g.md")).toThrow(/g\.md: no <!-- permission-table/);
  });
});
