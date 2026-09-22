/* One handler, two calling conventions.

   Vercel's Node.js runtime invokes /api files as (req, res) — Node's IncomingMessage and
   ServerResponse. Bun's own server (and the Edge runtime) passes a web Request and expects a
   Response. Rather than write each endpoint twice, endpoints are written web-style and wrapped
   here, so the same file runs locally under `bun dev` and deployed on Vercel. */

function nodeUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return proto + '://' + host + (req.url || '/');
}

async function nodeBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.body != null) {
    if (typeof req.body === 'string') return req.body;
    if (req.body instanceof Uint8Array) return req.body;
    return JSON.stringify(req.body);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const u8 = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    chunks.push(u8);
    total += u8.length;
  }
  if (!total) return undefined;
  const body = new Uint8Array(total);
  let at = 0;
  chunks.forEach(c => { body.set(c, at); at += c.length; });
  return body;
}

/** Wrap a web-style handler so it also answers Vercel's (req, res) signature. */
export function universal(handle) {
  return async function (a, b) {
    /* web: (Request) -> Response */
    if (!b || typeof b.setHeader !== 'function') return handle(a);

    /* node: (req, res) */
    const req = a, res = b;
    try {
      const headers = new Headers();
      Object.entries(req.headers || {}).forEach(([k, v]) => {
        if (v == null) return;
        headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      });
      const request = new Request(nodeUrl(req), {
        method: req.method || 'GET',
        headers,
        body: await nodeBody(req)
      });
      const out = await handle(request);
      res.statusCode = out.status || 200;
      out.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(new Uint8Array(await out.arrayBuffer()));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
    }
  };
}

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
