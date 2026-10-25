/**
 * CHECK-AC-001 (check.md §4), the installed-dependency-tree clause (DEC-0554): "A fixture app
 * whose dependency installs a platform SDK in its lockfile tree fails `allowed-imports`, naming
 * the chain; one whose dependencies are ordinary packages passes." The rest of CHECK-AC-001 is
 * covered by the framework's fixture suite (`packages/framework/test/integration/check/`).
 *
 * Written from check.md §2 "Installed dependency tree": `verify` reads the nearest
 * `package-lock.json` upwards that lists the app (lockfile version 3 here, the app at `""`),
 * walks each app dependency's `dependencies` as Node resolves them (`node_modules/<name>`), and
 * reports a dependency whose tree holds a package of the deny list on that dependency's line of
 * `package.json`, under `prototype-framework/allowed-imports`, with the chain
 * (`nice-uploads → storage-helper → @aws-sdk/client-s3`).
 *
 * Fixtures: two scratch copies of apps/template, each with one more dependency in `package.json`
 * (`nice-uploads`, never imported, so type checking and the app's tests are unaffected) and a
 * `package-lock.json` recording its installed tree. In the failing one, `nice-uploads` depends on
 * `storage-helper`, which depends on `@aws-sdk/client-s3`; in the passing one, `storage-helper`
 * depends on `left-pad`, an ordinary package. The lockfile describes a tree only: nothing is
 * installed or downloaded. Both run `npx <package> verify` (CLI-REQ-002). No cloud call.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { npxCli, scratchCopy, type CommandResult, type ScratchApp } from "../core/support/processes.js";
import { isLocal, TEMPLATE_DIR } from "../core/support/repo.js";

const RULE = "prototype-framework/allowed-imports";
const DEPENDENCY = "nice-uploads";

interface Fixture {
  readonly label: string;
  /** The package `storage-helper` depends on. */
  readonly leaf: string;
  copy?: ScratchApp;
  result?: CommandResult;
  /** 1-based line of `nice-uploads` in the fixture's package.json. */
  line?: number;
}

const FIXTURES: Fixture[] = [
  { label: "platform SDK in the tree", leaf: "@aws-sdk/client-s3" },
  { label: "ordinary packages only", leaf: "left-pad" },
];

/** Adds `nice-uploads` to the app's dependencies and records the tree in a lockfile. */
async function prepare(f: Fixture): Promise<void> {
  const copy = await scratchCopy(TEMPLATE_DIR, `check-ac-001-tree-${f.leaf.replace(/[^a-z0-9]/g, "")}`);
  f.copy = copy;
  const pkg = JSON.parse(await copy.read("package.json")) as { name: string; version: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  pkg.dependencies = { ...(pkg.dependencies ?? {}), [DEPENDENCY]: "1.0.0" };
  const text = `${JSON.stringify(pkg, null, 2)}\n`;
  await copy.write("package.json", text);
  f.line = text.split("\n").findIndex((l) => l.includes(`"${DEPENDENCY}"`)) + 1;
  const lock = {
    name: pkg.name,
    version: pkg.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies ?? {} },
      [`node_modules/${DEPENDENCY}`]: { version: "1.0.0", resolved: `https://registry.npmjs.org/${DEPENDENCY}/-/${DEPENDENCY}-1.0.0.tgz`, dependencies: { "storage-helper": "^2.0.0" } },
      "node_modules/storage-helper": { version: "2.1.0", resolved: "https://registry.npmjs.org/storage-helper/-/storage-helper-2.1.0.tgz", dependencies: { [f.leaf]: "*" } },
      [`node_modules/${f.leaf}`]: { version: "3.0.0", resolved: `https://registry.npmjs.org/${f.leaf}/-/${f.leaf.split("/").pop() ?? f.leaf}-3.0.0.tgz` },
    },
  };
  await copy.write("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);
  f.result = await npxCli(["verify"], { cwd: copy.dir, timeoutMs: 20 * 60_000 });
}

function show(r: CommandResult | undefined): string {
  return `verify exit ${String(r?.status)}; output:\n${(r?.output ?? "").slice(-8_000)}`;
}

if (isLocal()) {
  describe("CHECK-AC-001 installed dependency tree (DEC-0554)", () => {
    beforeAll(async () => {
      for (const f of FIXTURES) await prepare(f);
    }, 45 * 60_000);

    afterAll(async () => {
      for (const f of FIXTURES) await f.copy?.remove();
    });

    it(tag("CHECK-AC-001", "a fixture app whose dependency installs a platform SDK in its lockfile tree fails allowed-imports, naming the chain on the dependency's package.json line"), () => {
      const f = FIXTURES[0];
      expect(f?.result?.status, show(f?.result)).not.toBe(0);
      const lines = (f?.result?.output ?? "").split("\n").filter((l) => l.includes(RULE) && l.includes("package.json"));
      const chain = new RegExp(`${DEPENDENCY}.*storage-helper.*@aws-sdk/client-s3`);
      const hit = lines.find((l) => chain.test(l));
      expect(hit, `a ${RULE} diagnostic on package.json naming ${DEPENDENCY} → storage-helper → @aws-sdk/client-s3:\n${show(f?.result)}`).toBeDefined();
      expect(hit, "the diagnostic is on the line of package.json that declares the dependency").toMatch(new RegExp(`package\\.json:${String(f?.line)}\\b`));
    });

    it(tag("CHECK-AC-001", "a fixture app whose dependencies install only ordinary packages passes"), () => {
      const f = FIXTURES[1];
      expect(f?.result?.output ?? "", "no allowed-imports diagnostic for the ordinary tree").not.toMatch(new RegExp(`package\\.json.*${RULE}|${RULE}.*package\\.json`));
      expect(f?.result?.status, show(f?.result)).toBe(0);
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on cloud runs.
  describe("CHECK-AC-001 installed dependency tree (local only)", () => {
    it("has nothing to run on a cloud", () => undefined);
  });
}
