// A-04 spike Worker: reports whether its secret, plain-text var and KV binding are present,
// without echoing the secret (only a SHA-256 prefix of the dummy value).
async function sha8(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const body = {
      path: new URL(request.url).pathname,
      secret: env.SPIKE_SECRET ? await sha8(env.SPIKE_SECRET) : null,
      var: env.SPIKE_VAR ?? null,
      kv: env.KV ? await env.KV.get("probe") : null,
    };
    return Response.json(body);
  },
};
