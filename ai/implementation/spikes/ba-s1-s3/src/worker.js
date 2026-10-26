// Minimal Worker: D1 binding `DB`, Drizzle sqlite adapter, BA instance per request.
import { drizzle } from "drizzle-orm/d1";
import { createApp } from "./app.js";
import { schema, outbox } from "./schema-sqlite.js";
import { hashers } from "./hashers.js";

const benchHash = {};

export default {
  async fetch(request, env, ctx) {
    const app = createApp({
      db: drizzle(env.DB),
      provider: "sqlite",
      schema,
      outbox,
      origin: env.PUBLIC_ORIGIN,
      secret: env.SECRET_FRAMEWORK_AUTH_SECRET,
      hasher: env.HASHER ?? "default",
      benchHash,
      hashers,
    });
    return app(request, ctx);
  },
};
