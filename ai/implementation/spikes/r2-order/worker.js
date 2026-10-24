// Temporary probe Worker (FILES-AC-001 R2 list order). Binding B = the temporary bucket.
const hex = (k) => [...new TextEncoder().encode(k)].map((b) => b.toString(16).padStart(2, "0")).join("");
const err = (e) => String(e && e.message ? e.message : e);

export default {
  async fetch(req, env) {
    if (req.headers.get("x-probe") !== env.PROBE_KEY) return new Response("forbidden", { status: 403 });
    const path = new URL(req.url).pathname;
    const body = req.method === "POST" ? await req.json() : {};
    const out = [];
    if (path === "/put") {
      for (const k of body.keys) {
        try { const o = await env.B.put(k, "x"); out.push({ op: "put", hex: hex(k), ok: o !== null, storedHex: o ? hex(o.key) : null }); }
        catch (e) { out.push({ op: "put", hex: hex(k), error: err(e) }); }
      }
    } else if (path === "/list") {
      for (const l of body.listings) {
        const pages = [];
        let cursor;
        try {
          do {
            const opts = { ...l.opts };
            if (cursor) opts.cursor = cursor;
            const r = await env.B.list(opts);
            pages.push({
              opts: { ...l.opts, ...(cursor ? { cursor: "<R2 cursor>" } : {}) },
              hex: r.objects.map((o) => hex(o.key)),
              json: r.objects.map((o) => JSON.stringify(o.key)),
              truncated: r.truncated,
              delimitedPrefixes: r.delimitedPrefixes ?? [],
              httpMetadataPresent: r.objects.map((o) => o.httpMetadata !== undefined),
            });
            cursor = l.follow && r.truncated ? r.cursor : undefined;
          } while (cursor && pages.length < 20);
          out.push({ id: l.id, pages });
        } catch (e) { out.push({ id: l.id, pages, error: err(e) }); }
      }
    } else if (path === "/head") {
      for (const k of body.keys) {
        try { const o = await env.B.head(k); out.push({ op: "head", hex: k.length > 40 ? `<${new TextEncoder().encode(k).length} bytes>` : hex(k), found: o !== null, size: o ? o.size : null, keyBytes: o ? new TextEncoder().encode(o.key).length : null }); }
        catch (e) { out.push({ op: "head", error: err(e) }); }
      }
    } else if (path === "/delete-all") {
      const all = [];
      let cursor;
      do {
        const r = await env.B.list(cursor ? { cursor } : {});
        all.push(...r.objects.map((o) => o.key));
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
      if (all.length) await env.B.delete(all);
      const after = await env.B.list();
      out.push({ op: "delete-all", deleted: all.length, deletedKeys: all.map((k) => (k.length > 40 ? `<${new TextEncoder().encode(k).length} bytes>` : hex(k))), remaining: after.objects.length });
    } else return new Response("not found", { status: 404 });
    return Response.json(out);
  },
};
