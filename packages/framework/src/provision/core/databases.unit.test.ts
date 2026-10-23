import { describe, expect, it } from "vitest";
import { databaseName, matchStageDatabases, nextDatabaseName } from "./databases.js";

const stage = { app: "notes", stage: "test-abc" };

describe("stage database names (migrations.md §2, PROV-REQ-002 step 2)", () => {
  it("names databases <app>-<stage>-db-<n>", () => {
    expect(databaseName(stage, 3)).toBe("notes-test-abc-db-3");
  });

  it("[COMPL-AC-007] keeps only exact matches of ^<app>-<stage>-db-(\\d+)$, sorted by number", () => {
    const listed = [
      { name: "notes-test-abc-db-10", id: "u10" },
      { name: "notes-test-abc-db-2", id: "u2" },
      { name: "notes-test-abc-db-x", id: "ux" },
      { name: "notes-test-abc-db-3-old", id: "uold" },
      { name: "notes-test-abcd-db-1", id: "uother" },
      { name: "notes-test-abc-db-", id: "uempty" },
      { name: "xnotes-test-abc-db-1", id: "uprefix" },
      { name: "notes-test-abc-db-1", id: "u1" },
      { name: "notes-test.abc-db-4", id: "udot" },
    ];
    expect(matchStageDatabases(stage, listed)).toEqual([
      { name: "notes-test-abc-db-1", number: 1, id: "u1" },
      { name: "notes-test-abc-db-2", number: 2, id: "u2" },
      { name: "notes-test-abc-db-10", number: 10, id: "u10" },
    ]);
  });

  it("the next database number is one above the current one", () => {
    expect(nextDatabaseName(stage, { name: "notes-test-abc-db-4", number: 4, id: "u" })).toBe("notes-test-abc-db-5");
  });
});
