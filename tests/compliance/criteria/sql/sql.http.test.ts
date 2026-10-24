/**
 * SQL shared case set through the reference app on this run's target (SQL-AC-003…-006):
 * `POST /api/cases/run` against `dev` locally and the test stage on a cloud.
 */
import { defineSqlSuite } from "./suite.js";
import { httpRunner } from "./support/runner.js";

defineSqlSuite("reference app over HTTP", () => httpRunner());
