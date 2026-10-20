/**
 * CFG-AC-004: the resolved configuration of a deployment lists every declared secret with its
 * target location (docs/components/config.md §4; locations: SEC-REQ-003). The deployment is the
 * run's own (its build output under apps/reference/.framework/<target>/ when it is for the run's
 * stage, else a fresh build of the committed app for that target and stage).
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { resolvedConfigFor } from "../core/support/build.js";
import { REFERENCE_DIR, REFERENCE_SECRETS, runDeployment, secretLocation } from "../core/support/repo.js";

describe("CFG: secret names and locations", () => {
  it(
    tag("CFG-AC-004", "the deployment's resolved configuration lists every declared secret with its location on this target"),
    async () => {
      const run = runDeployment();
      const { config, source } = await resolvedConfigFor(REFERENCE_DIR, run.target, run.stage);
      expect({ app: config.deployment.app, stage: config.deployment.stage }, source).toEqual({ app: run.app, stage: run.stage });
      const expected = REFERENCE_SECRETS.map((name) => ({ name, location: secretLocation(run.target, run.app, run.stage, name) }));
      const listed = config.secrets.map((s) => ({ name: s.name, location: s.location }));
      expect([...listed].sort((a, b) => a.name.localeCompare(b.name)), `${source}: declared secrets with their ${run.target} locations`).toEqual(expected);
    },
    300_000,
  );
});
