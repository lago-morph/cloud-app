// Spike A-07 experiments: SigV4 query-signed R2 S3 URLs (aws4fetch 1.0.20) used directly by
// Node and by Playwright Chromium from an allowed and an unrelated origin.
// Signed URLs are never printed (they contain the access key id and a signature).
import http from 'node:http';
import crypto from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { chromium } from 'playwright';
import { S3, loadState, log, addSecret } from './lib.mjs';

const ALLOWED = 'http://127.0.0.1:8701';
const UNRELATED = 'http://127.0.0.1:8702';
const st = loadState();
if (!st.secretAccessKey) throw new Error('run setup.mjs first');
addSecret(st.accessKeyId); addSecret(st.secretAccessKey);
const aws = new AwsClient({ accessKeyId: st.accessKeyId, secretAccessKey: st.secretAccessKey, service: 's3', region: 'auto' });

const enc = (name) => name.split('/').map(encodeURIComponent).join('/');
const objUrl = (bucket, name) => `${S3}/${bucket}/${enc(name)}`;

// Ticket signing as the FILES adapter would do it.
async function signPut(bucket, name, contentType, { expires = 900, allHeaders = true } = {}) {
  const u = new URL(objUrl(bucket, name));
  u.searchParams.set('X-Amz-Expires', String(expires));
  const req = await aws.sign(new Request(u, { method: 'PUT', headers: { 'Content-Type': contentType } }), { aws: { signQuery: true, allHeaders } });
  return { url: req.url, signedHeaders: new URL(req.url).searchParams.get('X-Amz-SignedHeaders') };
}
async function signGet(bucket, name, { expires = 900 } = {}) {
  const u = new URL(objUrl(bucket, name));
  u.searchParams.set('X-Amz-Expires', String(expires));
  const req = await aws.sign(new Request(u, { method: 'GET' }), { aws: { signQuery: true } });
  return { url: req.url, signedHeaders: new URL(req.url).searchParams.get('X-Amz-SignedHeaders') };
}
async function nodeReq(method, url, headers = {}, body) {
  try {
    const r = await fetch(url, { method, headers, body });
    const t = await r.text();
    const code = (t.match(/<Code>([^<]+)<\/Code>/) || [])[1];
    return { status: r.status, code, acao: r.headers.get('access-control-allow-origin') };
  } catch (e) { return { error: String(e.cause?.code || e.message) }; }
}

const results = [];
const rec = (id, what, expected, observed, pass) => { results.push({ id, what, expected, observed, pass }); log(pass ? 'PASS' : 'FAIL', id, what, '| expected:', expected, '| observed:', observed); };

const CT = 'image/png';
const name = 'tickets/ä ö %/photo 1.png';

// ---- Node-side experiments ----
{
  const p = await signPut(st.main, 'node/a.png', CT);
  log('signed headers (allHeaders: true):', p.signedHeaders);
  const r = await nodeReq('PUT', p.url, { 'Content-Type': CT }, 'hello');
  rec('N1', 'signed PUT with ticket content type', 200, r, r.status === 200);
  const r2 = await nodeReq('PUT', p.url, { 'Content-Type': 'text/html' }, '<b>x</b>');
  rec('N2', 'same ticket, different Content-Type', '403', r2, r2.status === 403);
  const r3 = await nodeReq('PUT', p.url.replace('/node/a.png', '/node/b.png'), { 'Content-Type': CT }, 'x');
  rec('N3', 'ticket for a.png used for b.png', '403', r3, r3.status === 403);
  const r4 = await nodeReq('PUT', p.url, { 'Content-Type': CT }, 'hello again');
  rec('N4', 'ticket reused (repeated use until expiry)', 200, r4, r4.status === 200);
  const g = await signGet(st.main, 'node/a.png');
  log('signed headers (GET):', g.signedHeaders);
  const r5 = await nodeReq('GET', g.url);
  rec('N5', 'signed GET', 200, r5, r5.status === 200);
  const r6 = await nodeReq('GET', objUrl(st.main, 'node/a.png'));
  rec('N6', 'unsigned GET of existing object', '400/401/403', r6, [400, 401, 403].includes(r6.status));
  const r7 = await nodeReq('PUT', objUrl(st.main, 'node/c.png'), { 'Content-Type': CT }, 'x');
  rec('N7', 'unsigned PUT', '400/401/403', r7, [400, 401, 403].includes(r7.status));
  const d = await signPut(st.main, 'node/d.png', CT, { allHeaders: false });
  log('signed headers (aws4fetch default):', d.signedHeaders);
  const r8 = await nodeReq('PUT', d.url, { 'Content-Type': 'text/html' }, '<b>x</b>');
  rec('N8', 'DEFAULT aws4fetch signing (no allHeaders), different Content-Type', 'informational', r8, true);
  const e = await signPut(st.main, 'node/e.png', CT, { expires: 1 });
  await new Promise((res) => setTimeout(res, 3000));
  const r9 = await nodeReq('PUT', e.url, { 'Content-Type': CT }, 'x');
  rec('N9', 'expired ticket (X-Amz-Expires=1, used after 3 s)', '403', r9, r9.status === 403);
  const o = await signPut(st.other, 'x.png', CT);
  const r10 = await nodeReq('PUT', o.url, { 'Content-Type': CT }, 'x');
  rec('N10', 'token scoped to main: signed PUT to other bucket', '403', r10, r10.status === 403);
  const og = await signGet(st.other, 'x.png');
  const r11 = await nodeReq('GET', og.url);
  rec('N11', 'token scoped to main: signed GET on other bucket', '403', r11, r11.status === 403);
  const r12 = await nodeReq('GET', (await aws.sign(new Request(`${S3}/`), { aws: { signQuery: true } })).url);
  rec('N12', 'token scoped to main: ListBuckets', '403 (or list without other)', r12, r12.status === 403 || r12.status === 200);
  for (const [origin, id] of [[ALLOWED, 'N13'], [UNRELATED, 'N14']]) {
    const r = await nodeReq('OPTIONS', objUrl(st.main, 'x.png'), { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' });
    rec(id, `preflight OPTIONS from ${origin}`, origin === ALLOWED ? '200 + ACAO' : 'no ACAO for origin', r, origin === ALLOWED ? r.status === 200 && r.acao === ALLOWED : r.acao !== origin);
  }
}

// ---- Browser experiments ----
const page = '<!doctype html><meta charset="utf-8"><title>a07</title><img id="img">';
const servers = [8701, 8702].map((port) => http.createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); }).listen(port, '127.0.0.1'));
await new Promise((r) => setTimeout(r, 200));

