/**
 * CORE-AC-002 (one unmodified app module builds and starts on each target) and CORE-AC-003
 * (deployment identity is fixed at build time) against the reference app on this run's target.
 * Criteria: docs/components/core.md §4. Routes: apps/reference/ROUTES.md.
 */
import { describe, expect, it } from "vitest";
import { client, prerequisiteMissing, tag } from "../../harness/index.js";
import { cli, runCommand, scratchCopy } from "./support/processes.js";
import { REFERENCE_DIR, REPO_ROOT, runDeployment } from "./support/repo.js";

describe("CORE: one app module, fixed deployment identity", () => {
  it(
    tag("CORE-AC-002", "the committed reference app module, unmodified, builds for this target and the running deployment answers as that app and stage"),
    async () => {
      const run = runDeployment();
      // "Unmodified": the app module and everything under src/ equal the commit under test.
      const status = await runCommand("git", ["status", "--porcelain", "--", "apps/reference/src"], { cwd: REPO_ROOT, timeoutMs: 60_000 });
      expect(status.status).toBe(0);
      expect(status.output.trim(), "apps/reference/src differs from HEAD").toBe("");

      // Builds: the unmodified module builds for this target and stage.
      const copy = await scratchCopy(REFERENCE_DIR, "core-build");
      try {
        const built = await cli(["build", "--target", run.target, "--stage", run.stage], { cwd: copy.dir, timeoutMs: 300_000 });
        expect(built.status, `build --target ${run.target} --stage ${run.stage} failed:\n${built.output}`).toBe(0);
      } finally {
        await copy.remove();
      }

      // Starts: the deployment the run started from that module serves the client and its API.
      const c = client();
      const page = c.expectStatus(await c.get("/"), 200);
      expect(page.headers.get("content-type") ?? "").toContain("text/html");
      const identity = c.expectStatus(await c.get("/api/ref/deployment"), 200).json<{ deployment: unknown }>();
      expect(identity.deployment).toEqual({ app: run.app, stage: run.stage });
      const health = await c.get("/api/__framework/health");
      // The health route also requires every declared secret to have a value: an unset test
      // secret is a missing run prerequisite, not a failure to start.
      if (health.errorCode === "SEC.MISSING") prerequisiteMissing("the reference app's declared secret apiKey has no value on this deployment, so its health route answers SEC.MISSING; set it before the run");
      c.expectStatus(health, 204);
    },
    600_000,
  );

  it(tag("CORE-AC-003", "c.var.deployment has exactly the members app and stage, and forged Host and forwarding headers do not change it"), async () => {
    const run = runDeployment();
    const c = client();
    const baseline = c.expectStatus(await c.get("/api/ref/deployment"), 200).json<{ deployment: Record<string, unknown> }>().deployment;
    expect(Object.keys(baseline).sort()).toEqual(["app", "stage"]);
    expect(baseline).toEqual({ app: run.app, stage: run.stage });

    const forged = "evil.example";
    const forwarding: Record<string, string>[] = [
      { "x-forwarded-host": forged },
      { "x-forwarded-for": "203.0.113.7" },
      { "x-forwarded-proto": "http" },
      { "x-forwarded-server": forged },
      { "x-original-host": forged },
      { "x-host": forged },
      { forwarded: `for=203.0.113.7;host=${forged};proto=http` },
      {
        "x-forwarded-host": `${forged}:8443`,
        "x-forwarded-for": "203.0.113.7",
        "x-forwarded-proto": "http",
        forwarded: `host=${forged}`,
        "x-original-host": forged,
      },
    ];
    for (const headers of forwarding) {
      const r = c.expectStatus(await c.get("/api/ref/deployment", { headers }), 200);
      expect(r.json<{ deployment: unknown }>().deployment, `with ${JSON.stringify(headers)}`).toEqual(baseline);
    }

    // A forged Host may be refused before the app (local `dev` answers 403 unless Host is
    // exactly localhost:<port>; a cloud routes by Host); whenever the app answers, the identity
    // is unchanged.
    for (const headers of [{ host: forged }, { host: forged, "x-forwarded-host": forged }]) {
      const r = await c.get("/api/ref/deployment", { headers });
      if (r.status === 200) expect(r.json<{ deployment: unknown }>().deployment, `with ${JSON.stringify(headers)}`).toEqual(baseline);
      else expect(r.status, `with ${JSON.stringify(headers)}: a refusal, not a server error`).toBeLessThan(500);
    }
  });
});
