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
  for (const key of ['ANTHROPIC_API_KEY', 'EDLY_AI_MODEL', 'EDLY_AI_RETRIES', 'EDLY_AI_DEADLINE_MS', 'EDLY_AI_EFFORT', 'EDLY_AI_TENDER_LIMIT_USD']) saved[key] = process.env[key];
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  /* a retry would replay the next stubbed reply and hide the failure under test */
  process.env.EDLY_AI_RETRIES = '0';
  delete process.env.EDLY_AI_MODEL;
  delete process.env.EDLY_AI_EFFORT;
  delete process.env.EDLY_AI_TENDER_LIMIT_USD;

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

/**
 * A streamed Messages reply: one tool call, or none, then the stop reason. `model` is the one that
 * answered. `start` joins the usage the reply opens with, where the cache-write breakdown comes;
 * `usage` joins the final one, where `iterations` comes after a fallback. The SDK keeps only some
 * counters from the final usage, so a field in the wrong one is silently lost, as it would be live.
 */
function stream(
  stop: string,
  tool?: { name: string; input: unknown },
  reply: { model?: string; start?: Record<string, unknown>; usage?: Record<string, unknown> } = {}
): string {
  const events: [string, unknown][] = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: reply.model ?? DEFAULT_MODEL,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0, ...reply.start }
        }
      }
    ]
  ];
  if (tool) {
    events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: tool.name, input: {} } }]);
    events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } }]);
    events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
  }
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 640, ...reply.usage } }]);
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
    /* the way back for a key that cannot use the default yet */
    process.env.EDLY_AI_MODEL = 'claude-opus-5';
    const body = (await (await handle(new Request('http://localhost/api/tender?probe=1'))).json()) as { configured: boolean; model: string };
    expect(body).toMatchObject({ configured: true, model: 'claude-opus-5' });

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.EDLY_AI_MODEL;
    const bare = (await (await handle(new Request('http://localhost/api/tender?probe=1'))).json()) as { configured: boolean; model: string };
    /* Opus 5.5: cheaper per token than Opus 5, and cheaper still to read from cache */
    expect(bare).toMatchObject({ configured: false, model: 'claude-opus-5-5' });
  });
});

describe('what a tender may spend', () => {
  const limit = async (): Promise<unknown> => ((await (await handle(new Request('http://localhost/api/tender?probe=1'))).json()) as { limit: unknown }).limit;

  it('tells the browser the limit, $4 unless the server sets another', async () => {
    expect(await limit()).toBe(4);
    process.env.EDLY_AI_TENDER_LIMIT_USD = '12.5';
    expect(await limit()).toBe(12.5);
    /* a typo or a zero must not leave every tender unable to spend anything */
    for (const value of ['', 'four', '0', '-3']) {
      process.env.EDLY_AI_TENDER_LIMIT_USD = value;
      expect(await limit()).toBe(4);
    }
  });
});

