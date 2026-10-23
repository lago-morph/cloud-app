// Creates: two R2 buckets (main, other), a CORS policy on main limited to ALLOWED_ORIGIN,
// and an account API token scoped to "Workers R2 Storage Bucket Item Write" on main only.
// The token's S3 credentials (access key id = token id, secret = sha256(token value)) are kept
// only in STATE_DIR. Nothing credential-shaped is printed.
import crypto from 'node:crypto';
import { ACCOUNT, cf, loadState, saveState, log } from './lib.mjs';

export const ALLOWED_ORIGIN = 'http://127.0.0.1:8701';
const ITEM_WRITE = '2efd5506f9c8494dacb1fa10a3e7d5b6'; // Workers R2 Storage Bucket Item Write

const st = loadState();
if (!st.prefix) st.prefix = 'spike' + crypto.randomBytes(8).toString('base64').replace(/[^a-z]/g, '').padEnd(8, 'q').slice(0, 8);
st.main = `${st.prefix}-a07-main`;
st.other = `${st.prefix}-a07-other`;
st.tokenName = `${st.prefix}-a07-r2token`;
saveState(st);
log('prefix', st.prefix);

for (const name of [st.main, st.other]) {
  const r = await cf('POST', '/r2/buckets', { name });
  log('create bucket', name, r.status, r.json.success, r.json.errors);
}

const cors = {
  rules: [{
    allowed: { origins: [ALLOWED_ORIGIN], methods: ['PUT', 'GET'], headers: ['Content-Type'] },
    exposeHeaders: ['ETag'],
    maxAgeSeconds: 60,
  }],
};
let r = await cf('PUT', `/r2/buckets/${st.main}/cors`, cors);
log('put cors', r.status, r.json.success, r.json.errors);
r = await cf('GET', `/r2/buckets/${st.main}/cors`);
log('get cors', r.status, r.json.success, r.json.result);

const resource = `com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_${st.main}`;
const body = {
  name: st.tokenName,
  policies: [{ effect: 'allow', permission_groups: [{ id: ITEM_WRITE }], resources: { [resource]: '*' } }],
};
log('create token request', body);
r = await cf('POST', '/tokens', body);
if (r.json.success) {
  const { id, value } = r.json.result;
  st.tokenId = id;
  st.accessKeyId = id;
  st.secretAccessKey = crypto.createHash('sha256').update(value).digest('hex');
  saveState(st);
  log('create token', r.status, 'success', { name: r.json.result.name, status: r.json.result.status, policies: r.json.result.policies });
} else {
  log('create token', r.status, r.json.success, r.json.errors);
}
