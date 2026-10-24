/**
 * AWS-AC-005 (aws.md §4; AWS-REQ-005): "One slow test: wait until the cluster is observably
 * paused (bounded; if it never pauses, record not-run with the reason), then send one request.
 * Within PAR-270 it returns 2xx or `SQL.UNAVAILABLE`, never a gateway timeout."
 *
 * Runs against the run's stage. The cluster-paused observer of the AWS cloud hooks is polled
 * every 30 s, with no request to the stage meanwhile, for at most `pauseBoundMs(PAR-213)` (the
 * auto-pause delay plus 10 minutes, PAR-281). If the cluster is not
 * observably paused by then, the test is skipped with the reason as its note, so the driver
 * records AWS-AC-005 `not-run` (the title below states that reason; results.ts records skipped
 * tagged tests by title). Other tests of the run using the database can keep it from pausing.
 *
 * The one request is `GET /api/errors/SQL.UNAVAILABLE` through CloudFront, an anonymous route
 * that runs one `select` (ROUTES.md): 200 `{ raised: false }` when the database answers, else
 * 503 `SQL.UNAVAILABLE`. The client's own timeout is PAR-271 plus 10 s, so a CloudFront gateway
 * timeout is observed rather than cut off. It must answer 2xx or `SQL.UNAVAILABLE`, never 504,
 * within PAR-270 plus 3 s of network slack between the test and CloudFront.
 *
 * Cloud usage: about 40 read-only observer requests (RDS / CloudWatch), one HTTP request to
 * the stage, one database `select`. Takes up to about 16 minutes.
 */
import { describe, expect, it } from "vitest";
import { createClient, tag, target } from "../../harness/index.js";
import { catalogueStatus, parameterNumber, runDeployment } from "../core/support/repo.js";
import { awsHooks, pauseBoundMs, resumeResponseProblems, waitForPause } from "./support.js";

const NETWORK_SLACK_MS = 3_000;
const BOUND_MS = pauseBoundMs(parameterNumber("PAR-213"));
const LAMBDA_TIMEOUT_MS = parameterNumber("PAR-270") * 1000;
const ROUTER_TIMEOUT_MS = parameterNumber("PAR-271") * 1000;

if (target().target === "aws") {
  describe("AWS-AC-005 paused cluster (aws)", () => {
    it(
      tag("AWS-AC-005", "after the cluster is observably paused, one request answers 2xx or SQL.UNAVAILABLE within PAR-270, never a gateway timeout (skipped, so not-run, when the cluster does not pause within PAR-213 plus 10 minutes)"),
      async ({ skip }) => {
        const hooks = await awsHooks("AWS-AC-005");
        const run = runDeployment();
        const stage = { app: run.app, stage: run.stage };

        const wait = await waitForPause(() => hooks.observeCluster(stage), { boundMs: BOUND_MS });
        if (!wait.paused) skip(`not-run: ${wait.reason}`);

        const c = createClient({ baseUrl: target().baseUrl, timeoutMs: ROUTER_TIMEOUT_MS + 10_000 });
        const started = Date.now();
        const r = await c.get("/api/errors/SQL.UNAVAILABLE");
        const elapsedMs = Date.now() - started;
        const problems = resumeResponseProblems({ status: r.status, errorCode: r.errorCode, elapsedMs }, { lambdaTimeoutMs: LAMBDA_TIMEOUT_MS, slackMs: NETWORK_SLACK_MS, unavailableStatus: catalogueStatus("SQL.UNAVAILABLE") });
        expect(problems, `the request after the pause (${wait.paused ? wait.detail : ""}; status ${String(r.status)}, code ${r.errorCode ?? "none"}, requestId ${r.requestId ?? "none"}, ${String(elapsedMs)} ms)`).toEqual([]);
        if (r.status === 200) expect(r.json(), "the database answered").toEqual({ raised: false });
      },
      BOUND_MS + ROUTER_TIMEOUT_MS + 120_000,
    );
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on other targets.
  describe("AWS-AC-005 (aws only)", () => {
    it("has nothing to run on this target", () => undefined);
  });
}
