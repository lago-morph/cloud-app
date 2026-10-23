/**
 * KV shared case set through the reference app on this run's target (KV-AC-001…-005):
 * `POST /api/cases/run` against `dev` locally and the test stage on a cloud.
 */
import { defineKvSuite } from "./suite.js";
import { httpRunner } from "../sql/support/runner.js";

defineKvSuite("reference app over HTTP", () => httpRunner());
