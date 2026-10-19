import { describe, expect, it } from "vitest";
import { captureIo } from "../io.test-support.js";
import { verifyCommand, type TestRun, type VerifyDeps } from "./verify.js";

const passing: TestRun = { tests: [{ file: "tests/hello.test.ts", name: "says hello", state: "passed", errors: [] }], fileErrors: [] };

function deps(overrides: Partial<VerifyDeps> = {}, calls: string[] = []): VerifyDeps {
  return {
    typeCheck: async (dir) => (calls.push(`types ${dir}`), []),
    portabilityRules: async (dir) => (calls.push(`rules ${dir}`), []),
    migrationChecker: async (dir) => (calls.push(`migrations ${dir}`), []),
    zodVersion: async (dir) => (calls.push(`zod ${dir}`), { expected: "4.6.7", installed: "4.6.7" }),
    runTests: async (dir, dialect) => (calls.push(`tests ${dialect} ${dir}`), passing),
    ...overrides,
  };
}

describe("verify (CLI-REQ-002)", () => {
  it("[CLI-AC-002] passes when every step passes, running the app tests once per dialect", async () => {
    const calls: string[] = [];
    const io = captureIo("/apps/one");
    expect(await verifyCommand(deps({}, calls))([], io)).toBe(0);
    expect(calls).toEqual(["types /apps/one", "rules /apps/one", "migrations /apps/one", "zod /apps/one", "tests sqlite /apps/one", "tests postgres /apps/one"]);
    expect(io.out).toMatch(/verify passed/);
  });

  it("[CLI-AC-002] fails on type errors and on rule diagnostics, and reports both in one run (DEC-0238)", async () => {
    const io = captureIo();
    const code = await verifyCommand(
      deps({
        typeCheck: async () => [{ file: "src/server/fs-use.ts", line: 1, column: 20, rule: "TS2307", message: "Cannot find module 'node:fs'." }],
        portabilityRules: async () => [
          { file: "src/server/fs-use.ts", line: 1, column: 1, rule: "prototype-framework/allowed-imports", message: "import of node:fs", reference: "skill/reference/portability.md" },
        ],
      }),
    )([], io);
    expect(code).toBe(1);
    expect(io.out).toContain("src/server/fs-use.ts:1:20  error  Cannot find module 'node:fs'.  TS2307");
    expect(io.out).toContain("src/server/fs-use.ts:1:1  error  import of node:fs  prototype-framework/allowed-imports  (read skill/reference/portability.md)");
    expect(io.out).toMatch(/verify failed: type checking, portability rules/);
  });

  it("[CLI-AC-002] fails on migration-checker diagnostics and on a zod version other than PAR-112's", async () => {
    const io = captureIo();
    const code = await verifyCommand(
      deps({
        migrationChecker: async () => [{ file: "migrations/postgres/0000_schema.sql", line: 1, column: 1, rule: "migration-dialects", message: "column extra differs", reference: "skill/reference/sql.md" }],
        zodVersion: async () => ({ expected: "4.6.7", installed: "4.1.0" }),
      }),
    )([], io);
    expect(code).toBe(1);
    expect(io.out).toContain("migrations/postgres/0000_schema.sql:1:1  error  column extra differs  migration-dialects");
    expect(io.out).toMatch(/zod 4\.1\.0 is installed.*4\.6\.7/);
    expect(io.out).toMatch(/verify failed: migration checker, zod version/);
  });

  it("[CLI-AC-002][LOCAL-AC-003] a test failing on one dialect only fails verify, naming the test, its error and the dialect", async () => {
    const io = captureIo();
    const code = await verifyCommand(
      deps({
        runTests: async (_dir, dialect) =>
          dialect === "sqlite"
            ? passing
            : { tests: [{ file: "tests/items.test.ts", name: "items > negative limit returns every item", state: "failed", errors: ["LIMIT must not be negative"] }], fileErrors: [] },
      }),
    )([], io);
    expect(code).toBe(1);
    expect(io.out).toContain("negative limit returns every item");
    expect(io.out).toContain("LIMIT must not be negative");
    expect(io.out).toMatch(/verify failed: tests \(postgres\)/);
  });

  it("[CLI-AC-002] fails when no test ran (zero tests, or only skipped ones)", async () => {
    for (const run of [
      { tests: [], fileErrors: [] },
      { tests: [{ file: "tests/a.test.ts", name: "later", state: "skipped" as const, errors: [] }], fileErrors: [] },
    ]) {
      const io = captureIo();
      expect(await verifyCommand(deps({ runTests: async () => run }))([], io)).toBe(1);
      expect(io.out).toMatch(/no tests ran/);
    }
  });

  it("fails when a test file cannot run or the test runner itself fails", async () => {
    const broken = captureIo();
    const fileError: TestRun = { tests: passing.tests, fileErrors: [{ file: "tests/broken.test.ts", message: "Cannot find module './nope'" }] };
    expect(await verifyCommand(deps({ runTests: async () => fileError }))([], broken)).toBe(1);
    expect(broken.out).toContain("tests/broken.test.ts");
    expect(broken.out).toContain("Cannot find module './nope'");

    const crashed = captureIo();
    expect(await verifyCommand(deps({ runTests: async () => ({ tests: [], fileErrors: [], error: "the test runner exited with status 3" }) }))([], crashed)).toBe(1);
    expect(crashed.out).toContain("the test runner exited with status 3");
  });

  it("prints failing and skipped tests in a fixed order, so two runs print the same text", async () => {
    const shuffled: TestRun = {
      tests: [
        { file: "tests/b.test.ts", name: "two", state: "failed", errors: ["boom"] },
        { file: "tests/a.test.ts", name: "z", state: "skipped", errors: [] },
        { file: "tests/a.test.ts", name: "a", state: "failed", errors: ["bang"] },
        { file: "tests/a.test.ts", name: "ok", state: "passed", errors: [] },
      ],
      fileErrors: [],
    };
    const first = captureIo();
    const second = captureIo();
    await verifyCommand(deps({ runTests: async () => shuffled }))([], first);
    await verifyCommand(deps({ runTests: async () => ({ ...shuffled, tests: [...shuffled.tests].reverse() }) }))([], second);
    expect(second.out).toBe(first.out);
    expect(first.out.indexOf("tests/a.test.ts > a")).toBeLessThan(first.out.indexOf("tests/a.test.ts > z"));
    expect(first.out).toMatch(/tests \(sqlite\): 2 failed \(1 passed, 2 failed, 1 skipped\)/);
  });

  it("does not name passing test files: only problems name files (DEC-0237 reads lines naming a file as diagnostics)", async () => {
    const io = captureIo();
    expect(await verifyCommand(deps())([], io)).toBe(0);
    expect(io.out).not.toContain("hello.test.ts");
    expect(io.out).toMatch(/tests \(postgres\): passed \(1 passed, 0 failed, 0 skipped\)/);
  });

  it("a missing zod installation fails the zod step", async () => {
    const io = captureIo();
    expect(await verifyCommand(deps({ zodVersion: async () => ({ expected: "4.6.7", installed: undefined }) }))([], io)).toBe(1);
    expect(io.out).toMatch(/zod is not installed/);
  });
});
