import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../api/tender';
import { DEFAULT_MODEL } from '../server/ai/anthropic';

/**
 * /api/tender, driven end to end against a stubbed `fetch` that answers the way Anthropic's API
 * does, streamed events included. There is no key on this machine, so what is proven here is
 * everything up to the wire: what is sent (the tender first and cached, strict tools, the refusal
 * fallback) and what happens with each reply that actually occurs, above all the failures.
 */

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

/** `hang`: stream these events, then never finish, the way a very long answer looks mid-flight */
type Reply = { status?: number; json?: unknown; sse?: string; hang?: string };

let calls: Call[];
let replies: Reply[];
/** Answers by request rather than in order, for calls the code makes in parallel. */
let route: ((call: Call) => Reply | undefined) | null;
const realFetch = globalThis.fetch;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  calls = [];
  replies = [];
  route = null;
  for (const key of ['ANTHROPIC_API_KEY', 'EDLY_AI_MODEL', 'EDLY_AI_RETRIES', 'EDLY_AI_DEADLINE_MS']) saved[key] = process.env[key];
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  /* a retry would replay the next stubbed reply and hide the failure under test */
  process.env.EDLY_AI_RETRIES = '0';
  delete process.env.EDLY_AI_MODEL;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    /* before a multipart upload the SDK fetches `data:,` to check FormData works; that is not a call to Anthropic */
    if (String(input).startsWith('data:')) return new Response('');
    const raw = init?.body;
    let body: unknown = raw;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const call: Call = { url: String(input instanceof Request ? input.url : input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body };
    calls.push(call);
    const reply = route?.(call) ?? replies.shift() ?? { json: {} };
    if (reply.hang !== undefined) {
      const events = reply.hang;
      /* like real fetch, abandon the body when the caller aborts */
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(events));
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
        }
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    if (reply.sse !== undefined) return new Response(reply.sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** A streamed Messages reply: one tool call, or none, then the stop reason. */
function stream(stop: string, tool?: { name: string; input: unknown }): string {
  const events: [string, unknown][] = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: DEFAULT_MODEL,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0 }
        }
      }
    ]
  ];
  if (tool) {
    events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: tool.name, input: {} } }]);
    events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } }]);
    events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
  }
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 640 } }]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

const apiError = (status: number, type: string, message: string): Reply => ({ status, json: { type: 'error', error: { type, message } } });

