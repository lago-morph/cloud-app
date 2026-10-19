import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDevVars } from "./dev-vars.js";
import { ensureDevSecrets, setLocalSecret } from "./local.js";

const dummy = (label: string) => `${label}-${crypto.randomUUID()}`;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "b10-sec-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const devVars = () => readFile(join(dir, ".dev.vars"), "utf8");

describe("[SEC-AC-003] local setSecret writes SECRET_<NAME> into the app's .dev.vars", () => {
  it("creates .dev.vars, readable by its owner only, with the value at SECRET_<NAME>", async () => {
    const value = dummy("api");
    await setLocalSecret(dir, "apiKey", value);
    expect(readDevVars(await devVars())).toEqual({ SECRET_API_KEY: value });
    expect((await stat(join(dir, ".dev.vars"))).mode & 0o777).toBe(0o600);
  });

  it("replaces the value of an existing secret and keeps the others", async () => {
    const other = dummy("o");
    await writeFile(join(dir, ".dev.vars"), `SECRET_OTHER=${other}\nSECRET_API_KEY=old\n`);
    const value = dummy("new");
    await setLocalSecret(dir, "apiKey", value);
    expect(readDevVars(await devVars())).toEqual({ SECRET_OTHER: other, SECRET_API_KEY: value });
  });
});

describe("dev: generating missing development-only framework secrets into .dev.vars", () => {
  it("creates them when absent and leaves existing values unchanged on the next run", async () => {
    const first = await ensureDevSecrets(dir);
    expect([...first].sort()).toEqual(["frameworkLocalTicketKey", "frameworkSessionKey"]);
    const text = await devVars();
    expect(await ensureDevSecrets(dir)).toEqual([]);
    expect(await devVars()).toBe(text);
  });
});
