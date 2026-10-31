/**
 * A real local D1 (workerd through Wrangler's getPlatformProxy, DEC-0105) for the auth app's unit
 * tests, as the framework's other D1 unit tests use. No network. Never in a bundle.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { D1Like } from "./store.js";

export interface LocalD1 {
  readonly db: D1Like;
  dispose(): Promise<void>;
}

export async function localD1(): Promise<LocalD1> {
  const dir = mkdtempSync(join(tmpdir(), "auth-app-d1-"));
  const configPath = join(dir, "wrangler.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "auth-app-unit",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: "auth", database_id: "00000000-0000-0000-0000-000000000001" }],
    }),
  );
  const proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath, persist: false });
  return { db: proxy.env.DB, dispose: () => proxy.dispose() };
}