const post = (op: string, body: unknown): Promise<Response> =>
  handle(new Request(`http://localhost/api/tender?op=${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

const docs = [
  { n: 1, name: 'Acme RFP.pdf', kind: 'pdf', fileId: 'file_1', pages: 48 },
  { n: 2, name: 'Annex B.docx', kind: 'text', fileId: 'file_2', pages: 6 }
];
const platforms = [
  { id: 'openedx', name: 'Open edX', practice: 'EdTech / LMS', note: '', bundles: ['Identity & SSO'] },
  { id: 'moodle', name: 'Moodle', practice: 'EdTech / LMS', note: '', bundles: [] }
];
const catalog = [
  { id: 'SSO-1', bundle: 'B13', bundleName: 'Identity & SSO', name: 'Azure AD sign-on', category: 'Identity', status: 'Production', desc: 'SAML and OIDC sign-on' },
  { id: 'AS-1', bundle: 'B04', bundleName: 'Assessment', name: 'Proctored exams', category: 'Assessment', status: 'Estimation', desc: 'Proctoring | recording' }
];

/** The Messages request the SDK sent, as JSON. */
const sentMessage = (): Record<string, unknown> => {
  const call = calls.find((one) => one.url.includes('/v1/messages'));
  if (!call) throw new Error('no Messages call was made');
  return call.body as Record<string, unknown>;
};

describe('the probe', () => {
  it('says whether the AI is set up here, and which model it uses', async () => {
    process.env.EDLY_AI_MODEL = 'claude-opus-5-5';
    const body = (await (await handle(new Request('http://localhost/api/tender?probe=1'))).json()) as { configured: boolean; model: string };
    expect(body).toMatchObject({ configured: true, model: 'claude-opus-5-5' });

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.EDLY_AI_MODEL;
    const bare = (await (await handle(new Request('http://localhost/api/tender?probe=1'))).json()) as { configured: boolean; model: string };
    expect(bare).toMatchObject({ configured: false, model: 'claude-opus-5' });
  });
});

describe('uploading a tender file', () => {
  const upload = (bytes: Uint8Array, query = '&kind=pdf&name=Acme%20RFP.pdf'): Promise<Response> =>
    handle(new Request(`http://localhost/api/tender?op=upload${query}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes as unknown as BodyInit }));
  const pdf = new TextEncoder().encode('%PDF-1.7 a tender');

  it('stores it at Anthropic with an expiry, and hands back the file id', async () => {
    replies = [{ json: { id: 'file_abc', type: 'file', filename: 'Acme RFP.pdf', mime_type: 'application/pdf', size_bytes: 17, created_at: '2026-09-26T00:00:00Z', expires_at: '2026-09-29T00:00:00Z' } }];
    const response = await upload(pdf);
    const body = (await response.json()) as { ok: boolean; fileId: string; expiresAt: string; bytes: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, fileId: 'file_abc', expiresAt: '2026-09-29T00:00:00Z', bytes: 17 });
    expect(calls[0]?.url).toContain('/v1/files');
    expect(calls[0]?.method).toBe('POST');
    /* the expiry is the safety net for a tender nobody finishes: it goes whether or not anyone deletes it */
    const form = calls[0]?.body as FormData;
    expect(form.get('expires_in_seconds')).toBe(String(72 * 3600));
    expect((form.get('file') as File).type).toBe('application/pdf');
    /* the prefix is what lets `discard` tell our files from anyone else's in the workspace */
    expect((form.get('file') as File).name).toBe('edly-tender-Acme RFP.pdf');
  });

  it('uploads converted text as a text file', async () => {
    replies = [{ json: { id: 'file_txt', size_bytes: 5, expires_at: null } }];
    await upload(new TextEncoder().encode('hello'), '&kind=text&name=Annex%20B.docx');
    const file = (calls[0]?.body as FormData).get('file') as File;
    expect(file.name).toBe('edly-tender-Annex B.txt');
    expect(file.type).toMatch(/^text\/plain/);
  });

  it('refuses a file that is not what it claims, or is too big, before anything is sent', async () => {
    const fake = await upload(new TextEncoder().encode('<html>not a pdf</html>'));
    expect(fake.status).toBe(400);
    const big = await upload(new Uint8Array(4 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
    expect(((await big.json()) as { code: string }).code).toBe('too_large');
    expect(calls).toHaveLength(0);
  });

  it('says the AI is not set up rather than failing obscurely when there is no key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const response = await upload(pdf);
    const body = (await response.json()) as { code: string; error: string };
    expect(response.status).toBe(503);
    expect(body.code).toBe('not_configured');
    expect(body.error).toContain('ANTHROPIC_API_KEY');
  });
});

