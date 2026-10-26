// Cost of "one BA instance per request" in Node/PGlite: betterAuth() construction + first handler call (BA builds its context lazily).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { makeAuth } from "./src/auth.js";
import { schema } from "./src/schema-pg.js";

const client = await PGlite.create();
await client.exec(readFileSync(new URL("./sql/pg.sql", import.meta.url), "utf8"));
const db = drizzle(client);
const mk = () => makeAuth({ db, provider: "pg", schema, origin: "http://localhost:8787", secret: "x".repeat(43), mail: { send: async () => {} } });
const ok = () => new Request("http://localhost:8787/api/auth/password/ok");
for (let i = 0; i < 20; i++) await mk().handler(ok()); // warm-up
const N = 200;
let t = performance.now();
for (let i = 0; i < N; i++) mk();
const build = (performance.now() - t) / N;
t = performance.now();
for (let i = 0; i < N; i++) await mk().handler(ok());
const first = (performance.now() - t) / N;
const shared = mk();
t = performance.now();
for (let i = 0; i < N; i++) await shared.handler(ok());
const reuse = (performance.now() - t) / N;
console.log(`betterAuth() construct: ${build.toFixed(3)} ms; construct + first GET /ok: ${first.toFixed(3)} ms; GET /ok on a reused instance: ${reuse.toFixed(3)} ms (N=${N})`);
await client.close();