describe('what each call cost', () => {
  const extract = async (): Promise<{ status: number; tokens: { input: number; output: number; cacheRead: number; usd: number } }> => {
    const response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    const body = (await response.json()) as { tokens: { input: number; output: number; cacheRead: number; usd: number } };
    return { status: response.status, tokens: body.tokens };
  };

  it('prices a call at the published rates of the model that answered it', async () => {
    replies = [{ sse: stream('tool_use', { name: 'report_requirements', input: { requirements: [] } }) }];
    /* Opus 5.5: 1,200 in at $4, 90,000 from cache at $0.20, 640 out at $20, per million */
    expect((await extract()).tokens.usd).toBeCloseTo(0.0048 + 0.018 + 0.0128, 10);

    /* asked of Opus 5.5 and answered by Opus 5, as a request the refusal fallback routed is: the
       answer is billed at Opus 5's rates, nearly twice as much */
    replies = [{ sse: stream('tool_use', { name: 'report_requirements', input: { requirements: [] } }, { model: 'claude-opus-5' }) }];
    expect((await extract()).tokens.usd).toBeCloseTo(0.006 + 0.045 + 0.016, 10);
  });

  it('counts both attempts when the refusal fallback ran, each at its own model', async () => {
    /* the top-level usage covers only the attempt that answered; the declined one is billed too */
    const attempts = [
      { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
      { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 1200, output_tokens: 640, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0, cache_creation: null }
    ];
    replies = [{ sse: stream('tool_use', { name: 'report_requirements', input: { requirements: [] } }, { model: 'claude-opus-5', usage: { iterations: attempts } }) }];
    const { status, tokens } = await extract();
    expect(status).toBe(200);
    expect(tokens).toMatchObject({ input: 2200, output: 840, cacheRead: 90_000 });
    expect(tokens.usd).toBeCloseTo((1000 * 4 + 200 * 20) / 1e6 + (1200 * 5 + 640 * 25 + 90_000 * 0.5) / 1e6, 10);
  });

  it('prices an hour-long cache write at the hour rate', async () => {
    const usage = { cache_creation_input_tokens: 100_000, cache_creation: { ephemeral_5m_input_tokens: 60_000, ephemeral_1h_input_tokens: 40_000 } };
    replies = [{ sse: stream('tool_use', { name: 'report_requirements', input: { requirements: [] } }, { start: usage }) }];
    const base = 0.0048 + 0.018 + 0.0128;
    expect((await extract()).tokens.usd).toBeCloseTo(base + (60_000 * 5 + 40_000 * 8) / 1e6, 10);
  });

  it('reports what a failed call cost, so the limit counts it', async () => {
    replies = [{ sse: stream('refusal') }];
    const { status, tokens } = await extract();
    expect(status).toBe(422);
    expect(tokens.usd).toBeCloseTo(0.0048 + 0.018 + 0.0128, 10);
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
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.thinking).toEqual({ type: 'adaptive' });
    expect(sent.fallbacks).toBe('default');
    expect(call?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(call?.headers.get('x-api-key')).toBe('sk-ant-test');

    const tools = sent.tools as { name: string; strict: boolean }[];
    /* the two sales and legal tools come after the three every tender uses, so those keep their order */
    expect(tools.map((tool) => tool.name)).toEqual(['report_fit', 'report_requirements', 'report_matches', 'report_categories', 'report_terms']);
    expect(tools.every((tool) => tool.strict)).toBe(true);

    const content = (sent.messages as { content: Record<string, unknown>[] }[])[0]?.content ?? [];
    /* the documents lead, converted text before the PDF, each ending in a cache marker, so a later
       call about one document reads everything up to it from cache */
    expect(content[0]).toMatchObject({ type: 'document', source: { type: 'file', file_id: 'file_2' }, title: 'Document 2: Annex B.docx', cache_control: { type: 'ephemeral' } });
    expect(String(content[0]?.context)).toContain('[[Part N]]');
    expect(content[1]).toMatchObject({ type: 'document', source: { type: 'file', file_id: 'file_1' }, title: 'Document 1: Acme RFP.pdf', cache_control: { type: 'ephemeral' } });
    /* five minutes, the default: an hour's entry is written at twice the input price, and the keep-warm covers the wait */
    expect(content[1]?.cache_control).not.toHaveProperty('ttl');
    expect(content[2]?.type).toBe('text');
    expect(String(content[2]?.text)).toContain('- openedx: Open edX.');
  });

  it('asks for physical page numbers and a skip flag the model must set on every section', async () => {
    replies = [{ sse: stream('tool_use', { name: 'report_fit', input: { platform: 'openedx', outline: [{ doc: 1, title: 'Bid instructions', from: 2, to: 6, skip: true }], documents: [{ doc: 1, pages: 48 }] } }) }];
    const body = (await (await post('fit', { docs, platforms })).json()) as { result: { outline: { skip?: boolean }[] } };
    expect(body.result.outline[0]?.skip).toBe(true);

    const sent = sentMessage();
    const fit = (sent.tools as { name: string; input_schema: { properties: { outline: { items: { required: string[]; properties: Record<string, { description?: string }> } } } } }[])[0]!;
    const section = fit.input_schema.properties.outline.items;
    /* strict tools make every listed field required, so a section the model is unsure of still says so */
    expect(section.required).toContain('skip');
    /* a printed page number is often two or more off the file's, and skipping would then drop real pages */
    expect(section.properties.from?.description).toContain('not the number printed');
    const instruction = String(((sent.messages as { content: { text?: string }[] }[])[0]?.content ?? []).at(-1)?.text);
    expect(instruction).toContain('When in doubt, leave skip false');
    expect(instruction).toContain('service levels');
  });

  it('describes a converted spreadsheet as rows under column names, and other text as parts', async () => {
    replies = [{ sse: stream('tool_use', { name: 'report_fit', input: { platform: 'openedx' } }) }];
    await post('fit', { docs: [...docs, { n: 3, name: 'Matrix.xlsx', kind: 'text', fileId: 'file_3', pages: 12 }], platforms });
    const content = (sentMessage().messages as { content: Record<string, unknown>[] }[])[0]?.content ?? [];
    expect(content.map((block) => block.title)).toEqual(['Document 2: Annex B.docx', 'Document 3: Matrix.xlsx', 'Document 1: Acme RFP.pdf', undefined]);
    expect(String(content[0]?.context)).not.toContain('Columns');
    expect(String(content[1]?.context)).toContain('"Row N:" line is row N of that sheet');
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

  it('carries the documents up to the one it reads, so a spreadsheet call does not pay for the PDF', async () => {
    const titles = async (manyDocs: unknown[], doc: number): Promise<unknown[]> => {
      calls = [];
      replies = [{ sse: stream('tool_use', { name: 'report_requirements', input: { requirements: [] } }) }];
      await post('extract', { docs: manyDocs, range: { doc, from: 1, to: 2 } });
      return ((sentMessage().messages as { content: Record<string, unknown>[] }[])[0]?.content ?? []).filter((block) => block.type === 'document').map((block) => block.title);
    };
    expect(await titles(docs, 2)).toEqual(['Document 2: Annex B.docx']);
    /* the PDF is the full prefix, the same one the fit call cached */
    expect(await titles(docs, 1)).toEqual(['Document 2: Annex B.docx', 'Document 1: Acme RFP.pdf']);

    /* five documents: the API keeps four markers, so the first boundary has none and a call about
       the first document runs on to the second, where the fit call left an entry */
    const five = [1, 2, 3, 4, 5].map((n) => ({ n, name: `Annex ${n}.docx`, kind: 'text', fileId: `file_${n}`, pages: 2 }));
    expect(await titles(five, 1)).toEqual(['Document 1: Annex 1.docx', 'Document 2: Annex 2.docx']);
    expect(await titles(five, 3)).toEqual(['Document 1: Annex 1.docx', 'Document 2: Annex 2.docx', 'Document 3: Annex 3.docx']);
    replies = [{ sse: stream('tool_use', { name: 'report_fit', input: { platform: 'openedx' } }) }];
    calls = [];
    await post('fit', { docs: five, platforms });
    const marks = ((sentMessage().messages as { content: Record<string, unknown>[] }[])[0]?.content ?? []).map((block) => Boolean(block.cache_control));
    expect(marks).toEqual([false, true, true, true, true, false]);
  });

  it("asks for the tender's own reference, and to leave out what the tender says it will not have", async () => {
    replies = [{ sse: stream('tool_use', { name: 'report_requirements', input: { requirements: [{ text: 'Bulk enrolment', quote: 'bulk enrolment', page: 3, section: 'Functional', ref: 'FR-004', priority: 'must', outOfScope: false }] } }) }];
    const body = (await (await post('extract', { docs, range: { doc: 2, from: 1, to: 3 } })).json()) as { found: { ref?: string }[] };
    expect(body.found[0]?.ref).toBe('FR-004');

    const sent = sentMessage();
    const item = (sent.tools as { input_schema: { properties: { requirements?: { items: { required: string[] } } } } }[])[1]!.input_schema.properties.requirements!.items;
    expect(item.required).toContain('ref');
    const instruction = String(((sent.messages as { content: { text?: string }[] }[])[0]?.content ?? []).at(-1)?.text);
    /* MoSCoW sheets mark Won't haves; listing them as requirements prices work the client ruled out */
    expect(instruction).toContain("Won't have (W): it is not a requirement");
    expect(instruction).toContain('the top level is must');
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

    /* a key that cannot use the model also answers 404; blaming the files would send someone to upload them again */
    replies = [apiError(404, 'not_found_error', 'model: claude-opus-5-5')];
    response = await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    const missing = (await response.json()) as { code: string; error: string };
    expect(missing.code).toBe('not_configured');
    expect(missing.error).toContain('cannot use the model claude-opus-5-5');
    expect(missing.error).not.toContain('no longer at Anthropic');

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

  it('asks for one of two solutions that do the same job, the built one first', async () => {
    replies = [{ sse: stream('tool_use', { name: 'report_matches', input: { matches: [] } }) }];
    await post('match', { catalog, reqs: [{ id: 'R-01', text: 'Digital badges', section: '', priority: 'must' }] });
    const instruction = String(((sentMessage().messages as { content: Record<string, unknown>[] }[])[0]?.content ?? [])[1]?.text);
    /* both would land in the estimation, and the same work would be priced twice */
    expect(instruction).toContain('Where two solutions do the same job, name only the one that fits best');
    expect(instruction).toContain('preferring status Production (built before) over Estimation (priced, never built)');
    /* aimed at alternatives only: parts that go together are all still named, or the bid is underpriced */
    expect(instruction).toContain('Name every solution the requirement needs, including the parts that go together');
    expect(instruction).not.toMatch(/\bhours\b/);
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

describe('sorting out-of-scope items into teams', () => {
  const items = [
    { id: 'R-14', text: 'Hold a state cloud security certification for the hosting', section: 'Security', reason: 'A certification, not software.' },
    { id: 'R-22', text: 'Report quarterly spend to the purchasing office', section: 'Reporting', reason: '' }
  ];
  interface SchemaTool {
    name: string;
    strict: boolean;
    input_schema: { properties: Record<string, { items: { properties: Record<string, { enum?: string[] }> } }> };
  }

  it('sends only the items’ words, no documents and no catalog, and keeps only the teams asked about', async () => {
    replies = [
      {
        sse: stream('tool_use', {
          name: 'report_categories',
          input: { items: [{ id: 'R-14', category: 'certification' }, { id: 'R-22', category: 'sales' }, { id: 'R-99', category: 'legal' }] }
        })
      }
    ];
    const response = await post('sort', { items });
    const body = (await response.json()) as { categories: Record<string, string>; tokens: { output: number } };
    expect(response.status).toBe(200);
    expect(body.categories).toEqual({ 'R-14': 'certification', 'R-22': 'sales' });
    expect(body.tokens.output).toBe(640);

    const sent = sentMessage();
    const content = (sent.messages as { content: Record<string, unknown>[] }[])[0]?.content ?? [];
    /* the tender's documents are the dear part of every other call, and this one has no use for them */
    expect(content.map((block) => block.type)).toEqual(['text']);
    const text = String(content[0]?.text);
    expect(text).toContain('R-14 (Security) Hold a state cloud security certification for the hosting Out of scope because: A certification, not software.');
    expect(text).toContain('- certification: Certification, for security or compliance certifications');
    const tool = (sent.tools as SchemaTool[]).find((one) => one.name === 'report_categories');
    expect(tool?.strict).toBe(true);
    /* an enum, so the answer can only name a team the app has */
    expect(tool?.input_schema.properties.items?.items.properties.category?.enum).toEqual(['sales', 'account', 'legal', 'people', 'certification']);
    expect(sent.fallbacks).toBe('default');
  });

  it('says a refusal is a refusal and what it cost, and makes no call for no items', async () => {
    replies = [{ sse: stream('refusal') }];
    const refused = await post('sort', { items });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { tokens: { input: number } }).tokens.input).toBe(1200);

    calls = [];
    const none = await post('sort', { items: [] });
    expect(none.status).toBe(200);
    expect(((await none.json()) as { categories: unknown }).categories).toEqual({});
    expect(calls).toEqual([]);
  });

  it('refuses more items than one call should carry, and a body that is not a list, before any call', async () => {
    const many = Array.from({ length: 151 }, (_, i) => ({ id: `R-${i}`, text: 'Something', section: '', reason: '' }));
    expect((await post('sort', { items: many })).status).toBe(400);
    expect((await post('sort', { items: 'R-01' })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('reading the key terms', () => {
  it('reads one document from the cached tender, and narrows each term, its team and its page', async () => {
    replies = [
      {
        sse: stream('tool_use', {
          name: 'report_terms',
          input: {
            terms: [
              { topic: 'payment', text: 'Invoices are paid within 45 days.', quote: 'within forty-five days', page: 40, ref: '12.3' },
              { topic: 'insurance', text: 'Cyber cover of $5 million.', quote: '', page: 900, ref: '' },
              { topic: 'weather', text: 'A topic the model made up.', quote: '', page: 2, ref: '' }
            ]
          }
        })
      }
    ];
    const response = await post('terms', { docs, doc: 1 });
    const body = (await response.json()) as { found: { topic: string; category: string; page: number; doc: number; ref?: string }[]; tokens: { cacheRead: number } };
    expect(response.status).toBe(200);
    expect(body.found.map((one) => [one.topic, one.category, one.page])).toEqual([
      ['payment', 'sales', 40],
      ['insurance', 'legal', 0],
      ['other', 'legal', 2]
    ]);
    expect(body.found[0]).toMatchObject({ doc: 1, ref: '12.3' });
    expect(body.tokens.cacheRead).toBe(90_000);

    const sent = sentMessage();
    const content = (sent.messages as { content: Record<string, unknown>[] }[])[0]?.content ?? [];
    expect(content.filter((block) => block.type === 'document').map((block) => [block.title, Boolean(block.cache_control)])).toEqual([
      ['Document 2: Annex B.docx', true],
      ['Document 1: Acme RFP.pdf', true]
    ]);
    expect(String(content.at(-1)?.text)).toContain('key legal and commercial terms stated in document 1 (Acme RFP.pdf)');
    const tool = (sent.tools as { name: string; strict: boolean }[]).find((one) => one.name === 'report_terms');
    expect(tool?.strict).toBe(true);
  });

  it('sends exactly what an extraction of the same document sends ahead of its instruction, so it reads that cache entry', async () => {
    /* anything different in the prefix writes the whole tender to the cache again, which is most of what a tender costs */
    replies = [{ sse: stream('tool_use', { name: 'report_requirements', input: { requirements: [] } }) }, { sse: stream('tool_use', { name: 'report_terms', input: { terms: [] } }) }];
    await post('extract', { docs, range: { doc: 2, from: 1, to: 3 } });
    await post('terms', { docs, doc: 2 });
    const [extract, terms] = calls.filter((one) => one.url.includes('/v1/messages')).map((one) => one.body as Record<string, unknown>);
    for (const key of ['model', 'system', 'tools', 'thinking', 'output_config']) expect(terms?.[key]).toEqual(extract?.[key]);
    const ahead = (body: Record<string, unknown> | undefined): unknown[] => ((body?.messages as { content: unknown[] }[])[0]?.content ?? []).slice(0, -1);
    expect(ahead(terms)).toEqual(ahead(extract));
    expect(ahead(terms).length).toBeGreaterThan(0);
  });

  it('reads part of a document after a split, and asks about those pages alone', async () => {
    replies = [{ sse: stream('tool_use', { name: 'report_terms', input: { terms: [] } }) }, { sse: stream('tool_use', { name: 'report_terms', input: { terms: [] } }) }];
    await post('terms', { docs, doc: 1, from: 25, to: 48 });
    const instruction = (): string => String(((sentMessage().messages as { content: { text?: string }[] }[])[0]?.content ?? []).at(-1)?.text);
    expect(instruction()).toContain('stated in document 1 (Acme RFP.pdf), pages 25 to 48 inclusive');
    expect(instruction()).toContain('Other pages and documents are context only');
    /* the whole document, sent as its own range, is asked about as a whole */
    calls = [];
    await post('terms', { docs, doc: 1, from: 1, to: 48 });
    expect(instruction()).toContain('stated in document 1 (Acme RFP.pdf). Other documents are context only');
  });

  it('says a refusal is a refusal, and refuses a document the tender does not have without calling', async () => {
    replies = [{ sse: stream('refusal') }];
    const refused = await post('terms', { docs, doc: 1 });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { code: string }).code).toBe('refused');

    calls = [];
    const missing = await post('terms', { docs, doc: 7 });
    expect(missing.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('keeping the tender cached while a person decides', () => {
  const warmReply = (): Reply => ({
    json: {
      id: 'msg_w',
      type: 'message',
      role: 'assistant',
      model: DEFAULT_MODEL,
      content: [],
      stop_reason: 'max_tokens',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0 }
    }
  });

  it('re-reads exactly what the fit call cached, and asks for no answer', async () => {
    process.env.EDLY_AI_EFFORT = 'medium';
    replies = [{ sse: stream('tool_use', { name: 'report_fit', input: { platform: 'openedx' } }) }, warmReply()];
    await post('fit', { docs, platforms });
    const response = await post('warm', { docs });
    const body = (await response.json()) as { ok: boolean; tokens: { cacheRead: number; output: number; usd: number } };
    expect(response.status).toBe(200);
    expect(body.tokens).toMatchObject({ cacheRead: 90_000, output: 0 });
    /* a fiftieth of a dollar on Opus 5.5, which is why keeping the cache warm is worth it */
    expect(body.tokens.usd).toBeCloseTo(12 * 4e-6 + 90_000 * 0.2e-6, 10);

    const [fit, warm] = calls.filter((one) => one.url.includes('/v1/messages')).map((one) => one.body as Record<string, unknown>);
    /* no output is billed; the API refuses max_tokens 0 on a stream, so this one is not streamed */
    expect(warm?.max_tokens).toBe(0);
    expect(warm?.stream).toBeFalsy();
    /* anything in the cached prompt that differed would write a second entry nothing ever reads */
    for (const key of ['model', 'system', 'tools', 'thinking', 'output_config']) expect(warm?.[key]).toEqual(fit?.[key]);
    const documents = (body: Record<string, unknown> | undefined): unknown[] => ((body?.messages as { content: Record<string, unknown>[] }[])[0]?.content ?? []).filter((block) => block.type === 'document');
    expect(documents(warm)).toEqual(documents(fit));
  });

  it('says why a keep-warm failed, and refuses one with no documents without calling', async () => {
    replies = [apiError(429, 'rate_limit_error', 'slow down')];
    const failed = await post('warm', { docs });
    expect(failed.status).toBe(429);
    expect(((await failed.json()) as { code: string }).code).toBe('rate_limited');
    calls = [];
    expect((await post('warm', { docs: [] })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('what extraction leaves out', () => {
  it('asks for no legal boilerplate or bid paperwork, but keeps delivery clauses and costly non-software work', async () => {
    replies = [{ sse: stream('tool_use', { name: 'report_requirements', input: { requirements: [] } }) }];
    await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    const instruction = String(((sentMessage().messages as { content: { text?: string }[] }[])[0]?.content ?? []).at(-1)?.text);
    /* insurance and liability clauses flooded the review list and cost output tokens, for nothing to estimate */
    expect(instruction).toContain('Do not report legal and commercial terms (insurance, liability');
    expect(instruction).toContain('service levels, support hours, data protection');
    expect(instruction).toContain('outOfScope is true for obligations that are not software delivery but cost the supplier money');
    expect(instruction).not.toMatch(/outOfScope is true[^\n]*insurance/);
  });

  it('lets the fit call leave out sections of standard legal terms', async () => {
    replies = [{ sse: stream('tool_use', { name: 'report_fit', input: { platform: 'openedx' } }) }];
    await post('fit', { docs, platforms });
    const instruction = String(((sentMessage().messages as { content: { text?: string }[] }[])[0]?.content ?? []).at(-1)?.text);
    expect(instruction).toContain('declarations and signature pages, and standard legal and commercial terms');
  });
});

describe('the effort setting', () => {
  const fitReply = (): Reply => ({ sse: stream('tool_use', { name: 'report_fit', input: { platform: 'openedx' } }) });
  const extractReply = (): Reply => ({ sse: stream('tool_use', { name: 'report_requirements', input: { requirements: [] } }) });
  const matchReply = (): Reply => ({ sse: stream('tool_use', { name: 'report_matches', input: { matches: [] } }) });
  const run = async (): Promise<unknown[]> => {
    replies = [fitReply(), extractReply(), matchReply()];
    await post('fit', { docs, platforms });
    await post('extract', { docs, range: { doc: 1, from: 1, to: 20 } });
    await post('match', { catalog, reqs: [{ id: 'R-01', text: 'Single sign-on', section: '', priority: 'must' }] });
    return calls.filter((one) => one.url.includes('/v1/messages')).map((one) => (one.body as { output_config?: unknown }).output_config);
  };

  it('sends medium when it is not set, because the API default differs from one model to the next', async () => {
    expect(await run()).toEqual([{ effort: 'medium' }, { effort: 'medium' }, { effort: 'medium' }]);
  });

  it('sends the same effort on every call, because a different one would pay for the whole tender again', async () => {
    process.env.EDLY_AI_EFFORT = ' Low ';
    expect(await run()).toEqual([{ effort: 'low' }, { effort: 'low' }, { effort: 'low' }]);
  });

  it('ignores an effort the API does not know, rather than failing every call', async () => {
    process.env.EDLY_AI_EFFORT = 'turbo';
    expect(await run()).toEqual([{ effort: 'medium' }, { effort: 'medium' }, { effort: 'medium' }]);
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
