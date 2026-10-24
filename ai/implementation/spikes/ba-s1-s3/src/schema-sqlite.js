// Hand-written Drizzle schema (sqlite / D1) for BA's five models under `__framework_auth_*`.
// Object keys = BA field names (camelCase); SQL columns = snake_case. Keys of the exported
// object = BA modelName, which is what @better-auth/drizzle-adapter looks up.
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

const ts = (name) => integer(name, { mode: "timestamp_ms" });

export const user = sqliteTable("__framework_auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const session = sqliteTable("__framework_auth_session", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("__framework_auth_account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const verification = sqliteTable("__framework_auth_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const rateLimit = sqliteTable("__framework_auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

/** Spike-only mail capture (stands in for MAIL's capture sender / in-memory outbox). */
export const outbox = sqliteTable("spike_outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  to: text("to_addr").notNull(),
  url: text("url"),
  token: text("token"),
  createdAt: integer("created_at").notNull(),
});

export const schema = {
  __framework_auth_user: user,
  __framework_auth_session: session,
  __framework_auth_account: account,
  __framework_auth_verification: verification,
  __framework_auth_rate_limit: rateLimit,
};
