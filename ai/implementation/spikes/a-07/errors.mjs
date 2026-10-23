// Follow-up to test.mjs B3: can the browser read storage's HTTP status when R2 rejects a
// signed request (wrong Content-Type, expired ticket)? FILES-REQ-006 needs that status.
import http from 'node:http';
import { AwsClient } from 'aws4fetch';
import { chromium } from 'playwright';
import { S3, loadState, log, addSecret } from './lib.mjs';

const ALLOWED = 'http://127.0.0.1:8701';
const st = loadState();
addSecret(st.accessKeyId); addSecret(st.secretAccessKey);
const aws = new AwsClient({ accessKeyId: st.accessKeyId, secretAccessKey: st.secretAccessKey, service: 's3', region: 'auto' });
async function sign(method, name, ct, expires = 900) {
  const u = new URL(`${S3}/${st.main}/${name}`);
  u.searchParams.set('X-Amz-Expires', String(expires));
  const headers = ct ? { 'Content-Type': ct } : {};
  return (await aws.sign(new Request(u, { method, headers }), { aws: { signQuery: true, allHeaders: true } })).url;
}

// Node: does R2 put CORS headers on error responses to requests carrying an allowed Origin?
const put = await sign('PUT', 'err/a.png', 'image/png');
for (const [label, url, ct] of [['wrong content type', put, 'text/html'], ['correct', put, 'image/png']]) {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': ct, Origin: ALLOWED }, body: 'x' });
  log('node PUT', label, '-> status', r.status, 'ACAO', r.headers.get('access-control-allow-origin'), 'vary', r.headers.get('vary'));
}
const expired = await sign('PUT', 'err/b.png', 'image/png', 1);
const expiredGet = await sign('GET', 'err/a.png', null, 1);
await new Promise((r) => setTimeout(r, 2500));
let r = await fetch(expired, { method: 'PUT', headers: { 'Content-Type': 'image/png', Origin: ALLOWED }, body: 'x' });
log('node PUT expired -> status', r.status, 'ACAO', r.headers.get('access-control-allow-origin'));
r = await fetch(expiredGet, { headers: { Origin: ALLOWED } });
log('node GET expired -> status', r.status, 'ACAO', r.headers.get('access-control-allow-origin'));
const missing = await sign('GET', 'err/none.png', null);
r = await fetch(missing, { headers: { Origin: ALLOWED } });
log('node GET missing -> status', r.status, 'ACAO', r.headers.get('access-control-allow-origin'));

// Browser: small bodies, so an early reject cannot be confused with a connection cut.
const srv = http.createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>a07</title>'); }).listen(8701, '127.0.0.1');
const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } });
const p = await (await browser.newContext()).newPage();
const cons = []; p.on('console', (m) => cons.push(m.text().replace(/https:\/\/\S+/g, '<url>')));
await p.goto(ALLOWED + '/');
const put2 = await sign('PUT', 'err/c.png', 'image/png');
const expired2 = await sign('PUT', 'err/d.png', 'image/png', 1);
const expiredGet2 = await sign('GET', 'err/a.png', null, 1);
await new Promise((r) => setTimeout(r, 2500));
const out = await p.evaluate(async ({ put2, expired2, expiredGet2, missing }) => {
  const xhr = (url, ct, size) => new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.upload.onprogress = () => {};
    x.onload = () => resolve({ status: x.status });
    x.onerror = () => resolve({ error: 'xhr error, status ' + x.status });
    x.open('PUT', url); x.setRequestHeader('Content-Type', ct); x.send(new Blob([new Uint8Array(size)]));
  });
  const f = async (url) => { try { const r = await fetch(url); return { status: r.status }; } catch (e) { return { error: String(e) }; } };
  return {
    wrongTypeSmall: await xhr(put2, 'text/html', 16),
    wrongTypeLarge: await xhr(put2, 'text/html', 20 * 1024 * 1024),
    okSmall: await xhr(put2, 'image/png', 16),
    expiredPut: await xhr(expired2, 'image/png', 16),
    expiredGet: await f(expiredGet2),
    missingGet: await f(missing),
  };
}, { put2, expired2, expiredGet2, missing });
log('browser (allowed origin)', out);
log('browser console', cons);
await browser.close(); srv.close();
