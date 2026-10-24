// Local file watcher: keeps every version of SST's .sst/log/* files (SST rewrites them on each run).
// Usage: node logwatch.mjs <logDir> <outDir>
import { readdirSync, statSync, copyFileSync, mkdirSync, existsSync, linkSync } from "node:fs";
import { join } from "node:path";
const [dir, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const seen = new Map();
let n = 0;
function tick() {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    const prev = seen.get(f);
    let cur = prev;
    if (!prev || prev.ino !== st.ino || st.size < prev.size) {
      n += 1;
      const tag = `${String(n).padStart(3, "0")}-${f}`;
      try { linkSync(p, join(out, `${tag}.link`)); } catch {}
      cur = { ino: st.ino, size: -1, tag };
    }
    if (st.size !== cur.size) {
      try { copyFileSync(p, join(out, `${cur.tag}.copy`)); } catch {}
    }
    seen.set(f, { ...cur, size: st.size });
  }
}
setInterval(tick, 1000);
tick();
