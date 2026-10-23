// Removes everything setup.mjs/test.mjs created (objects, both buckets, the R2 token),
// verifies nothing named with this spike's prefix remains, then deletes the local state file.
import fs from 'node:fs';
import path from 'node:path';
import { cf, loadState, log, STATE_DIR } from './lib.mjs';

const st = loadState();
if (!st.prefix) { log('no state; nothing to do'); process.exit(0); }

for (const b of [st.main, st.other]) {
  let cursor;
  do {
    const r = await cf('GET', `/r2/buckets/${b}/objects?per_page=1000${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    if (!r.json.success) { log('list', b, r.status, r.json.errors); break; }
    for (const o of r.json.result) {
      const d = await cf('DELETE', `/r2/buckets/${b}/objects/${o.key.split('/').map(encodeURIComponent).join('/')}`);
      log('delete object', b, o.key, d.status, d.json.success);
    }
    cursor = r.json.result_info?.is_truncated ? r.json.result_info.cursor : undefined;
  } while (cursor);
  const d = await cf('DELETE', `/r2/buckets/${b}`);
  log('delete bucket', b, d.status, d.json.success, d.json.errors);
}
if (st.tokenId) {
  const d = await cf('DELETE', `/tokens/${st.tokenId}`);
  log('delete token', st.tokenName, d.status, d.json.success, d.json.errors);
}

// Verify: no bucket or token with this prefix remains.
const buckets = await cf('GET', '/r2/buckets?per_page=1000');
const leftB = (buckets.json.result?.buckets || []).filter((b) => b.name.startsWith(st.prefix)).map((b) => b.name);
const tokens = await cf('GET', '/tokens?per_page=100');
const leftT = (tokens.json.result || []).filter((t) => t.name.startsWith(st.prefix)).map((t) => t.name);
log('leftover buckets with prefix', st.prefix, leftB);
log('leftover tokens with prefix', st.prefix, leftT, '(token list status', tokens.status, tokens.json.success, ')');
if (!leftB.length && !leftT.length && tokens.json.success) {
  fs.rmSync(path.join(STATE_DIR, 'a07-state.json'));
  log('state file removed');
}
