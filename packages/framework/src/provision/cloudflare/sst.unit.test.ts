import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { processSstExec, runSst, sstBinary, sstProgram, writeSstApp, type SstExec, type SstInput } from "./sst.js";

const stage = { app: "notes", stage: "test-abc" };

const code = {
  bundle: "/app/.framework/cloudflare/worker.js",
  assetsDirectory: "/app/dist/client",
  compatibilityDate: "2026-10-01",
  compatibilityFlags: ["nodejs_compat"],
  variables: { FRAMEWORK_DEPLOYMENT: "notes/test-abc" },
  logBucketBinding: "LOGS",
};

const worker = { publicOrigin: "https://notes-test-abc.example.workers.dev", database: { id: "d1-uuid", name: "notes-test-abc-db-1" }, code };
const full: SstInput = { stage, worker };

/**
 * Runs the generated `sst.config.ts` against stand-ins for SST's globals, the way SST evaluates
 * it, and returns the app settings and each component's arguments after its transforms ran.
 */
function evaluate(source: string) {
  const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const components: { type: string; name: string; args: Record<string, unknown>; transformed: Record<string, unknown> }[] = [];
  const component = (type: string, key: string) =>
    function (this: unknown, name: string, args: Record<string, unknown>) {
      const transform = (args.transform as Record<string, (a: Record<string, unknown>) => void> | undefined)?.[key];
      const transformed: Record<string, unknown> = { bindings: [{ type: "plain_text", name: "SST_RESOURCE_App", text: "{}" }] };
      transform?.(transformed);
      components.push({ type, name, args, transformed });
    };
  const sst = { cloudflare: { Bucket: component("Bucket", "bucket"), Worker: component("Worker", "worker") } };
  const $util = { output: <T>(v: T) => ({ apply: <R>(f: (x: T) => R) => f(v) }) };
  let config: { app(input: unknown): unknown; run(): Promise<unknown> } | undefined;
  const $config = (c: typeof config) => (config = c);
  const module = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "$config", "sst", "$util", js)(module, module.exports, $config, sst, $util);
  return { config: config!, components };
}

describe("the SST app built from the app definition (PROV-REQ-001; cloudflare.md §2; DEC-0084, DEC-0087)", () => {
  it("is valid TypeScript with SST's settings: app name, never retains resources, state home on Cloudflare, the pinned provider", () => {
    const { config } = evaluate(sstProgram(full));
    expect(config.app({ stage: "test-abc" })).toEqual({ name: "notes", removal: "remove", home: "cloudflare", providers: { cloudflare: "6.15.0" } });
  });

  it("[CF-AC-002] declares the stage bucket and the stage Worker with fixed names, the stage's D1 database, bucket and the shared log bucket bound", async () => {
    const { config, components } = evaluate(sstProgram(full));
    await config.run();
    expect(components.map((c) => `${c.type} ${c.name}`)).toEqual(["Bucket Files", "Worker Worker"]);
    expect(components[0]!.transformed.name).toBe("notes-test-abc-files");
    const worker = components[1]!;
    expect(worker.args.handler).toBe(code.bundle);
    expect(worker.args.url).toBe(true);
    expect(worker.args.assets).toEqual({ directory: "/app/dist/client" });
    expect(worker.args.environment).toEqual({ FRAMEWORK_DEPLOYMENT: "notes/test-abc", FRAMEWORK_PUBLIC_ORIGIN: "https://notes-test-abc.example.workers.dev" });
    expect(worker.transformed.scriptName).toBe("notes-test-abc");
    expect(worker.transformed.compatibilityDate).toBe("2026-10-01");
    expect(worker.transformed.compatibilityFlags).toEqual(["nodejs_compat"]);
    expect(worker.transformed.bindings).toEqual([
      { type: "plain_text", name: "SST_RESOURCE_App", text: "{}" },
      { type: "d1", name: "DB", id: "d1-uuid" },
      { type: "r2_bucket", name: "FILES", bucketName: "notes-test-abc-files" },
      { type: "r2_bucket", name: "LOGS", bucketName: "prototype-logs" },
    ]);
  });

  it("keeps the secrets set through the Cloudflare API: keepBindings guard, and no SECRET_* binding is ever declared (DEC-0087)", async () => {
    const { config, components } = evaluate(sstProgram(full));
    await config.run();
    expect(components[1]!.transformed.keepBindings).toEqual(["secret_text", "secret_key"]);
    expect(() => sstProgram({ stage, worker: { ...worker, code: { ...code, variables: { SECRET_API_KEY: "x" } } } })).toThrow(/SECRET_API_KEY.*would replace the Worker secret/);
    expect(() => sstProgram({ stage, worker: { ...worker, code: { ...code, logBucketBinding: "SECRET_LOGS" } } })).toThrow(/SECRET_LOGS/);
  });

  it("without a Worker (step 3 of a first deploy; remove) declares only the long-lived bucket", async () => {
    const { config, components } = evaluate(sstProgram({ stage }));
    await config.run();
    expect(components.map((c) => c.name)).toEqual(["Files"]);
  });

  it("a variable that is not a string literal-safe value is embedded as JSON, never as code", async () => {
    const { config, components } = evaluate(sstProgram({ stage, worker: { ...worker, code: { ...code, variables: { X: '"; process.exit(1); "' } } } }));
    await config.run();
    expect((components[1]!.args.environment as Record<string, string>).X).toBe('"; process.exit(1); "');
  });
});

