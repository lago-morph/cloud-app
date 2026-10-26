// Pass-4 step 2: which R2 credential prodcheck signs its tickets with, and a ticket round trip.
// A verified sink user (t.<domain>, left with no role) uploads one file through an upload ticket,
// reads it back through a download ticket, and deletes it. The tickets' X-Amz-Credential access key
// is compared (in memory) with the account signing record's accessKeyId and with the id of the
// legacy token reference-prodcheck-files-signing. Prints booleans and statuses, never a value.
// Usage: NODE_USE_ENV_PROXY=1 COMPLIANCE_TARGET=cloudflare npx tsx ticket.mts <prodcheck origin>
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
const W = "/home/user/cloud-app/.claude/worktrees/agent-afb6e5aea64fb07c4/tests/compliance/criteria";
const { sinkAddress } = await import("/home/user/cloud-app/.claude/worktrees/agent-afb6e5aea64fb07c4/packages/framework/src/provision/cloudflare/email.ts");
const { sinkMail, emailDomain } = await import(`${W}/cli/support/admins.ts`);
const { createVerifiedAccount, expectAnswer, httpBrowser, signIn, testDisplayName, testIp, testPassword } = await import(`${W}/pwd/support.ts`);

const P = "/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p5";
const out = (l: string) => { appendFileSync(`${P}/ticket.log`, `${new Date().toISOString()} ${l}\n`); console.log(l); };
const origin = process.argv[2]!;
const acct = process.env.CLOUDFLARE_ACCOUNT_ID!;
const H = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
const api = async (path: string) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}${path}`, { headers: H });
  appendFileSync(`${P}/ledger.txt`, `${new Date().toISOString().slice(0, 19)}Z 2-ticket GET ${path.split("?")[0]} -> ${r.status}\n`);
  if (r.status === 429) { out("HTTP 429 - STOP"); process.exit(42); }
  return r.json() as Promise<any>;
};
const record = await api("/r2/buckets/sst-state/objects/framework%2Fr2-signing.json");
const tokens = (await api("/tokens?per_page=50")).result as { id: string; name: string }[];
const legacy = tokens.find((t) => t.name === "reference-prodcheck-files-signing");
const signingToken = tokens.find((t) => t.name === "prototype-r2-signing");
out(`record tokenId is the listed prototype-r2-signing token: ${signingToken?.id === record.tokenId}; legacy token listed: ${legacy !== undefined}`);
const keyOf = (url: string) => decodeURIComponent(new URL(url, origin).searchParams.get("X-Amz-Credential") ?? "").split("/")[0];

const domain = await emailDomain();
const a = { email: sinkAddress(domain, `pass4-ticket-${randomBytes(6).toString("hex")}`), password: testPassword(), displayName: testDisplayName("Pass4 ticket") };
const b = { ...httpBrowser({ baseUrl: origin }), mail: sinkMail() };
await createVerifiedAccount(b, a, testIp());
expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
out("signed in a verified sink user on prodcheck");
const name = `pass4/ticket-${randomBytes(6).toString("hex")}.txt`;
const bytes = new TextEncoder().encode(`pass4 ${name}`);
const cookie = Object.entries(b.cookies()).map(([k, v]) => `${k}=${v}`).join("; ");
try {
  const up = expectAnswer(await b.post("/api/files/upload-ticket", { name, contentType: "text/plain" }), 200).json<{ ticket: { url: string } }>().ticket;
  const k1 = keyOf(up.url);
  out(`upload ticket: signed with the account credential: ${k1 === record.accessKeyId}; with the legacy token: ${legacy !== undefined && k1 === legacy.id}`);
  const put = await fetch(new URL(up.url, origin), { method: "PUT", headers: { "content-type": "text/plain" }, body: bytes, signal: AbortSignal.timeout(30_000) });
  out(`upload through the ticket -> ${put.status}`);
  const down = expectAnswer(await b.post("/api/files/download-ticket", { name }), 200).json<{ ticket: { url: string } }>().ticket;
  const k2 = keyOf(down.url);
  out(`download ticket: signed with the account credential: ${k2 === record.accessKeyId}; with the legacy token: ${legacy !== undefined && k2 === legacy.id}`);
  const got = await fetch(new URL(down.url, origin), { signal: AbortSignal.timeout(30_000) });
  const back = new Uint8Array(await got.arrayBuffer());
  out(`download through the ticket -> ${got.status}; bytes identical: ${Buffer.from(back).equals(Buffer.from(bytes))}`);
} finally {
  const d = await fetch(new URL(`/api/files/content?name=${encodeURIComponent(name)}`, origin), { method: "DELETE", headers: { cookie, origin }, signal: AbortSignal.timeout(30_000) });
  out(`delete the file through the app -> ${d.status}`);
}
