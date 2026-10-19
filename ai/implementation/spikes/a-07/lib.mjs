// Shared helpers for spike A-07. Run every script with
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node <script>
// Cloudflare API calls never carry an Authorization header: the sandbox proxy injects the token.
// Credentials (R2 access key secret) live only in STATE_DIR (outside the repo, mode 600).
import fs from 'node:fs';
import path from 'node:path';

export const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!ACCOUNT) throw new Error('CLOUDFLARE_ACCOUNT_ID missing');
export const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
export const S3 = `https://${ACCOUNT}.r2.cloudflarestorage.com`;
export const STATE_DIR = process.env.A07_STATE_DIR;
if (!STATE_DIR) throw new Error('A07_STATE_DIR missing (use a directory outside the repo)');
const STATE = path.join(STATE_DIR, 'a07-state.json');

export function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}
export function saveState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

// Redact anything account- or credential-shaped before printing.
let secrets = [];
export function addSecret(v) { if (v) secrets.push(String(v)); }
export function redact(text) {
  let t = String(text);
  for (const s of secrets) t = t.split(s).join('<redacted>');
  t = t.split(ACCOUNT).join('<account>');
  t = t.replace(/X-Amz-(Signature|Credential)=[^&\s"']+/g, 'X-Amz-$1=<redacted>');
  t = t.replace(/\b[0-9a-f]{32}\b/g, '<hex32>');
  t = t.replace(/\b[0-9a-f]{64}\b/g, '<hex64>');
  return t;
}
export function log(...a) { console.log(redact(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' '))); }

export async function cf(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}
