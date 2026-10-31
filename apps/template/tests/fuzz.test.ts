import { createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterEach, describe, it } from "vitest";
import app from "../src/app";
import { newNote } from "../src/server/routes/notes";
import { fuzzJsonRoute } from "./support/fuzz";

let opened: TestApp | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

describe("fuzz: POST /api/notes", () => {
  // Why this route: its body is user text at a trust boundary, trimmed and length-limited, where
  // whitespace-only, Unicode and boundary lengths are easy to miss in example tests.
  // Why 150 runs and seed 20261031: enough to reach the trimmed and length boundaries the helper
  // generates, in about a second per dialect; the fixed seed makes every run the same.
  it("never answers a server error, and refuses exactly the bodies its schema refuses", async () => {
    opened = await createTestApp(app, { user: mockUsers.user("fuzz") });
    await fuzzJsonRoute(opened, { path: "/api/notes", schema: newNote, examples: [{ text: "a note" }], numRuns: 150, seed: 20261031 });
  });
});
