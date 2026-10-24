// Hand-written Drizzle schema (pg / PGlite), same shape as schema-sqlite.js.
import { pgTable, text, boolean, integer, bigint, timestamp, serial } from "drizzle-orm/pg-core";

const ts = (name) => timestamp(name, { withTimezone: true, mode: "date" });

export const user = pgTable("__framework_auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const session = pgTable("__framework_auth_session", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("__framework_auth_account", {
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

export const verification = pgTable("__framework_auth_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const rateLimit = pgTable("__framework_auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/** Spike-only mail capture (stands in for MAIL's capture sender / in-memory outbox). */
export const outbox = pgTable("spike_outbox", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  to: text("to_addr").notNull(),
  url: text("url"),
  token: text("token"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const schema = {
  __framework_auth_user: user,
  __framework_auth_session: session,
  __framework_auth_account: account,
  __framework_auth_verification: verification,
  __framework_auth_rate_limit: rateLimit,
};
