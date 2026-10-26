// S2 (offline): wall and CPU time of one BA-format scrypt hash and one verify inside local workerd.
// Wall: measured around dispatchFetch (workerd freezes Date/performance.now during compute).
// CPU: utime+stime delta of the workerd child process from /proc (CLK_TCK=100 -> 10 ms ticks, amortised over N).
// Each figure is net of a no-op request ("none") measured the same way.
// Usage: node bench.mjs [bundle=dist/worker.js] [N=20] [date] [flags]
import { readFileSync, readdirSync } from "node:fs";
import { start } from "./run-workerd.mjs";

const bundle = process.argv[2] ?? "dist/worker.js";
const N = Number(process.argv[3] ?? 20);
const date = process.argv[4] ?? "2026-10-01";
const flags = (process.argv[5] ?? "nodejs_compat").split(",").filter(Boolean);
const TICK_MS = 10;

function descendants(root) {
  const all = readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map((pid) => {
    try {
      const s = readFileSync(`/proc/${pid}/stat`, "utf8");
      const rest = s.slice(s.lastIndexOf(")") + 2).split(" ");
      return { pid: Number(pid), comm: s.slice(s.indexOf("(") + 1, s.lastIndexOf(")")), ppid: Number(rest[1]) };
    } catch { return null; }
  }).filter(Boolean);
  const out = [];
  const walk = (p) => { for (const c of all.filter((x) => x.ppid === p)) { out.push(c); walk(c.pid); } };
  walk(root);
  return out;
}
function cpuTicks(pids) {
  let t = 0;
  for (const pid of pids) {
    const s = readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = s.slice(s.lastIndexOf(")") + 2).split(" ");
    t += Number(rest[11]) + Number(rest[12]); // utime, stime
  }
  return t;
}

const { mf, send } = await start({ bundle, flags, date });
await send("/spike/bench?mode=none"); // warm up
const workerd = descendants(process.pid).filter((p) => p.comm.includes("workerd")).map((p) => p.pid);
console.log(`bundle=${bundle} compatibility_date=${date} flags=${JSON.stringify(flags)} N=${N} workerd pids=${workerd.join(",")}`);

async function measure(mode, op) {
  await send(`/spike/bench?mode=${mode}&op=hash`); // warm (JIT, and a stored hash for op=verify)
  const c0 = cpuTicks(workerd);
  const walls = [];
  let last;
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    last = await send(`/spike/bench?mode=${mode}&op=${op}`);
    walls.push(performance.now() - t);
  }
  const cpu = ((cpuTicks(workerd) - c0) * TICK_MS) / N;
  walls.sort((a, b) => a - b);
  return { mode, op, wallMedian: walls[Math.floor(N / 2)], wallP90: walls[Math.floor(N * 0.9)], cpuMean: cpu, last: last.json };
}

const base = await measure("none", "both");
console.log(`baseline no-op request: wall median ${base.wallMedian.toFixed(1)} ms, cpu ${base.cpuMean.toFixed(1)} ms`);
const modes = process.argv[6] ? process.argv[6].split(",") : ["default", "node", "noble"];
for (const mode of modes) {
  for (const op of ["hash", "verify"]) {
    const r = await measure(mode, op);
    console.log(
      `${mode.padEnd(8)} ${op.padEnd(6)} wall median ${(r.wallMedian - base.wallMedian).toFixed(1).padStart(7)} ms  p90 ${(r.wallP90 - base.wallMedian).toFixed(1).padStart(7)} ms  cpu ${(r.cpuMean - base.cpuMean).toFixed(1).padStart(7)} ms   ok=${r.last.ok} format=${r.last.format}`,
    );
  }
}
await mf.dispose();
