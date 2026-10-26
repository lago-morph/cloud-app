import { describe, expect, it } from "vitest";
import { filesBucketName, isStageStateObject, publicOrigin, legacySigningTokenName, STATE_BUCKET, workerName } from "./names.js";

const stage = { app: "notes", stage: "test-abc" };

describe("Cloudflare stage resource names (PROV §2 'Stage resources'; CF-REQ-002)", () => {
  it("[CF-AC-002] names every stage resource after the app and the stage, so two stages never share one", () => {
    expect(workerName(stage)).toBe("notes-test-abc");
    expect(filesBucketName(stage)).toBe("notes-test-abc-files");
    expect(legacySigningTokenName(stage)).toBe("notes-test-abc-files-signing");
    const other = { app: "notes", stage: "test-abd" };
    expect(new Set([workerName(stage), workerName(other), filesBucketName(stage), filesBucketName(other)]).size).toBe(4);
  });

  it("the longest legal app and stage names (PAR-290, PAR-291) still fit R2's and Workers' 63-character limit", () => {
    const longest = { app: "a".repeat(20), stage: "b".repeat(20) };
    expect(filesBucketName(longest).length).toBeLessThanOrEqual(63);
    expect(workerName(longest).length).toBeLessThanOrEqual(63);
  });

  it("the public origin is the Worker's workers.dev URL on the account subdomain", () => {
    expect(publicOrigin(stage, "example")).toBe("https://notes-test-abc.example.workers.dev");
  });

  it("the SST state home is the fixed bucket sst-state (DEC-0084)", () => {
    expect(STATE_BUCKET).toBe("sst-state");
  });

  it("a state object belongs to the stage only by exact <kind>/<app>/<stage>[/…] key, never by prefix of another stage", () => {
    expect(isStageStateObject(stage, "app/notes/test-abc")).toBe(true);
    expect(isStageStateObject(stage, "passphrase/notes/test-abc")).toBe(true);
    expect(isStageStateObject(stage, "snapshot/notes/test-abc/fe5eaa400d3d7ea06c1c13fb")).toBe(true);
    expect(isStageStateObject(stage, "app/notes/test-abcd")).toBe(false);
    expect(isStageStateObject(stage, "app/notesx/test-abc")).toBe(false);
    expect(isStageStateObject(stage, "app/other/test-abc")).toBe(false);
    expect(isStageStateObject(stage, "x/y/notes/test-abc")).toBe(false);
  });
});
