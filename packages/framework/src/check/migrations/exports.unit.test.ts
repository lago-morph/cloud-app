import { describe, expect, it } from "vitest";
import * as check from "../public.js";

describe("./check exports the migration checker for verify (B-17)", () => {
  it("runMigrationChecker is exported next to runPortabilityRules, with diagnostics formatDiagnostics renders", () => {
    expect(typeof check.runMigrationChecker).toBe("function");
    expect(check.MIGRATION_CHECKS).toEqual(["migration-checksums", "migration-history", "migration-apply", "migration-supported-changes", "migration-dialects"]);
    const line = check.formatDiagnostic({
      file: "migrations/sqlite/0001_schema.sql",
      line: 1,
      column: 1,
      rule: "prototype-framework/migration-checksums",
      message: "edited",
      reference: "skill/reference/sql-and-migrations.md",
    });
    expect(line).toBe("migrations/sqlite/0001_schema.sql:1:1  error  edited  prototype-framework/migration-checksums  (read skill/reference/sql-and-migrations.md)");
  });
});
