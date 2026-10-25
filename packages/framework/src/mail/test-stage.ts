/**
 * The `test-*` stages' mail capture (mail.md §2 "Senders"; MAIL-REQ-002, MAIL-AC-004,
 * MAIL-AC-006; DEC-0518). The capture sender writes each message to the framework table
 * `__framework_test_mail` in the stage's own database; `GET /api/__framework/test-mail?to=<address>`
 * (contracts/http/internal/auth-password.openapi.yaml, x-test-stage-only) answers the latest
 * message to that address, or 404 `HTTP.NOT_FOUND`. Nothing is sent.
 *
 * TEST STAGES ONLY. Like the authentication mock, this module is imported only by test-stage
 * entry points (the Cloudflare runtime re-exports `createTestMailCapture`, and only a test-stage
 * entry uses it), so production bundles contain neither the capture nor the route (PROV-REQ-005,
 * CORE-REQ-006). Workers-compatible.
 */
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { RuntimeContext, RuntimeEnv } from "../core/assemble.js";
import { FrameworkError } from "../core/errors.js";
import { frameworkTables } from "../mig/framework.js";
import { desc } from "../sql/expressions.js";
import { adapterOf } from "../sql/handle.js";
import type { PortableDb } from "../sql/types.js";
import { workerMailFrom } from "./cloudflare.js";
import { capturedMessage, formatFrom, LOCAL_SENDER_ADDRESS, messageId, type MailMessage, type MailSender } from "./sender.js";

/** The route's path under `/api`. */
export const TEST_MAIL_PATH = "/__framework/test-mail";

type TestMailTable = ReturnType<typeof frameworkTables>["testMail"];

interface Row {
  readonly recipient: string;
  readonly sender: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly sentAt: string;
}

/** The handle's builders, typed for the plain Drizzle table (as KV does). */
interface Builders {
  insert(t: TestMailTable): { values(row: object): Promise<void> };
  select(fields: object): { from(t: TestMailTable): { where(c: unknown): { orderBy(...o: unknown[]): { limit(n: number): Promise<Row[]> } } } };
}

function tableOf(db: PortableDb): TestMailTable {
  const adapter = adapterOf(db);
  if (adapter === undefined) throw new FrameworkError("CORE.MISCONFIGURED", "the test-mail capture needs a SQL handle made by the framework's SQL adapter");
  return frameworkTables(adapter.dialect).testMail;
}

/** The capture sender over the stage database `db`, sending as `from`. */
export function sqlCaptureSender(db: PortableDb, from: string, now: () => Date = () => new Date()): MailSender {
  return {
    async send(input) {
      const table = tableOf(db);
      const m = capturedMessage(input, from, now());
      await (db as unknown as Builders)
        .insert(table)
        .values({ id: messageId(), recipient: m.to, sender: m.from, subject: m.subject, text: m.text, html: m.html, sentAt: m.sentAt });
    },
  };
}

/** The latest captured message to `address` in `db`, or undefined. */
export async function latestCapturedTo(db: PortableDb, address: string): Promise<MailMessage | undefined> {
  const table = tableOf(db);
  const rows = await (db as unknown as Builders)
    .select({ recipient: table.recipient, sender: table.sender, subject: table.subject, text: table.text, html: table.html, sentAt: table.sentAt })
    .from(table)
    .where(eq(table.recipient, address))
    .orderBy(desc(table.sentAt as never), desc(table.id as never))
    .limit(1);
  const row = rows[0];
  return row === undefined ? undefined : { to: row.recipient, from: row.sender, subject: row.subject, text: row.text, html: row.html, sentAt: row.sentAt };
}

/** What a test-stage entry gives the Cloudflare runtime. */
export interface TestMailCapture {
  /** The request's capture sender (the stage database, `from` from `FRAMEWORK_MAIL_FROM`). */
  sender(c: RuntimeContext, senderName: string): MailSender;
  /** Registers `GET /api/__framework/test-mail` on the framework's `/api` router. */
  routes(api: Hono<RuntimeEnv>): void;
}

export function registerTestMailRoute(api: Hono<RuntimeEnv>): void {
  api.get(TEST_MAIL_PATH, async (c) => {
    const to = c.req.query("to");
    if (to === undefined || to === "") throw new FrameworkError("HTTP.INVALID_INPUT", "the query parameter `to` is required");
    const message = await latestCapturedTo(c.var.sql, to);
    if (message === undefined) throw new FrameworkError("HTTP.NOT_FOUND", "no framework email was sent to this address");
    c.header("Cache-Control", "no-store");
    return c.json(message);
  });
}

export function createTestMailCapture(): TestMailCapture {
  return {
    // The stage's derived sender address when deploy set it; nothing is sent either way.
    sender: (c, senderName) => sqlCaptureSender(c.var.sql, formatFrom(senderName, workerMailFrom(c.env) ?? LOCAL_SENDER_ADDRESS)),
    routes: registerTestMailRoute,
  };
}
