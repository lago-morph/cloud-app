import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { createDeployment, type Target } from "../core/identity.js";
import { nodeFileReader, readStageConfig, resolveStageConfig, stageConfigPath } from "./files.js";
import { configString } from "./public.js";

const deployment = (target: Target, stage: string) => createDeployment({ app: "notes", stage, target });
const EMPTY = JSON.stringify({ values: {}, framework: {} });

/** A reader over an in-memory repository: path → text; absent paths are missing files. */
function repo(files: Record<string, string>) {
  return (path: string): string | undefined => files[path];
}

describe("per-stage values file selection (CFG-REQ-002, DEC-0081)", () => {
  it("local development uses config/local.json", () => {
    expect(stageConfigPath(deployment("local", "dev"))).toBe("config/local.json");
  });

  it(tag("CFG-AC-002", "a stage named test-<id> uses config/<target>/test.json"), () => {
    expect(stageConfigPath(deployment("cloudflare", "test-a1b2c3"))).toBe("config/cloudflare/test.json");
  });

  it("a stage not named test-* uses its own file, even when the name contains test", () => {
    expect(stageConfigPath(deployment("cloudflare", "prod"))).toBe("config/cloudflare/prod.json");
    expect(stageConfigPath(deployment("cloudflare", "mytest-1"))).toBe("config/cloudflare/mytest-1.json");
    expect(stageConfigPath(deployment("cloudflare", "prodcheck"))).toBe("config/cloudflare/prodcheck.json");
  });

  it("reads and validates the selected file", () => {
    const read = readStageConfig(deployment("cloudflare", "test-x"), repo({ "config/cloudflare/test.json": EMPTY }));
    expect(read).toEqual({ file: "config/cloudflare/test.json", config: { values: {}, framework: {} } });
  });

  it(
    tag("CFG-AC-002", "a stage not named test-* without its own committed file fails naming the missing file, even when test.json exists"),
    () => {
      let err: unknown;
      try {
        readStageConfig(deployment("cloudflare", "prod"), repo({ "config/cloudflare/test.json": EMPTY }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(FrameworkError);
      expect((err as FrameworkError).code).toBe("CORE.MISCONFIGURED");
      expect((err as FrameworkError).message).toContain("config/cloudflare/prod.json");
      expect((err as FrameworkError).message).toContain("missing");
      expect((err as FrameworkError).message).not.toContain("test.json");
    },
  );
});

describe("nodeFileReader", () => {
  it("reads a file relative to the app directory and reports a missing one as undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    mkdirSync(join(dir, "config"));
    writeFileSync(join(dir, "config/local.json"), EMPTY);
    const read = nodeFileReader(dir);
    expect(read("config/local.json")).toBe(EMPTY);
    expect(read("config/cloudflare/prod.json")).toBeUndefined();
  });
});

describe("resolveStageConfig: the build's one call", () => {
  const app = { config: { title: configString() }, secrets: ["apiKey"] as const };

  it("selects, validates and resolves the deployment's values file", () => {
    const resolved = resolveStageConfig(deployment("cloudflare", "test-x"), app, repo({
      "config/cloudflare/test.json": JSON.stringify({ values: { title: "T" }, framework: {} }),
      "config/cloudflare/prod.json": JSON.stringify({ values: { title: "P" }, framework: {} }),
    }));
    expect(resolved.values).toEqual({ title: "T" });
    expect(resolved.secrets).toEqual([{ name: "apiKey", location: "SECRET_API_KEY" }]);
  });

  it(tag("CFG-AC-002", "a missing value fails the build naming the key and the file"), () => {
    expect(() => resolveStageConfig(deployment("local", "dev"), app, repo({ "config/local.json": EMPTY }))).toThrow(
      /config\/local\.json[\s\S]*"title" is missing/,
    );
  });
});
