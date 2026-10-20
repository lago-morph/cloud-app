/**
 * CFG-AC-005: admin list and users list (docs/components/config.md §4).
 * - Locally, with the stub login provider (only available in-process: auth.md "Stub provider"),
 *   each `createTestApp` call is one build (testing.d.ts): adding a user's ID to
 *   `framework.admins` makes them admin only in the next build, removing it reverts; adding
 *   `framework.users` without the user's ID makes them anonymous only in the next build.
 * - On every target: the run's deployment carries exactly its committed `framework.admins` and
 *   `framework.users`. With the authentication mock the level is chosen by the test (AUTH-REQ-009),
 *   so a deployed stage cannot show its lists through a login; the deployment's resolved
 *   configuration is read instead (decisions C-T1).
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { resolvedConfigFor } from "../core/support/build.js";
import { referenceTestApp, jsonOf, type TestApp } from "../core/support/in-process.js";
import { committedValuesFile, isLocal, readStageValues, REFERENCE_DIR, runDeployment, uniqueValue } from "../core/support/repo.js";

interface Me {
  readonly level: string;
  readonly id?: string;
  readonly unlistedId?: string;
}

async function me(app: TestApp): Promise<Me> {
  const r = await app.request("/api/auth/me");
  expect(r.status, "/api/auth/me").toBe(200);
  return (await jsonOf(r)) as Me;
}

async function userRouteStatus(app: TestApp): Promise<number> {
  return (await app.request("/api/levels/user")).status;
}

async function build(framework: Record<string, unknown>, subject: string): Promise<TestApp> {
  const app = await referenceTestApp({ stubLoginProvider: true, secrets: { apiKey: "c-t1-in-process-value" }, config: { framework } });
  await app.loginWithStub(subject, { displayName: "CFG-AC-005 user" });
  return app;
}

describe("CFG: admin list and users list", () => {
  it(
    tag("CFG-AC-005", "the run's deployment carries exactly its committed framework.admins and framework.users"),
    async () => {
      const run = runDeployment();
      const committed = readStageValues(committedValuesFile(REFERENCE_DIR, run.target, run.stage)).framework ?? {};
      const { config, source } = await resolvedConfigFor(REFERENCE_DIR, run.target, run.stage);
      expect([...(config.admins ?? [])], `${source}: admins`).toEqual([...(committed.admins ?? [])]);
      expect(config.users === undefined ? undefined : [...config.users], `${source}: users (absent when the file has none)`).toEqual(committed.users === undefined ? undefined : [...committed.users]);
    },
    300_000,
  );

  if (isLocal()) {
    it(
      tag("CFG-AC-005", "locally with the stub login provider, an ID added to framework.admins is admin only after the next build, and removing it reverts"),
      async () => {
        const subject = uniqueValue("cfg-ac-005-subject-");
        const apps: TestApp[] = [];
        try {
          const first = await build({}, subject);
          apps.push(first);
          const id = (await me(first)).id ?? "";
          expect(await me(first)).toMatchObject({ level: "user", id });

          const withAdmin = await build({ admins: [id] }, subject);
          apps.push(withAdmin);
          expect(await me(withAdmin), "the build with the ID in framework.admins").toMatchObject({ level: "admin", id });
          expect(await me(first), "the earlier build is unchanged").toMatchObject({ level: "user", id });

          const removed = await build({}, subject);
          apps.push(removed);
          expect(await me(removed), "the build after removing the ID").toMatchObject({ level: "user", id });
          expect(await me(withAdmin), "the build with the ID keeps it until replaced").toMatchObject({ level: "admin", id });
        } finally {
          for (const app of apps) await app.dispose();
        }
      },
      300_000,
    );

    it(
      tag("CFG-AC-005", "locally with the stub login provider, framework.users without the user's ID makes that user anonymous only after the next build"),
      async () => {
        const subject = uniqueValue("cfg-ac-005-listed-");
        const apps: TestApp[] = [];
        try {
          const first = await build({}, subject);
          apps.push(first);
          const id = (await me(first)).id ?? "";
          expect(await userRouteStatus(first)).toBe(200);

          const other = await build({}, uniqueValue("cfg-ac-005-other-"));
          apps.push(other);
          const otherId = (await me(other)).id ?? "";
          expect(otherId).not.toBe(id);

          const listed = await build({ users: [otherId] }, subject);
          apps.push(listed);
          expect(await me(listed), "the build whose framework.users lacks the ID").toMatchObject({ level: "anonymous", unlistedId: id });
          expect(await userRouteStatus(listed), "a user route treats them as anonymous").toBe(401);
          expect(await userRouteStatus(first), "the earlier build is unchanged").toBe(200);

          const unlisted = await build({}, subject);
          apps.push(unlisted);
          expect(await me(unlisted), "the build without framework.users").toMatchObject({ level: "user", id });
        } finally {
          for (const app of apps) await app.dispose();
        }
      },
      300_000,
    );
  }
});
