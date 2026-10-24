// Password hashers in BA's own format: `<salt hex(16 bytes)>:<scrypt(N=16384,r=16,p=1,dkLen=64) hex>`,
// where the salt *hex string* is the scrypt salt and the password is NFKC-normalised.
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { scryptAsync } from "@noble/hashes/scrypt.js";

const P = { N: 16384, r: 16, p: 1, dkLen: 64 };
const maxmem = 128 * P.N * P.r * 2;

function nodeKey(password, salt) {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, P.dkLen, { N: P.N, r: P.r, p: P.p, maxmem }, (e, k) => (e ? reject(e) : resolve(k))),
  );
}

const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");

export const hashers = {
  /** Custom hasher on node:crypto.scrypt (needs nodejs_compat in workerd). Constant-time compare. */
  node: {
    async hash(password) {
      const salt = randomBytes(16).toString("hex");
      return `${salt}:${(await nodeKey(password, salt)).toString("hex")}`;
    },
    async verify({ hash, password }) {
      const [salt, key] = hash.split(":");
      if (!salt || !key) return false;
      const expected = Buffer.from(key, "hex");
      const got = await nodeKey(password, salt);
      return expected.length === got.length && timingSafeEqual(expected, got);
    },
  },
  /** Pure-JS scrypt (@noble/hashes), i.e. what BA's default resolves to without the workerd/node export condition. */
  noble: {
    async hash(password) {
      const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
      return `${salt}:${toHex(await scryptAsync(password.normalize("NFKC"), salt, { ...P, maxmem }))}`;
    },
    async verify({ hash, password }) {
      const [salt, key] = hash.split(":");
      return toHex(await scryptAsync(password.normalize("NFKC"), salt, { ...P, maxmem })) === key;
    },
  },
};
