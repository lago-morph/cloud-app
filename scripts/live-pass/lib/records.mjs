// The live-pass records: files written locally under the run's records directory, every one
// scrubbed, then uploaded to the records bucket under `runs/<runId>/` by `sync()`. Files not yet
// uploaded are listed in `.unsynced.json`, so a later invocation uploads them.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const UNSYNCED = ".unsynced.json";
/** Append-only files started in this container whose earlier lines (from other containers) are not merged in yet. */
const UNMERGED = ".unmerged.json";

const contentType = (rel) => (rel.endsWith(".json") ? "application/json" : rel.endsWith(".jsonl") ? "application/x-ndjson" : rel.endsWith(".md") ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8");

/**
 * @param {{ dir: string, scrubber: ReturnType<typeof import("./scrub.mjs").createScrubber>, store: { get(key: string): Promise<string | null>, put(key: string, body: string, type?: string): Promise<void> } | null }} o
 */
export function createRecorder({ dir, scrubber, store }) {
  mkdirSync(dir, { recursive: true });
  const unsyncedPath = join(dir, UNSYNCED);
  const dirty = new Set(existsSync(unsyncedPath) ? JSON.parse(readFileSync(unsyncedPath, "utf8")) : []);
  const remember = () => writeFileSync(unsyncedPath, JSON.stringify([...dirty]));
  const unmergedPath = join(dir, UNMERGED);
  const unmerged = new Set(existsSync(unmergedPath) ? JSON.parse(readFileSync(unmergedPath, "utf8")) : []);
  const rememberUnmerged = () => writeFileSync(unmergedPath, JSON.stringify([...unmerged]));

  const write = (rel, content) => {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    dirty.add(rel);
    remember();
  };

  return {
    dir,
    json(rel, value) {
      write(rel, `${JSON.stringify(scrubber.value(value), null, 2)}\n`);
    },
    text(rel, value) {
      write(rel, scrubber.text(String(value)));
    },
    append(rel, value) {
      const path = join(dir, rel);
      mkdirSync(dirname(path), { recursive: true });
      if (!existsSync(path)) {
        // A new container: the records bucket may already hold this log's earlier lines.
        unmerged.add(rel);
        rememberUnmerged();
      }
      appendFileSync(path, `${JSON.stringify(scrubber.value(value))}\n`);
      dirty.add(rel);
      remember();
    },
    read(rel) {
      const path = join(dir, rel);
      return existsSync(path) ? readFileSync(path, "utf8") : null;
    },
    /** Uploads every changed file; returns what failed (kept for the next sync). */
    async sync() {
      if (store === null) return { uploaded: 0, failed: [...dirty] };
      let uploaded = 0;
      const failed = [];
      for (const rel of [...dirty]) {
        const path = join(dir, rel);
        if (!existsSync(path)) {
          dirty.delete(rel);
          continue;
        }
        try {
          if (unmerged.has(rel)) {
            // Never overwrite earlier lines: read them first (a failed read keeps the file for the next sync).
            const earlier = await store.get(rel);
            if (earlier !== null && earlier !== "") writeFileSync(path, `${earlier}${earlier.endsWith("\n") ? "" : "\n"}${readFileSync(path, "utf8")}`);
            unmerged.delete(rel);
            rememberUnmerged();
          }
          await store.put(rel, readFileSync(path, "utf8"), contentType(rel));
          dirty.delete(rel);
          uploaded += 1;
        } catch (e) {
          failed.push(`${rel}: ${e.message}`);
        }
      }
      remember();
      return { uploaded, failed };
    },
    /** Marks every file as changed, so the next sync uploads all of them (the final upload). */
    markAll() {
      const walk = (d) => {
        for (const name of readdirSync(d)) {
          const p = join(d, name);
          if (statSync(p).isDirectory()) walk(p);
          else if (name !== UNSYNCED && name !== UNMERGED) dirty.add(relative(dir, p));
        }
      };
      walk(dir);
      remember();
    },
  };
}