describe("running SST (DEC-0107)", () => {
  const exec = (code = 0, output = "✓ Complete"): SstExec & { calls: { args: readonly string[]; cwd: string; env: Record<string, string> }[] } => {
    const calls: { args: readonly string[]; cwd: string; env: Record<string, string> }[] = [];
    const f: SstExec = async (args, options) => {
      calls.push({ args, cwd: options.cwd, env: options.env });
      return { code, output };
    };
    return Object.assign(f, { calls });
  };

  it("writes the app into its own directory with a package.json", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "sst-")), "sst");
    writeSstApp(dir, full);
    expect(readFileSync(join(dir, "sst.config.ts"), "utf8")).toBe(sstProgram(full));
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))).toEqual({ name: "notes-sst", private: true, type: "module" });
  });

  it("installs SST's platform once, then deploys the stage with the SST environment; step 3 targets only the bucket", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sst-"));
    const e = exec();
    const env = { CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: "acc" };
    await runSst(e, { dir, env, stage }, "deploy", { target: "Files" });
    expect(e.calls.map((c) => c.args)).toEqual([
      ["install", "--stage", "test-abc"],
      ["deploy", "--stage", "test-abc", "--target", "Files"],
    ]);
    expect(e.calls[1]!.cwd).toBe(dir);
    expect(e.calls[1]!.env).toMatchObject({ CLOUDFLARE_DEFAULT_ACCOUNT_ID: "acc", NODE_USE_ENV_PROXY: "1" });

    mkdirSync(join(dir, ".sst", "platform"), { recursive: true });
    const again = exec();
    await runSst(again, { dir, env, stage }, "remove");
    expect(again.calls.map((c) => c.args)).toEqual([["remove", "--stage", "test-abc"]]);
    expect(existsSync(dir)).toBe(true);
  });

  it("a failing SST run throws with the command and the end of its output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sst-"));
    mkdirSync(join(dir, ".sst", "platform"), { recursive: true });
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    await expect(runSst(exec(1, `${lines}\n✕ Failed: boom`), { dir, env: {}, stage }, "deploy")).rejects.toThrow(/sst deploy --stage test-abc failed \(exit 1\):[\s\S]*✕ Failed: boom/);
    const error = await runSst(exec(1, `${lines}\n✕ Failed: boom`), { dir, env: {}, stage }, "deploy").then(() => new Error("no rejection"), (e: unknown) => e as Error);
    expect(error.message).not.toContain("line 0\n");
  });

  it("the real runner spawns the command in the app directory with the given environment and collects stdout and stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sst-"));
    const script = join(dir, "fake-sst");
    writeFileSync(script, '#!/bin/sh\necho "args: $*"\necho "proxy: $NODE_USE_ENV_PROXY" >&2\npwd\nexit 3\n');
    chmodSync(script, 0o755);
    const r = await processSstExec(script)(["deploy", "--stage", "test-abc"], { cwd: dir, env: { PATH: process.env.PATH ?? "", NODE_USE_ENV_PROXY: "1" } });
    expect(r.code).toBe(3);
    expect(r.output).toContain("args: deploy --stage test-abc");
    expect(r.output).toContain("proxy: 1");
    expect(r.output).toContain(dir);
  });

  it("finds the SST binary of the pinned sst package", () => {
    expect(existsSync(sstBinary())).toBe(true);
  });
});
