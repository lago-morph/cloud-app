// R2 list-order probe orchestrator (FILES-AC-001 root-cause Review). Writes redacted logs to OUT.
import { AwsClient } from "../../../../node_modules/aws4fetch/dist/aws4fetch.esm.mjs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, "out");
const WDIR = path.join(HERE, "worker");
fs.mkdirSync(OUT, { recursive: true });

const ACC = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOK = process.env.CLOUDFLARE_API_TOKEN;
if (!ACC || !TOK) throw new Error("missing env");
const rand = randomBytes(3).toString("hex");
const BUCKET = `spike-r2order-${rand}`;
const WORKER = `spike-r2order-${rand}`;
const PROBE_KEY = randomBytes(18).toString("base64url");
const CAP = 100;
const secrets = new Map([[TOK, "<CLOUDFLARE_API_TOKEN>"], [ACC, "<ACCOUNT_ID>"], [PROBE_KEY, "<PROBE_KEY>"]]);
const counts = { api: 0, wrangler: 0, worker: 0, s3: 0 };
const total = () => counts.api + counts.wrangler + counts.worker + counts.s3;
const log = [];
let n = 0;
let stopped = null;

function redact(s) {
  let t = String(s);
  for (const [v, r] of secrets) if (v) t = t.split(v).join(r);
  t = t.replace(/X-Amz-Signature=[0-9a-f]+/g, "X-Amz-Signature=<sig>").replace(/X-Amz-Credential=[^&\s"]+/g, "X-Amz-Credential=<cred>");
  t = t.replace(/<ETag>[^<]*<\/ETag>/g, "<ETag>&quot;<md5>&quot;</ETag>");
  t = t.replace(/\b[0-9a-f]{32}\b/gi, "<hex32>");
  return t;
}
const record = (e) => { e.n = ++n; e.cumulative = total(); log.push(e); console.log(redact(`#${e.n} [${e.kind}] ${e.method ?? ""} ${e.what ?? ""} -> ${e.status ?? ""} (total ${e.cumulative})`)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function counted(kind, url, init = {}) {
  if (stopped) throw new Error(`stopped: ${stopped}`);
  if (total() >= CAP) { stopped = "request cap reached"; throw new Error(stopped); }
  counts[kind]++;
  const r = await fetch(url, init);
  if (r.status === 429) stopped = `429 from ${kind}`;
  return r;
}

async function cf(method, p, body, note) {
  const r = await counted("api", `https://api.cloudflare.com/client/v4${p}`, {
    method,
    headers: { authorization: `Bearer ${TOK}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json().catch(() => ({}));
  record({ kind: "api", method, what: p, status: r.status, success: j.success, errors: j.errors, note });
  if (stopped) throw new Error(stopped);
  return { status: r.status, j };
}

function wrangler(args, what) {
  const res = spawnSync("../../../../node_modules/.bin/wrangler", args, { cwd: WDIR, encoding: "utf8", env: { ...process.env, WRANGLER_LOG: "debug", WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", FORCE_COLOR: "0" }, timeout: 300000 });
  const text = `${res.stdout}\n${res.stderr}`;
  const reqs = text.match(/-- START CF API REQUEST: [^\n]*/g) ?? [];
  counts.wrangler += reqs.length;
  return { res, text, reqs, what };
}

function finishWrangler(w) {
  const raw = w.text.replace(/\x1b\[[0-9;]*m/g, "");
  w.redactedTextLater = raw;
  record({ kind: "wrangler", method: "CLI", what: w.what, status: w.res.status, apiRequests: w.reqs.length, requestLines: w.reqs });
  if (/\b429\b/.test(raw) && /Too Many Requests|status: 429/i.test(raw)) stopped = "429 seen in wrangler output";
}

const hex = (k) => Buffer.from(k, "utf8").toString("hex");
const label = (k) => (Buffer.byteLength(k) > 40 ? `<${Buffer.byteLength(k)}-byte key>` : hex(k));

let workerUrl = null;
async function worker(p, body, note) {
  const r = await counted("worker", `${workerUrl}${p}`, { method: "POST", headers: { "x-probe": PROBE_KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  record({ kind: "worker", method: "POST", what: p, status: r.status, note, response: j ?? text.slice(0, 500) });
  if (stopped) throw new Error(stopped);
  return { status: r.status, j };
}

let s3 = null;
const S3_BASE = `https://${ACC}.r2.cloudflarestorage.com/${BUCKET}`;
const enc = (seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const keyPath = (k) => k.split("/").map(enc).join("/");

function decodeXml(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

async function s3List(id, params) {
  const url = new URL(S3_BASE);
  url.searchParams.set("list-type", "2");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let r, text, attempt = 0;
  for (;;) {
    const signed = await s3.sign(url.toString(), { method: "GET" });
    r = await counted("s3", signed.url, { method: "GET", headers: signed.headers });
    text = await r.text();
    if ((r.status === 401 || r.status === 403) && attempt < 4 && !stopped) { attempt++; record({ kind: "s3", method: "GET", what: `${id} (token not ready, retry)`, status: r.status, body: JSON.stringify(text.slice(0, 300)) }); await sleep(5000); continue; }
    break;
  }
  const urlEnc = params["encoding-type"] === "url";
  const keys = [...text.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => { const x = decodeXml(m[1]); return urlEnc ? decodeURIComponent(x.replace(/\+/g, " ")) : x; });
  const rawCtl = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text);
  const ctlRefs = /&#x?0*1;|&#x?0*[0-8bcef];/i.test(text);
  record({ kind: "s3", method: "GET", what: `${id} ListObjectsV2 ${new URLSearchParams(params).toString()}`, status: r.status, hex: keys.map(label), rawControlCharsInXml: rawCtl, controlCharRefsInXml: ctlRefs, xmlBody: JSON.stringify(text) });
  if (stopped) throw new Error(stopped);
  return { status: r.status, keys };
}

async function presigned(id, method, key, body) {
  const url = new URL(`${S3_BASE}/${keyPath(key)}`);
  url.searchParams.set("X-Amz-Expires", "900");
  const signed = await s3.sign(new Request(url, { method }), { aws: { signQuery: true } });
  const r = await counted("s3", signed.url, { method, ...(body !== undefined ? { body } : {}) });
  const text = await r.text();
  const pathOnly = new URL(signed.url).pathname.replace(BUCKET, "<bucket>");
  record({ kind: "s3", method, what: `${id} presigned ${method} ${pathOnly.length > 120 ? `${pathOnly.slice(0, 40)}…(${pathOnly.length} chars)` : pathOnly}`, status: r.status, keyBytes: Buffer.byteLength(key), bodyLength: text.length, body: JSON.stringify(text.slice(0, 400)) });
  if (stopped) throw new Error(stopped);
  return { status: r.status, text };
}

const Q = ["q/a", "q/a b", "q/a!", "q/a/b", "q/a0", "q/aa", "q/aé", "q/b"];
const T = ["t/a\u0001", "t/a b\u0001", "t/a/b\u0001"];
const LISTINGS = [
  { id: "L1", opts: { prefix: "q/" } },
  { id: "L2", opts: { prefix: "q/", include: ["httpMetadata"] } },
  { id: "L3", opts: { prefix: "q/", startAfter: "q/a" } },
  { id: "L4", opts: { prefix: "q/", startAfter: "q/a b" } },
  { id: "L5", opts: { prefix: "q/", limit: 2 }, follow: true },
  { id: "L6", opts: { prefix: "q/a" } },
  { id: "L7", opts: { prefix: "q/", delimiter: "/" } },
  { id: "L8", opts: { prefix: "t/" } },
];
const K1024 = `z/${"k".repeat(1022)}`;
const K1025 = `z/${"k".repeat(1023)}`;

let tokenId = null, bucketMade = false, workerDeployed = false;
const results = { bucket: "spike-r2order-<random>", rand };
const wranglerLogs = [];
try {
  const groups = await cf("GET", `/accounts/${ACC}/tokens/permission_groups`, undefined, "find permission group id");
  const g = (groups.j.result ?? []).find((x) => x.name === "Workers R2 Storage Bucket Item Write");
  if (!g) throw new Error("permission group not found");
  log[log.length - 1].errors = undefined;

  const b = await cf("POST", `/accounts/${ACC}/r2/buckets`, { name: BUCKET }, "create temporary bucket");
  if (!b.j.success) throw new Error("bucket create failed");
  bucketMade = true;

  const t = await cf("POST", `/accounts/${ACC}/tokens`, {
    name: `spike-r2order-${rand}`,
    expires_on: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    policies: [{ effect: "allow", permission_groups: [{ id: g.id }], resources: { [`com.cloudflare.edge.r2.bucket.${ACC}_default_${BUCKET}`]: "*" } }],
  }, "create temporary R2 token scoped to the bucket");
  if (!t.j.success) throw new Error("token create failed");
  tokenId = t.j.result.id;
  const { createHash } = await import("node:crypto");
  const secret = createHash("sha256").update(t.j.result.value).digest("hex");
  secrets.set(t.j.result.value, "<TOKEN_VALUE>"); secrets.set(tokenId, "<TOKEN_ID/ACCESS_KEY_ID>"); secrets.set(secret, "<SECRET_ACCESS_KEY>");
  s3 = new AwsClient({ accessKeyId: tokenId, secretAccessKey: secret, service: "s3", region: "auto" });

  fs.writeFileSync(path.join(WDIR, "wrangler.json"), JSON.stringify({ name: WORKER, main: "worker.js", compatibility_date: "2026-09-01", workers_dev: true, preview_urls: false, r2_buckets: [{ binding: "B", bucket_name: BUCKET }] }, null, 2));
  const d = wrangler(["deploy", "--config", "wrangler.json", "--var", `PROBE_KEY:${PROBE_KEY}`], "wrangler deploy");
  const m = d.text.match(/https:\/\/[a-z0-9-]+\.([a-z0-9-]+)\.workers\.dev/);
  if (m) { secrets.set(m[1], "<SUBDOMAIN>"); workerUrl = m[0]; }
  finishWrangler(d); wranglerLogs.push(d);
  if (d.res.status !== 0 || !workerUrl) throw new Error("deploy failed");
  workerDeployed = true;
  if (stopped) throw new Error(stopped);

  for (let i = 0; ; i++) {
    const r = await worker("/head", { keys: [] }, "readiness check");
    if (r.status === 200) break;
    if (i >= 7) throw new Error("worker not reachable");
    await sleep(4000);
  }

  results.put = await worker("/put", { keys: [...Q, ...T] }, "binding put of 11 one-byte objects");
  results.lists = await worker("/list", { listings: LISTINGS }, "binding listings L1-L8");

  results.s3 = {};
  results.s3.S1 = await s3List("S1", { prefix: "q/" });
  results.s3.S2 = await s3List("S2", { prefix: "q/", "start-after": "q/a" });
  results.s3.S3 = await s3List("S3", { prefix: "q/", "encoding-type": "url" });
  results.s3.S4 = await s3List("S4", { prefix: "t/" });
  results.s3.S5 = await s3List("S5", { prefix: "t/", "encoding-type": "url" });

  results.p1 = await presigned("P1", "GET", "t/a\u0001");
  results.p2 = await presigned("P2", "PUT", "t/up\u0001", "y");
  results.h1 = await worker("/head", { keys: ["t/up\u0001", "t/up"] }, "binding head after presigned PUT");
  results.p3 = await presigned("P3", "PUT", K1024, "z");
  results.p4 = await presigned("P4", "GET", K1024);
  results.p5 = await presigned("P5", "PUT", K1025, "z");
  results.h2 = await worker("/head", { keys: [K1024, K1025] }, "binding head of 1,024- and 1,025-byte keys");
  results.del = await worker("/delete-all", {}, "delete every object");
} catch (e) {
  results.error = String(e.message ?? e);
  console.log(redact(`ERROR: ${results.error}`));
} finally {
  const wasStopped = stopped;
  stopped = null; // cleanup must still run; note it
  results.stoppedBeforeCleanup = wasStopped;
  try {
    if (workerDeployed || workerUrl) { const w = wrangler(["delete", "--name", WORKER, "--force"], "wrangler delete"); finishWrangler(w); wranglerLogs.push(w); }
  } catch (e) { console.log(redact(`worker delete error ${e}`)); }
  try { if (bucketMade) await cf("DELETE", `/accounts/${ACC}/r2/buckets/${BUCKET}`, undefined, "delete bucket"); } catch (e) { console.log(redact(`bucket delete error ${e}`)); }
  try { if (tokenId) await cf("DELETE", `/accounts/${ACC}/tokens/${tokenId}`, undefined, "delete token"); } catch (e) { console.log(redact(`token delete error ${e}`)); }
  // Confirm by listing.
  const confirm = {};
  try {
    const bl = await cf("GET", `/accounts/${ACC}/r2/buckets?name_contains=spike-r2order`, undefined, "confirm: list buckets");
    confirm.bucketsMatching = (bl.j.result?.buckets ?? []).map((x) => x.name);
    confirm.ourBucketPresent = confirm.bucketsMatching.includes(BUCKET);
    const ws = await cf("GET", `/accounts/${ACC}/workers/scripts`, undefined, "confirm: list Worker scripts");
    confirm.scriptsTotal = (ws.j.result ?? []).length;
    confirm.scriptsMatching = (ws.j.result ?? []).map((x) => x.id).filter((x) => x.startsWith("spike-r2order"));
    confirm.ourWorkerPresent = confirm.scriptsMatching.includes(WORKER);
    const names = [];
    for (let page = 1; page <= 5; page++) {
      const tl = await cf("GET", `/accounts/${ACC}/tokens?per_page=50&page=${page}`, undefined, "confirm: list account tokens");
      names.push(...(tl.j.result ?? []).map((x) => ({ id: x.id, name: x.name })));
      if (!tl.j.result_info || page >= tl.j.result_info.total_pages) break;
    }
    confirm.tokensTotal = names.length;
    confirm.tokensMatching = names.filter((x) => x.name.startsWith("spike-r2order")).map((x) => x.name);
    confirm.ourTokenPresent = names.some((x) => x.id === tokenId);
  } catch (e) { confirm.error = String(e); }
  results.confirm = confirm;
  results.counts = { ...counts, total: total() };
  fs.writeFileSync(path.join(OUT, "requests.json"), redact(JSON.stringify(log, null, 2)));
  fs.writeFileSync(path.join(OUT, "results.json"), redact(JSON.stringify(results, null, 2)));
  wranglerLogs.forEach((w, i) => fs.writeFileSync(path.join(OUT, `wrangler-${i === 0 && w.what === "wrangler deploy" ? "deploy" : "delete"}.log`), redact(w.redactedTextLater ?? w.text)));
  console.log(redact(JSON.stringify({ counts: results.counts, confirm, stoppedBeforeCleanup: wasStopped, error: results.error }, null, 2)));
}
