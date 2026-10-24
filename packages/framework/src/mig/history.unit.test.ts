import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { checksumOf, readHistory, splitStatements } from "./history.js";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "mig-history-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("migration histories", () => {
  it(tag("MIG-AC-001", "a checksum is the SHA-256 hex digest of the file's UTF-8 text"), () => {
    expect(checksumOf("CREATE TABLE `a` (`id` text);\n")).toBe(createHash("sha256").update("CREATE TABLE `a` (`id` text);\n", "utf8").digest("hex"));
  });

  it("splits a file into statements at drizzle-kit's statement breakpoints, dropping empty pieces", () => {
    const text = "CREATE TABLE `a` (\n\t`id` text\n);\n--> statement-breakpoint\nCREATE INDEX `a_idx` ON `a` (`id`);\n";
    expect(splitStatements(text)).toEqual(["CREATE TABLE `a` (\n\t`id` text\n);", "CREATE INDEX `a_idx` ON `a` (`id`);"]);
    expect(splitStatements("\n\n")).toEqual([]);
  });

  it("reads one dialect's history in file-name order, naming each migration <history>/<base name>", () => {
    const root = scratch();
    mkdirSync(join(root, "sqlite", "meta"), { recursive: true });
    writeFileSync(join(root, "sqlite", "0001_b.sql"), "SELECT 2;\n");
    writeFileSync(join(root, "sqlite", "0000_a.sql"), "SELECT 1;\n");
    writeFileSync(join(root, "sqlite", "meta", "0000_a.json"), "{}");
    writeFileSync(join(root, "sqlite", "notes.txt"), "not a migration");
    const history = readHistory(root, "sqlite", "app");
    expect(history.map((m) => m.id)).toEqual(["app/0000_a", "app/0001_b"]);
    expect(history[0]).toMatchObject({ name: "0000_a", file: join(root, "sqlite", "0000_a.sql"), text: "SELECT 1;\n", checksum: checksumOf("SELECT 1;\n"), statements: ["SELECT 1;"] });
  });

  it("a missing dialect directory is an empty history", () => {
    expect(readHistory(scratch(), "postgres", "app")).toEqual([]);
  });
});
