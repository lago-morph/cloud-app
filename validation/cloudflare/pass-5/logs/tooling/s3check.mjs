// Pass-3 live checks with the account's R2 signing credential (the one every stage holds, DEC-0550).
// Reads framework/r2-signing.json from sst-state through the API (1 request, ledger.txt), keeps the
// values in memory only, and prints statuses, R2 error codes and response headers, never a value.
//   deny  : S3 ListObjectsV2 on prototype-backups and prototype-logs (expect 403), and on <control bucket> (expect 200)
//   inline <bucket>: PUT one object stored as application/octet-stream, presigned GET with
//          response-content-type=image/png and response-content-disposition=inline (expect those headers),
//          a plain presigned GET (expect the stored type), then DELETE the object.
// Usage: NODE_USE_ENV_PROXY=1 node s3check.mjs <label> deny <control bucket> | inline <bucket>
import { appendFileSync } from "node:fs";
import { AwsClient } from "/home/user/cloud-app/.claude/worktrees/agent-afb6e5aea64fb07c4/node_modules/aws4fetch/dist/aws4fetch.esm.mjs";

const P = "/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/p5";
const [label, mode, bucket] = process.argv.slice(2);
const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
const ledger = (line) => appendFileSync(`${P}/ledger.txt`, `${new Date().toISOString().slice(0, 19)}Z ${label} ${line}\n`);
const s3log = (line) => { appendFileSync(`${P}/s3-${label}.log`, `${new Date().toISOString()} ${line}\n`); console.log(line); };

const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/r2/buckets/sst-state/objects/framework%2Fr2-signing.json`, { headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
ledger(`GET r2/buckets/sst-state/objects/framework%2Fr2-signing.json -> ${r.status}`);
if (r.status === 429) { console.log("HTTP 429 - STOP"); process.exit(42); }
const rec = await r.json();
s3log(`signing record: deniedBuckets ${JSON.stringify(rec.deniedBuckets)}`);
const aws = new AwsClient({ accessKeyId: rec.accessKeyId, secretAccessKey: rec.secretAccessKey, service: "s3", region: "auto" });
const host = `https://${acct}.r2.cloudflarestorage.com`;
const code = (t) => (/<Code>([^<]*)<\/Code>/.exec(t) ?? [])[1] ?? "-";

async function send(method, url, init = {}, sign = {}) {
  const req = await aws.sign(url, { method, ...init, ...(Object.keys(sign).length ? { aws: sign } : {}) });
  const res = await fetch(sign.signQuery ? req.url : req, sign.signQuery ? { method } : undefined);
  const text = method === "HEAD" ? "" : await res.text();
  return { status: res.status, code: code(text), headers: Object.fromEntries(res.headers), text };
}

if (mode === "deny") {
  for (const b of ["prototype-backups", "prototype-logs", bucket]) {
    const a = await send("GET", `${host}/${b}?list-type=2&max-keys=1`);
    s3log(`S3 GET /${b}?list-type=2&max-keys=1 -> ${a.status} ${a.code}`);
  }
  const w = await send("PUT", `${host}/prototype-backups/pass3-deny-probe.txt`, { body: "x", headers: { "content-type": "text/plain" } });
  s3log(`S3 PUT /prototype-backups/pass3-deny-probe.txt -> ${w.status} ${w.code}`);
} else if (mode === "inline") {
  const key = `pass3-inline-probe-${Date.now()}.bin`;
  const png = Buffer.from("<HEX32+>", "hex");
  const put = await send("PUT", `${host}/${bucket}/${key}`, { body: png, headers: { "content-type": "application/octet-stream" } });
  s3log(`S3 PUT /<bucket>/${key} (stored application/octet-stream) -> ${put.status} ${put.code}`);
  const q = new URLSearchParams({ "response-content-type": "image/png", "response-content-disposition": 'inline; filename*=UTF-8\'\'probe.png', "X-Amz-Expires": "300" });
  const g = await send("GET", `${host}/${bucket}/${key}?${q}`, {}, { signQuery: true });
  s3log(`presigned GET with response-content-type=image/png, response-content-disposition=inline -> ${g.status}; content-type: ${g.headers["content-type"]}; content-disposition: ${g.headers["content-disposition"]}; x-content-type-options: ${g.headers["x-content-type-options"] ?? "absent"}`);
  const g2 = await send("GET", `${host}/${bucket}/${key}?X-Amz-Expires=300`, {}, { signQuery: true });
  s3log(`presigned GET without overrides -> ${g2.status}; content-type: ${g2.headers["content-type"]}; content-disposition: ${g2.headers["content-disposition"] ?? "absent"}`);
  const d = await send("DELETE", `${host}/${bucket}/${key}`);
  s3log(`S3 DELETE /<bucket>/${key} -> ${d.status}`);
}
