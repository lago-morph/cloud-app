// The custom hashers produce BA's exact format: each hasher verifies the others' hashes (plain Node).
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { hashers } from "./src/hashers.js";

const all = { default: { hash: hashPassword, verify: verifyPassword }, ...hashers };
const pw = "correct horse battery staple ﬁ"; // includes a ligature to exercise NFKC
for (const [hn, h] of Object.entries(all)) {
  const t = performance.now();
  const hash = await h.hash(pw);
  const ht = performance.now() - t;
  const row = [];
  for (const [vn, v] of Object.entries(all)) row.push(`${vn}:${await v.verify({ hash, password: pw })}/${await v.verify({ hash, password: pw + "x" })}`);
  console.log(`hash by ${hn.padEnd(7)} (${ht.toFixed(0)} ms in Node) -> verify ok/wrong: ${row.join("  ")}`);
}