const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } });
log('chromium version', browser.version());
const SIZE = 20 * 1024 * 1024;

async function inPage(origin, putUrl, getUrl, ct, blobType) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const consoleMsgs = [];
  p.on('console', (m) => consoleMsgs.push(m.text()));
  await p.goto(origin + '/');
  const out = await p.evaluate(async ({ putUrl, getUrl, ct, size, blobType }) => {
    const res = {};
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 255;
    const blob = new Blob([bytes], { type: blobType });
    // XHR PUT with upload progress (what uploadFile does)
    res.put = await new Promise((resolve) => {
      const x = new XMLHttpRequest();
      let progressEvents = 0, lastLoaded = 0;
      x.upload.onprogress = (e) => { progressEvents++; lastLoaded = e.loaded; };
      x.onload = () => resolve({ status: x.status, progressEvents, lastLoaded });
      x.onerror = () => resolve({ error: 'xhr error (status ' + x.status + ')', progressEvents, lastLoaded });
      x.open('PUT', putUrl);
      x.setRequestHeader('Content-Type', ct);
      x.send(blob);
    });
    // fetch GET + byte compare
    try {
      const r = await fetch(getUrl);
      const b = new Uint8Array(await r.arrayBuffer());
      let same = b.length === bytes.length;
      for (let i = 0; same && i < b.length; i++) if (b[i] !== bytes[i]) same = false;
      res.get = { status: r.status, length: b.length, byteExact: same, contentType: r.headers.get('content-type') };
    } catch (e) { res.get = { error: String(e) }; }
    // <img src> download (no CORS needed): proves the URL works in an element
    res.img = await new Promise((resolve) => {
      const i = document.getElementById('img');
      i.onload = () => resolve('load'); i.onerror = () => resolve('error (expected: bytes are not a real PNG)');
      i.src = getUrl;
    });
    return res;
  }, { putUrl, getUrl, ct, size: SIZE, blobType });
  await ctx.close();
  return { ...out, console: consoleMsgs.map((m) => m.replace(/https:\/\/\S+/g, '<url>')) };
}

{
  const put = await signPut(st.main, name, CT);
  const get = await signGet(st.main, name);
  const r = await inPage(ALLOWED, put.url, get.url, CT, CT);
  rec('B1', `allowed origin ${ALLOWED}: XHR PUT 20 MiB with ticket Content-Type`, 200, r.put, r.put.status === 200);
  rec('B2', `allowed origin: fetch GET byte-exact`, 'status 200, byteExact', r.get, r.get.status === 200 && r.get.byteExact);
  log('B-img (allowed)', r.img);
  log('B console (allowed)', r.console);

  const r2 = await inPage(ALLOWED, put.url, get.url, 'text/html', 'text/html');
  rec('B3', 'allowed origin: same ticket, PUT with Content-Type text/html', '403', r2.put, r2.put.status === 403);

  const put3 = await signPut(st.main, 'tickets/unrelated.png', CT);
  const r3 = await inPage(UNRELATED, put3.url, get.url, CT, CT);
  rec('B4', `unrelated origin ${UNRELATED}: XHR PUT`, 'browser error (CORS)', r3.put, !!r3.put.error);
  rec('B5', 'unrelated origin: fetch GET', 'browser error (CORS)', r3.get, !!r3.get.error);
  log('B-img (unrelated)', r3.img);
  log('B console (unrelated)', r3.console);
  // Confirm the unrelated PUT never landed
  const h = await nodeReq('GET', (await signGet(st.main, 'tickets/unrelated.png')).url);
  rec('B6', 'object from unrelated-origin PUT absent', '404', h, h.status === 404);
}

await browser.close();
servers.forEach((s) => s.close());
const failed = results.filter((r) => !r.pass).map((r) => r.id);
log('SUMMARY', results.length, 'checks;', failed.length ? 'FAILED: ' + failed.join(',') : 'all as expected');
