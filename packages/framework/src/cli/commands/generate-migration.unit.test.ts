import { describe, expect, it } from "vitest";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { generateMigrationCommand } from "./generate-migration.js";

const tables = { items: { marker: "items-table" } };

describe("generate-migration (CLI-REQ-001, MIG)", () => {
  it("generates the next pair from the app's table definitions and lists the new files", async () => {
    const calls: unknown[] = [];
    const io = captureIo("/apps/one");
    const command = generateMigrationCommand({
      loadTables: async (dir) => {
        calls.push(["load", dir]);
        return tables;
      },
      generate: async (dir, t, name) => {
        calls.push(["generate", dir, t, name]);
        return { status: "created", files: ["/apps/one/migrations/sqlite/0001_schema.sql", "/apps/one/migrations/postgres/0001_schema.sql"] };
      },
    });
    expect(await command([], io)).toBe(0);
    expect(calls).toEqual([
      ["load", "/apps/one"],
      ["generate", "/apps/one", tables, undefined],
    ]);
    expect(io.out).toContain("migrations/sqlite/0001_schema.sql");
    expect(io.out).toContain("migrations/postgres/0001_schema.sql");
  });

  it("passes --name as the file slug, and says so when nothing changed", async () => {
    const names: unknown[] = [];
    const io = captureIo();
    const command = generateMigrationCommand({ loadTables: async () => tables, generate: async (_d, _t, name) => (names.push(name), { status: "unchanged" }) });
    expect(await command(["--name", "add_tags"], io)).toBe(0);
    expect(names).toEqual(["add_tags"]);
    expect(io.out).toMatch(/no changes/i);
  });

  it("refuses other arguments", async () => {
    const command = generateMigrationCommand({ loadTables: async () => tables, generate: async () => ({ status: "unchanged" }) });
    await expect(command(["extra"], captureIo())).rejects.toThrow(UsageError);
  });
});