describe('the fit step', () => {
  it('sends the tender first and cached, with the same tools and fallback every call uses', async () => {
    replies = [
      {
        sse: stream('tool_use', {
          name: 'report_fit',
          input: { platform: 'openedx', confidence: 'high', reasons: ['Names Open edX'], alternatives: [{ platform: 'canvas', reason: 'Not offered' }], elsewhere: [], title: 'Acme LMS', client: 'Acme Academy', deadline: '2026-11-30', summary: 'A new LMS.', documents: [{ doc: 1, pages: 48 }], outline: [] }
        })
      }
    ];
    const response = await post('fit', { docs, platforms });
    const body = (await response.json()) as { ok: boolean; result: { fit: { platform: string; alternatives: unknown[] }; header: { deadline: string } }; tokens: { cacheRead: number; output: number } };

    expect(response.status).toBe(200);
    expect(body.result.fit.platform).toBe('openedx');
    /* canvas was not among the platforms sent, so it is not offered */
    expect(body.result.fit.alternatives).toEqual([]);
    expect(body.result.header.deadline).toBe('2026-11-30');
    expect(body.tokens).toMatchObject({ cacheRead: 90_000, output: 640 });

    const sent = sentMessage();
    const call = calls.find((one) => one.url.includes('/v1/messages'));
    expect(sent.model).toBe('claude-opus-5');
    expect(sent.thinking).toEqual({ type: 'adaptive' });
    expect(sent.fallbacks).toBe('default');
    expect(call?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(call?.headers.get('x-api-key')).toBe('sk-ant-test');

    const tools = sent.tools as { name: string; strict: boolean }[];
    expect(tools.map((tool) => tool.name)).toEqual(['report_fit', 'report_requirements', 'report_matches']);
    expect(tools.every((tool) => tool.strict)).toBe(true);

    const content = (sent.messages as { content: Record<string, unknown>[] }[])[0]?.content ?? [];
    /* the documents lead, so every later call over the same tender reads them from cache */
    expect(content[0]).toMatchObject({ type: 'document', source: { type: 'file', file_id: 'file_1' }, title: 'Document 1: Acme RFP.pdf' });
    expect(content[0]?.cache_control).toBeUndefined();
    expect(content[1]).toMatchObject({ type: 'document', source: { type: 'file', file_id: 'file_2' }, cache_control: { type: 'ephemeral', ttl: '1h' } });
    expect(String(content[1]?.context)).toContain('[[Part N]]');
    expect(content[2]?.type).toBe('text');
    expect(String(content[2]?.text)).toContain('- openedx: Open edX.');
  });

  it('refuses a request with no documents or no platforms to choose from', async () => {
    expect((await post('fit', { docs: [], platforms })).status).toBe(400);
    expect((await post('fit', { docs, platforms: [] })).status).toBe(400);
    expect((await post('fit', { docs: [{ n: 1, name: 'x', kind: 'pdf', fileId: '' }], platforms })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('the extraction step', () => {
  it('reads one range and narrows what comes back', async () => {
    replies = [
      {
        sse: stream('tool_use', {
          name: 'report_requirements',
          input: { requirements: [{ text: 'Single sign-on', quote: 'The platform shall support SSO', page: 4, section: 'Identity', priority: 'must', outOfScope: false }, { text: 'Lost page', quote: '', page: 900, section: '', priority: 'should', outOfScope: false }] }
        })
      }
    ];
    const response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    const body = (await response.json()) as { found: { page: number; doc: number }[] };

    expect(response.status).toBe(200);
    expect(body.found).toHaveLength(2);
    expect(body.found[0]).toMatchObject({ doc: 1, page: 4 });
    expect(body.found[1]?.page).toBe(0);

    const content = (sentMessage().messages as { content: Record<string, unknown>[] }[])[0]?.content ?? [];
    expect(String(content[2]?.text)).toContain('pages 1 to 20 inclusive');
  });

  it('says a refusal is a refusal, and still reports the tokens it cost', async () => {
    replies = [{ sse: stream('refusal') }];
    const response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    const body = (await response.json()) as { code: string; tokens: { input: number } };
    expect(response.status).toBe(422);
    expect(body.code).toBe('refused');
    expect(body.tokens.input).toBe(1200);
  });

  it('calls an answer cut off at the token limit truncated, so the browser splits the range', async () => {
    replies = [{ sse: stream('max_tokens', { name: 'report_requirements', input: { requirements: [] } }) }];
    const response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    expect(((await response.json()) as { code: string }).code).toBe('truncated');
  });

  it('calls an answer with no tool call a missing result, not an empty one', async () => {
    /* an empty list would read as "no requirements on these pages", which is a claim */
    replies = [{ sse: stream('end_turn') }];
    const response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    expect(response.status).toBe(502);
    expect(((await response.json()) as { code: string }).code).toBe('no_result');
  });

  it('turns the replies that happen in practice into something a person can act on', async () => {
    replies = [apiError(429, 'rate_limit_error', 'slow down')];
    let response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    expect(response.status).toBe(429);
    expect(((await response.json()) as { code: string }).code).toBe('rate_limited');

    replies = [apiError(401, 'authentication_error', 'invalid x-api-key')];
    response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    expect(((await response.json()) as { code: string; error: string }).error).toContain('rejected the API key');

    replies = [apiError(403, 'permission_error', 'no')];
    response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    expect(((await response.json()) as { code: string }).code).toBe('auth');

    replies = [apiError(404, 'not_found_error', 'File not found: file_1')];
    response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    expect(response.status).toBe(410);
    expect(((await response.json()) as { error: string }).error).toContain('no longer at Anthropic');

    replies = [apiError(400, 'invalid_request_error', 'prompt is too long: 1200000 tokens')];
    response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    expect(((await response.json()) as { code: string }).code).toBe('too_large');

    replies = [apiError(400, 'invalid_request_error', 'something else')];
    response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    expect(((await response.json()) as { code: string }).code).toBe('bad_request');

    replies = [apiError(529, 'overloaded_error', 'overloaded')];
    response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe('upstream');
  });

  it('asks for the rest of a document whose length nobody counted', async () => {
    replies = [{ sse: stream('tool_use', { name: 'report_requirements', input: { requirements: [] } }) }];
    await post('extract', { docs: [{ ...docs[0], pages: 0 }], range: { doc: 1, from: 21, to: 0 } });
    const content = (sentMessage().messages as { content: Record<string, unknown>[] }[])[0]?.content ?? [];
    expect(String(content[1]?.text)).toContain('pages 21 to the end');
  });

  it('refuses a range in a document the tender does not have', async () => {
    expect((await post('extract', { docs, range: { doc: 7, from: 1, to: 2 } })).status).toBe(400);
  });
});

describe('the match step', () => {
  it('caches the catalog ahead of the requirements, and drops ids the catalog does not have', async () => {
    replies = [
      {
        sse: stream('tool_use', {
          name: 'report_matches',
          input: {
            matches: [
              { id: 'R-01', kind: 'catalog', solutionIds: ['SSO-1'], confidence: 'high', reason: 'SSO bundle', remainder: '', area: '', integrations: 'Azure AD' },
              { id: 'R-02', kind: 'catalog', solutionIds: ['MADE-UP-7'], confidence: 'high', reason: 'Invented', remainder: '', area: '', integrations: '' }
            ]
          }
        })
      }
    ];
    const response = await post('match', {
      catalog,
      reqs: [
        { id: 'R-01', text: 'Single sign-on', section: 'Identity', priority: 'must' },
        { id: 'R-02', text: 'Blockchain certificates', section: '', priority: 'should' }
      ]
    });
    const body = (await response.json()) as { matches: Record<string, { kind: string; solutionIds: string[] }> };

    expect(body.matches['R-01']).toMatchObject({ kind: 'catalog', solutionIds: ['SSO-1'] });
    expect(body.matches['R-02']).toMatchObject({ kind: 'custom', solutionIds: [] });

    const content = (sentMessage().messages as { content: Record<string, unknown>[] }[])[0]?.content ?? [];
    expect(content[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    /* a pipe inside a description must not add a column the model then misreads */
    expect(String(content[0]?.text)).toContain('AS-1 | B04 | Assessment | Proctored exams | Assessment | Estimation | Proctoring / recording');
    expect(String(content[1]?.text)).toContain('R-02 [should] Blockchain certificates');
    /* no hours reach the model, so it cannot quote one */
    expect(String(content[0]?.text)).not.toMatch(/\bh\b|hours/);
  });

  it('refuses to match against an empty catalog, and does not call the AI for no requirements', async () => {
    expect((await post('match', { catalog: [], reqs: [{ id: 'R-01', text: 'x', section: '', priority: 'must' }] })).status).toBe(400);
    const none = (await (await post('match', { catalog, reqs: [] })).json()) as { ok: boolean; matches: object };
    expect(none).toMatchObject({ ok: true, matches: {} });
    expect(calls).toHaveLength(0);
  });

  it('refuses more requirements than one call should carry', async () => {
    const reqs = Array.from({ length: 61 }, (_, i) => ({ id: `R-${i}`, text: 'x', section: '', priority: 'must' }));
    expect((await post('match', { catalog, reqs })).status).toBe(400);
  });
});

describe('discarding tender files', () => {
  /* the calls run in parallel, so each file's replies are routed by its id rather than queued */
  const files: Record<string, { meta: Reply; remove?: Reply }> = {
    file_ours: { meta: { json: { id: 'file_ours', filename: 'edly-tender-RFP.pdf' } }, remove: { json: { id: 'file_ours', type: 'file_deleted' } } },
    file_gone: { meta: apiError(404, 'not_found_error', 'gone') },
    file_theirs: { meta: { json: { id: 'file_theirs', filename: 'payroll-2026.xlsx' } } },
    file_stuck: { meta: { json: { id: 'file_stuck', filename: 'edly-tender-Annex.txt' } }, remove: apiError(500, 'api_error', 'boom') }
  };
  const byFile = (call: Call): Reply | undefined => {
    const id = call.url.split('/v1/files/')[1]?.split('?')[0] ?? '';
    const file = files[id];
    if (!file) return undefined;
    return call.method === 'DELETE' ? file.remove : file.meta;
  };

  it('deletes its own files, and counts one already gone as deleted', async () => {
    route = byFile;
    const body = (await (await post('discard', { fileIds: ['file_ours', 'file_gone', 'file_stuck', 42] })).json()) as { deleted: string[]; failed: string[] };
    expect(body.deleted).toEqual(['file_ours', 'file_gone']);
    expect(body.failed).toEqual(['file_stuck']);
  });

  it('refuses to delete a file it did not upload, whatever id it is sent', async () => {
    /* the endpoint has no sign-in yet, so without this anyone could delete any file in the
       Anthropic workspace, another application's included */
    route = byFile;
    const body = (await (await post('discard', { fileIds: ['file_theirs'] })).json()) as { deleted: string[]; failed: string[] };
    expect(body).toMatchObject({ deleted: [], failed: ['file_theirs'] });
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });
});

describe('the call deadline', () => {
  it('gives up on an answer still streaming at the deadline, says so, and reports what it read', async () => {
    /* the SDK's own timeout stops at the response headers, so only an abort bounds a long answer;
       without one Vercel kills the function and the browser gets a gateway page */
    process.env.EDLY_AI_DEADLINE_MS = '60';
    const start = stream('end_turn').split('event: message_delta')[0] ?? '';
    replies = [{ hang: start }];
    const response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    const body = (await response.json()) as { code: string; tokens?: { input: number } };
    expect(response.status).toBe(504);
    expect(body.code).toBe('timeout');
    expect(body.tokens?.input).toBe(1200);
  });
});

describe('bad requests', () => {
  it('rejects a body that is not a JSON object, an unknown operation and the wrong method', async () => {
    const notJson = await handle(new Request('http://localhost/api/tender?op=fit', { method: 'POST', body: 'not json' }));
    expect(notJson.status).toBe(400);
    expect((await post('fit', [1, 2])).status).toBe(400);
    expect((await post('summon', {})).status).toBe(400);
    expect((await handle(new Request('http://localhost/api/tender'))).status).toBe(404);
    expect((await handle(new Request('http://localhost/api/tender', { method: 'PUT' }))).status).toBe(405);
  });

  it('refuses an oversized JSON body', async () => {
    const response = await handle(
      new Request('http://localhost/api/tender?op=match', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(3 * 1024 * 1024) }, body: '{}' })
    );
    expect(response.status).toBe(413);
  });
});
