// S1+S3 in plain Node against PGlite with BA's Drizzle pg adapter (what createTestApp would do).
// Usage: node run-pglite.mjs            (BA_DEFAULT_ORIGIN_CHECK=1 omits advanced.disableOriginCheck:false)
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createApp } from "./src/app.js";
import { schema, outbox } from "./src/schema-pg.js";
import { hashers } from "./src/hashers.js";
import { scenario } from "./scenario.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const client = await PGlite.create();
await client.exec(readFileSync(HERE + "sql/pg.sql", "utf8"));
const db = drizzle(client);
const env = {
  db,
  provider: "pg",
  schema,
  outbox,
  origin: "http://localhost:8787",
  secret: randomBytes(32).toString("base64url"),
  hasher: "default",
  hashers,
  baDefaultOriginCheck: process.env.BA_DEFAULT_ORIGIN_CHECK === "1",
};
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const send = async (path, { method = "GET", body, headers = {}, host } = {}) => {
  const app = createApp(env); // fresh per request, like the Worker
  const req = new Request(`http://${host ?? "localhost:8787"}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const res = await app(req, ctx);
  await Promise.all(waits.splice(0)); // drain waitUntil so the outbox is populated
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
};
console.log(`node ${process.version}; PGlite ${(await client.query("select version()")).rows[0].version.split(" ").slice(0, 2).join(" ")}; NODE_ENV=${process.env.NODE_ENV ?? "<unset>"}; baDefaultOriginCheck=${env.baDefaultOriginCheck}`);
const ok = await scenario(send, console.log);
await client.close();
process.exit(ok ? 0 : 1);
