/**
 * The framework section's changed fields (docs/components/config.md §2 "Build failures",
 * DEC-0513, DEC-0514): `framework.email` holds only `senderName`, and `framework.google` is no
 * longer part of the stage-config schema.
 *
 * - CFG-AC-006: "A values file containing an unknown field is rejected by schema validation":
 *   `framework.google` is now such a field, and so is any `framework.email` field but `senderName`.
 * - MAIL-AC-005: "The stage-config schema rejects any `framework.email` field other than
 *   `senderName`."
 *
 * Checked through the build (`build --target local --stage local` in a scratch copy of the
 * reference app, whose committed `config/local.json` is edited there): a refused file fails the
 * build, and the printed message names the file and reports the field as an unknown field, the
 * form of a schema violation (config.md §2 "Build failures", DEC-0152); `senderName` alone builds.
 *
 * Neither criterion requires the error code in the CLI's output. The build's error is a
 * `CORE.MISCONFIGURED` FrameworkError (config.md §2), but a CLI failure prints only its message
 * (cli.md §2 "Implementation"), so the code is not asserted in the output.
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { cli, scratchCopy, type ScratchApp } from "../core/support/processes.js";
import { isLocal, REFERENCE_DIR } from "../core/support/repo.js";

async function buildWith(copy: ScratchApp, framework: Record<string, unknown>): Promise<{ status: number | null; output: string }> {
  const values = JSON.parse(await copy.read("config/local.json")) as { values?: unknown; framework?: Record<string, unknown> };
  await copy.write("config/local.json", JSON.stringify({ ...values, framework: { ...(values.framework ?? {}), ...framework } }, null, 2));
  return cli(["build", "--target", "local", "--stage", "local"], { cwd: copy.dir, timeoutMs: 300_000 });
}

if (isLocal()) {
  describe("CFG: framework.email and the retired framework.google", () => {
    it(
      tag("CFG-AC-006", "a values file with framework.google, or with a framework.email field other than senderName, fails the build naming the field; senderName alone builds"),
      async () => {
        const copy = await scratchCopy(REFERENCE_DIR, "cfg-email");
        try {
          const original = await copy.read("config/local.json");
          const refused: { what: string; framework: Record<string, unknown>; field: string }[] = [
            { what: "framework.google (retired, DEC-0513)", framework: { google: { clientId: "client-id.example" } }, field: "google" },
            { what: "framework.email.from (an address is not configurable, MAIL-REQ-003)", framework: { email: { senderName: "Reference", from: "no-reply@example.test" } }, field: "from" },
            { what: "framework.email.domain", framework: { email: { domain: "example.test" } }, field: "domain" },
          ];
          for (const c of refused) {
            await copy.write("config/local.json", original);
            const r = await buildWith(copy, c.framework);
            expect(r.status, `${c.what}: the build fails\n${r.output.slice(-3000)}`).not.toBe(0);
            expect(r.output, `${c.what}: rejected by schema validation as an unknown field naming it (DEC-0152)`).toMatch(new RegExp(`unknown[^\\n]*\\b${c.field}\\b`, "i"));
            expect(r.output, `${c.what}: the error names the file`).toContain("local.json");
          }
          await copy.write("config/local.json", original);
          const ok = await buildWith(copy, { email: { senderName: "Reference app" } });
          expect(ok.status, `framework.email.senderName alone builds:\n${ok.output.slice(-3000)}`).toBe(0);
        } finally {
          await copy.remove();
        }
      },
      900_000,
    );
  });
}
