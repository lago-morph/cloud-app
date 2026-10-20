import { afterEach, describe, expect, it, vi } from "vitest";

// CLI-AC-003 for the compliance runner's entry point: a usage error exits 64, any other failure exits 1 with its
// message, and a driver result is passed through. Root cause 2026-10-20-compliance-cli-exit-and-pending-stages (F1).
const { runCompliance, nodeDeps } = vi.hoisted(() => ({ runCompliance: vi.fn(), nodeDeps: vi.fn(() => ({})) }));
vi.mock("./driver.js", () => ({ runCompliance }));
vi.mock("./node-deps.js", () => ({ nodeDeps }));

async function runCli(argv: string[]): Promise<{ code: number | undefined; stderr: string }> {
  vi.resetModules();
  const saved = process.argv;
  process.argv = ["node", "cli", ...argv];
  let code: number | undefined;
  let stderr = "";
  const exit = vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    code = c;
  }) as never);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => {
    stderr += s;
    return true;
  }) as never);
  try {
    await import("./cli.js");
  } finally {
    process.argv = saved;
    exit.mockRestore();
    err.mockRestore();
  }
  return { code, stderr };
}

afterEach(() => {
  runCompliance.mockReset();
  nodeDeps.mockReset();
  nodeDeps.mockImplementation(() => ({}));
});

describe("[CLI-AC-003] compliance runner exit status (cli.ts)", () => {
  it("[CLI-AC-003] a usage error exits 64 and runs nothing", async () => {
    for (const argv of [
      ["--target", "nowhere"],
      ["--target", "local", "--bogus"],
    ]) {
      const r = await runCli(argv);
      expect(runCompliance).not.toHaveBeenCalled();
      expect(r.code).toBe(64);
      expect(r.stderr).toMatch(/^compliance: /);
    }
  });

  it("[CLI-AC-003] the driver's exit status is passed through", async () => {
    for (const status of [0, 1, 2, 3]) {
      runCompliance.mockResolvedValue({ exitStatus: status });
      expect((await runCli(["--target", "local"])).code).toBe(status);
    }
  });

  it("[CLI-AC-003] an exception from the driver exits 1, not the usage status, and prints its message", async () => {
    runCompliance.mockRejectedValue(new Error("EACCES: permission denied, open '.framework/compliance/pending-stages.json'"));
    const r = await runCli(["--target", "local"]);
    expect(r.stderr).toBe("compliance: EACCES: permission denied, open '.framework/compliance/pending-stages.json'\n");
    expect(r.code).toBe(1);
  });

  it("[CLI-AC-003] a non-Error rejection exits 1 with its string form", async () => {
    runCompliance.mockRejectedValue("boom");
    const r = await runCli(["--target", "local"]);
    expect(r.stderr).toBe("compliance: boom\n");
    expect(r.code).toBe(1);
  });

  it("[CLI-AC-003] a failure building the dependencies exits 1", async () => {
    nodeDeps.mockImplementation(() => {
      throw new Error("git missing");
    });
    const r = await runCli(["--target", "local"]);
    expect(runCompliance).not.toHaveBeenCalled();
    expect(r.stderr).toContain("git missing");
    expect(r.code).toBe(1);
  });
});
