/**
 * One handler, two calling conventions.
 *
 * Vercel's Node runtime invokes /api files as (req, res); Vite's dev middleware does the same,
 * while Bun and the Edge runtime pass a web Request and expect a Response. Endpoints are
 * written web-style and wrapped here, so the same file serves local dev and production.
 */

export type WebHandler = (request: Request) => Promise<Response>;

interface NodeRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
}

interface NodeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: Uint8Array | string): void;
}

function nodeUrl(req: NodeRequest): string {
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost') as string;
  const proto = (req.headers['x-forwarded-proto'] ?? 'http') as string;
  return `${proto}://${host}${req.url ?? '/'}`;
}

async function nodeBody(req: NodeRequest): Promise<BodyInit | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body;
    if (req.body instanceof Uint8Array) return req.body as unknown as BodyInit;
    return JSON.stringify(req.body);
  }
  if (!req[Symbol.asyncIterator]) return undefined;

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    chunks.push(bytes);
    total += bytes.length;
  }
  if (total === 0) return undefined;
  const body = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.length;
  }
  return body as unknown as BodyInit;
}

const isNodeResponse = (value: unknown): value is NodeResponse =>
  typeof value === 'object' && value !== null && typeof (value as NodeResponse).setHeader === 'function';

/** Wrap a web-style handler so it also answers Vercel's (req, res) signature. */
export function universal(handle: WebHandler) {
  return async function handler(a: Request | NodeRequest, b?: unknown): Promise<Response | void> {
    if (!isNodeResponse(b)) return handle(a as Request);

    const req = a as NodeRequest;
    const res = b;
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers ?? {})) {
        if (value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      }
      const request = new Request(nodeUrl(req), {
        method: req.method ?? 'GET',
        headers,
        body: await nodeBody(req)
      });
      const response = await handle(request);
      res.statusCode = response.status || 200;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: String((error as Error)?.message ?? error) }));
    }
  };
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
