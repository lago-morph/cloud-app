import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Strings by which a bundle is recognised as holding the local transfer route or its signing secret (CORE-AC-006). */
const LOCAL_ONLY = [/__framework\/files/, /ticket[_-]?key/i, /SECRET_[A-Z0-9_]*TICKET/, /from "\.\/local\//];

describe("CORE-REQ-006: the local transfer route and its key are omittable from cloud bundles", () => {
  it("only files/local/** mentions the route or the key; shared FILES modules never import it", () => {
    const shared = readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".unit.test.ts") && !f.endsWith(".test-support.ts"));
    expect(shared.length).toBeGreaterThan(0);
    for (const file of shared) {
      const text = readFileSync(path.join(here, file), "utf8");
      for (const pattern of LOCAL_ONLY) expect(pattern.test(text), `${file} matches ${pattern}`).toBe(false);
    }
  });
});
