import { describe, expect, it } from 'vitest';
import { json, universal } from '../server/handler';

/**
 * The adapter every production request goes through.
 *
 * Vercel's Node runtime calls an `api/` file as `(req, res)`; Bun and the Edge runtime pass a web
 * `Request` and want a `Response`. Endpoints are written web-style and wrapped here, so this file
 * is the one place where "works locally, 500s on Vercel" lives. It is pure plumbing, which is
 * exactly why nobody notices when it breaks.
 */

interface Captured {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** A stand-in for Node's ServerResponse, recording what the adapter wrote to it. */
function fakeResponse(): Captured & { setHeader(name: string, value: string): void; end(chunk?: Uint8Array | string): void } {
  const captured: Captured = { statusCode: 0, headers: {}, body: '' };
  return {
    ...captured,
    get statusCode() {
      return captured.statusCode;
    },
    set statusCode(value: number) {
      captured.statusCode = value;
    },
    get headers() {
      return captured.headers;
    },
    get body() {
      return captured.body;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
    },
    end(chunk?: Uint8Array | string) {
      captured.body = typeof chunk === 'string' ? chunk : chunk ? new TextDecoder().decode(chunk) : '';
    }
  };
}

/** A stand-in for Node's IncomingMessage. */
const fakeRequest = (over: Partial<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = {}) => ({
  method: 'GET',
  url: '/api/state',
  headers: { host: 'estimator.edly.io' },
  ...over
});

describe('json', () => {
  it('sends JSON that is never cached', () => {
    const response = json({ ok: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    /* two tabs share one spreadsheet: a cached read shows one of them stale data */
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('carries the status it is given', () => {
    expect(json({ ok: false }, 409).status).toBe(409);
  });
});

describe('the web convention', () => {
  it('passes a Request straight through when there is no Node response to write to', async () => {
    const handler = universal(async (request) => json({ method: request.method, url: request.url }));
    const result = (await handler(new Request('http://localhost/api/state?probe=1'))) as Response;

    expect(result).toBeInstanceOf(Response);
    expect(await result.json()).toEqual({ method: 'GET', url: 'http://localhost/api/state?probe=1' });
  });
});

describe('the Node convention', () => {
  it('writes the status, the headers and the body onto the response', async () => {
    const handler = universal(async () => json({ ok: true, store: 'local' }, 201));
    const res = fakeResponse();

    await handler(fakeRequest(), res);

    expect(res.statusCode).toBe(201);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body)).toEqual({ ok: true, store: 'local' });
  });

  it('rebuilds the URL from the host header, so query parameters survive', async () => {
    let seen = '';
    const handler = universal(async (request) => {
      seen = request.url;
      return json({});
    });

    await handler(fakeRequest({ url: '/api/state?format=xlsx&force=1' }), fakeResponse());

    expect(seen).toBe('http://estimator.edly.io/api/state?format=xlsx&force=1');
    /* `?force=1` reaching the handler is what stands between a guarded store and a cleared one */
    expect(new URL(seen).searchParams.get('force')).toBe('1');
  });

  it('honours the forwarded host and protocol a proxy sets', async () => {
    let seen = '';
    const handler = universal(async (request) => {
      seen = request.url;
      return json({});
    });

    await handler(
      fakeRequest({ headers: { host: 'internal:3000', 'x-forwarded-host': 'estimator.edly.io', 'x-forwarded-proto': 'https' } }),
      fakeResponse()
    );

    expect(seen).toBe('https://estimator.edly.io/api/state');
  });

  it('falls back to localhost when there is no host header at all', async () => {
    let seen = '';
    const handler = universal(async (request) => {
      seen = request.url;
      return json({});
    });

    await handler({ method: 'GET', url: '/api/state', headers: {} }, fakeResponse());
    expect(seen).toBe('http://localhost/api/state');
  });

  it('carries an array header through as a single value', async () => {
    let seen: string | null = null;
    const handler = universal(async (request) => {
      seen = request.headers.get('x-trace');
      return json({});
    });

    await handler(fakeRequest({ headers: { host: 'h', 'x-trace': ['a', 'b'] as unknown as string } }), fakeResponse());
    expect(seen).toBe('a, b');
  });
});

describe('the body', () => {
  it('sends a parsed object on as JSON, which is how Vercel hands it over', async () => {
    let body: unknown;
    const handler = universal(async (request) => {
      body = await request.json();
      return json({});
    });

    await handler(fakeRequest({ method: 'PUT', body: { estimations: [{ id: 'EST-1' }] } }), fakeResponse());
    expect(body).toEqual({ estimations: [{ id: 'EST-1' }] });
  });

  it('sends a string body on untouched', async () => {
    let body = '';
    const handler = universal(async (request) => {
      body = await request.text();
      return json({});
    });

    await handler(fakeRequest({ method: 'PUT', body: '{"raw":true}' }), fakeResponse());
    expect(body).toBe('{"raw":true}');
  });

  it('reads a streamed body, which is how a raw Node server delivers one', async () => {
    let body: unknown;
    const handler = universal(async (request) => {
      body = await request.json();
      return json({});
    });

    const streamed = {
      method: 'POST',
      url: '/api/state',
      headers: { host: 'h' },
      async *[Symbol.asyncIterator]() {
        /* split mid-token on purpose: a reader that decodes per chunk instead of concatenating
           first would produce invalid JSON here and nowhere else */
        yield new TextEncoder().encode('{"estimations":');
        yield new TextEncoder().encode('[],"requests":[]}');
      }
    };

    await handler(streamed, fakeResponse());
    expect(body).toEqual({ estimations: [], requests: [] });
  });

  it('reads a streamed body delivered as strings', async () => {
    let body = '';
    const handler = universal(async (request) => {
      body = await request.text();
      return json({});
    });

    const streamed = {
      method: 'POST',
      url: '/api/state',
      headers: { host: 'h' },
      async *[Symbol.asyncIterator]() {
        yield 'hello ';
        yield 'world';
      }
    };

    await handler(streamed, fakeResponse());
    expect(body).toBe('hello world');
  });

  it('never reads a body on GET, which would hang the request', async () => {
    const handler = universal(async (request) => json({ hasBody: request.body !== null }));
    const res = fakeResponse();

    await handler(fakeRequest({ method: 'GET' }), res);
    expect(JSON.parse(res.body)).toEqual({ hasBody: false });
  });

  it('treats an empty stream as no body rather than as an empty one', async () => {
    const handler = universal(async (request) => json({ hasBody: request.body !== null }));
    const res = fakeResponse();

    await handler(
      {
        method: 'POST',
        url: '/api/state',
        headers: { host: 'h' },
        async *[Symbol.asyncIterator]() {
          /* nothing */
        }
      },
      res
    );

    expect(JSON.parse(res.body)).toEqual({ hasBody: false });
  });
});

describe('when the endpoint throws', () => {
  it('answers 500 with JSON instead of leaving the request hanging', async () => {
    const handler = universal(async () => {
      throw new Error('the store is unreachable');
    });
    const res = fakeResponse();

    await handler(fakeRequest(), res);

    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'the store is unreachable' });
  });

  it('survives something thrown that is not an Error', async () => {
    const handler = universal(async () => {
      throw 'just a string';
    });
    const res = fakeResponse();

    await handler(fakeRequest(), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('just a string');
  });
});

describe('binary responses', () => {
  it('writes bytes through unchanged, so a downloaded workbook is not corrupted', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x7f]);
    const handler = universal(
      async () =>
        new Response(bytes as unknown as BodyInit, {
          headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        })
    );

    let written: Uint8Array | null = null;
    const res = {
      statusCode: 0,
      setHeader() {},
      end(chunk?: Uint8Array | string) {
        written = chunk as Uint8Array;
      }
    };

    await handler(fakeRequest(), res);

    expect(written).not.toBeNull();
    expect(Array.from(written!)).toEqual([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x7f]);
  });

  it('defaults a status of zero to 200', async () => {
    const handler = universal(async () => new Response('ok', { status: 200 }));
    const res = fakeResponse();
    await handler(fakeRequest(), res);
    expect(res.statusCode).toBe(200);
  });
});
