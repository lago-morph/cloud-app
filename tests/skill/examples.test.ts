/**
 * SKILL-AC-004: "CI type-checks and runs every example and the template." (docs/components/skill.md
 * §4, SKILL-REQ-004; Where: Local.) The examples' code is type-checked and tested where it lives,
 * by each app's `verify` (skill.md §2 "Implementation"), so this runs both apps' `verify` and
 * requires exit 0. The file-only checks (byte-for-byte copies, no `apps/demo/`, sources inside
 * what `verify` covers, root `verify` wiring) are in `example-copies.test.ts`. This file is the
 * only place CI and release run the apps' `verify` (DEC-0641): ci.yml selects it with SKILL and
 * no longer runs them itself. Root `npm run verify`, a developer command, runs them directly.
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { tag } from "../support/tags.js";
import { REPO_ROOT } from "./support.js";

const APPS = ["apps/template", "apps/reference"] as const;
const VERIFY_TIMEOUT = 15 * 60_000;

describe("SKILL: the apps the examples are copied from pass verify", () => {
  for (const app of APPS) {
    it(
      tag("SKILL-AC-004", `${app}'s verify (type-check, rules, migrations, tests per dialect) passes, covering the examples copied from it and${app === "apps/template" ? " the template itself" : " the reference app"}`),
      () => {
        const r = spawnSync("npm", ["--workspace", app, "run", "verify"], { cwd: REPO_ROOT, encoding: "utf8", timeout: VERIFY_TIMEOUT - 60_000 });
        const out = `${r.stdout}\n${r.stderr}`;
        expect(r.status, `exit ${String(r.status)}\n${out.slice(-4000)}`).toBe(0);
      },
      VERIFY_TIMEOUT,
    );
  }
});
