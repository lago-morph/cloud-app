/**
 * AWS PRE-CHECK, NOT EVIDENCE (plan-aws G-T3): the shared FILES server-operation cases
 * (../files/server-operations.cases.ts, FILES-AC-001/-002's local expectations) through the real
 * AWS store (`createS3FilesStore`, `createAwsTicketIssuer`) and the shared FILES service over the
 * S3 fake, which verifies SigV4, the session token and the expected bucket owner on every request.
 * Untagged: titles carry no criterion ID, so nothing is credited from this file.
 */
import { describe } from "vitest";
import { defineFilesServerCases } from "../files/server-operations.cases.js";
import { NOT_EVIDENCE, guardAwsNetwork, s3FilesHost } from "./support.js";

describe(`AWS FILES, ${NOT_EVIDENCE}`, () => {
  guardAwsNetwork();
  defineFilesServerCases(s3FilesHost, {
    t: (_id, title) => `${title} (S3 store over the S3 fake, ${NOT_EVIDENCE})`,
    suffix: ` (AWS S3 store over the S3 fake, ${NOT_EVIDENCE})`,
  });
});
