/* bun run check — proves nothing is lost between the app, the workbook and the store.

   Covers the paths that actually lose data:
     - every persisted browser key is carried by the sync bridge
     - the full state shape survives a write/read round-trip, byte for byte
     - values longer than an Excel cell are chunked and rejoined
     - a blank payload cannot wipe a populated store
     - the served catalog workbook parses */

import { readWorkbook, writeWorkbook } from '../lib/xlsx.js';
import { stateToSheets, sheetsToState, TABLES } from '../lib/schema.js';
import { handle as stateHandle } from '../api/state.js';

let failures = 0;
const ok = (label, pass, detail) => {
  console.log((pass ? '  ok   ' : '  FAIL ') + label + (detail ? '  — ' + detail : ''));
  if (!pass) failures++;
};
const section = t => console.log('\n' + t);

/* ---------- 1. the sync bridge must cover every key the app writes ---------- */

section('storage keys');
const appSource = await Bun.file('./public/index.html').text();
const syncSource = await Bun.file('./public/sync.js').text();
const appKeys = [...new Set([...appSource.matchAll(/localStorage\.(?:setItem|getItem|removeItem)\(\s*'([^']+)'/g)].map(m => m[1]))]
  .filter(k => k.startsWith('edly-'));
ok('found keys in the app', appKeys.length > 5, appKeys.join(', '));
const notSynced = appKeys.filter(k => k !== 'edly-auth-v1' && syncSource.indexOf("'" + k + "'") < 0);
ok('every key is synced (auth stays local)', notSynced.length === 0, notSynced.length ? 'MISSING: ' + notSynced.join(', ') : 'all covered');

/* ---------- 2. full round-trip fidelity ---------- */

section('state round-trip');
const bigCatalog = {
  meta: { title: 'Loaded sheet', totals: { features: 120 } },
  bundles: Array.from({ length: 30 }, (_, b) => ({
    id: 'B' + String(b + 1).padStart(2, '0'),
    name: 'Bundle number ' + (b + 1),
    pitch: 'A pitch long enough to matter when serialised, repeated for bulk. '.repeat(6),
    items: Array.from({ length: 9 }, (_, i) => ({
      id: 'X-' + b + '-' + i,
      name: 'Solution ' + b + '.' + i,
      desc: 'What it does, described at the length a real catalog row uses, with spaces. '.repeat(5),
      first: 8 + i, repeat: 3 + i, build: 40 + i, form: 'Integration', status: 'Production'
    }))
  }))
};
const bigJson = JSON.stringify(bigCatalog);

const sample = {
  estimations: [
    {
      id: 'EST-1', plat: 'openedx', name: 'Acme Corporate Academy', client: 'Acme Ltd', tag: 'Urgent',
      due: '2026-10-15', at: '2026-09-01', up: '2026-09-22', total: 1259.95, cost: 74250, items: 13,
      snap: {
        sel: { 'EDU-071': true, 'EDU-041': true, 'CS-01': true },
        buf: { 'EDU-071': 4.5 }, bufPct: 12, pm: 10, qa: 8, rate: 62, cur: 'EUR', cap: 80,
        gs: { B01: 0, B05: 2.5 },
        roles: [{ id: 'sr', name: 'Senior Engineer', rate: 55 }, { id: 'devops', name: 'DevOps', rate: 50 }],
        lineRole: { 'EDU-071': 'devops', 'EDU-041': 'sr' },
        pmRole: 'pm', qaRole: 'qa',
        plan: { 'EDU-071': { start: 2, people: 3, order: 0 }, 'EDU-041': { people: 2, order: 1 } },
        hpw: 38, maxPar: 5, planStart: '2026-10-01'
      }
    },
    { id: 'EST-2', plat: 'moodle', name: 'Nordic University', client: '', tag: 'Closed', due: '', at: '2026-08-02', up: '2026-08-30', total: 0, cost: 0, items: 0, snap: { sel: {}, buf: {}, bufPct: 0 } }
  ],
  requests: [
    {
      id: 'RQ-01', plat: 'openedx', estId: 'EST-1', estName: 'Acme Corporate Academy', client: 'Acme Ltd',
      title: 'Proctored exam integration', details: 'Live proctoring with identity check & session recording',
      area: 'Assessment', urgency: 'Blocking a Q4 deal', integrations: 'Proctorio',
      name: 'Sara', email: 'sara@edly.io', org: 'Edly', at: '2026-09-10',
      est: 48, repeatEst: 12, csId: 'CS-01', catBundle: 'B05', estBy: 'admin', estAt: '2026-09-12',
      estNote: 'Assumes the Proctorio contract is already in place',
      catForm: 'Custom development', catDeploy: '3–4 days', catInteg: 'Proctorio',
      catCategory: 'Assessment', catSub: 'Custom', catAccount: 'Proctorio', catLimits: 'One exam window per course'
    },
    { id: 'RQ-02', plat: 'openedx', estId: 'EST-1', title: 'Manually added line', details: 'Manually added custom item', manual: true, est: 16, at: '2026-09-11' },
    { id: 'RQ-03', plat: 'moodle', estId: 'EST-2', title: 'Teams attendance sync', details: 'Pending', area: 'Integration', at: '2026-09-18' }
  ],
  solutions: [
    { id: 'CS-01', plat: 'openedx', bundleId: 'B05', name: 'Proctored exam integration', desc: 'Live proctoring', first: 48, repeat: 12, form: 'Custom development', deploy: '3–4 days', category: 'Assessment', subCategory: 'Custom', account: 'Proctorio', limits: 'One exam window per course', note: 'Vendor contract assumed', from: 'RQ-01', estAt: '2026-09-12', direct: false },
    { id: 'CS-02', plat: 'moodle', bundleId: 'CB-01', name: 'Blue-green deployment pipeline', desc: 'Zero downtime releases', first: 64, repeat: 16, form: 'Custom development', deploy: '1 week', category: 'Infrastructure', subCategory: '', account: '', limits: 'Single-region only', note: '', from: '', estAt: '2026-09-20', direct: true }
  ],
  bundles: [{ id: 'CB-01', plat: 'moodle', name: 'Deployment & Infrastructure', pitch: 'Zero-downtime releases', offerWhen: 'release safety, uptime', pairsWith: null, at: '2026-09-20' }],
  settings: {
    'edly-plat-v1': { practice: 'edtech', plat: 'openedx' },
    'edly-open-est-v1': 'EST-1',
    'edly-bundle-calc-v1': { sel: { 'EDU-071': true }, active: 'B01', pres: false, cur: 'EUR', roles: [{ id: 'sr', name: 'Senior Engineer', rate: 55 }], plan: { 'EDU-071': { people: 2 } } },
    'edly-catalog-sheet-v1': { cat: bigCatalog, info: { source: 'file', name: 'master.xlsx', hash: 'abc123' } },
    'edly-catalog-sheetmap-v1': { moodle: bigCatalog }
  }
};

const bytes = writeWorkbook(stateToSheets(sample));
ok('workbook writes', bytes.length > 2000, bytes.length + ' bytes');
const back = sheetsToState(await readWorkbook(bytes));

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok('estimations count', back.estimations.length === 2);
ok('estimation scalars', back.estimations[0].total === 1259.95 && back.estimations[0].cost === 74250 && back.estimations[0].items === 13);
ok('estimation snapshot identical', deepEqual(back.estimations[0].snap, sample.estimations[0].snap));
ok('closed estimation with blanks', back.estimations[1].tag === 'Closed' && back.estimations[1].total === 0);
ok('requests count', back.requests.length === 3);
ok('request hours', back.requests[0].est === 48 && back.requests[0].repeatEst === 12);
ok('request catalog fields', back.requests[0].catLimits === 'One exam window per course' && back.requests[0].catAccount === 'Proctorio');
ok('manual flag', back.requests[1].manual === true);
ok('un-estimated request has no hours', back.requests[2].est === undefined, 'est=' + back.requests[2].est);
ok('solutions', back.solutions.length === 2 && back.solutions[1].direct === true && back.solutions[0].direct === false);
ok('solution numbers', back.solutions[0].first === 48 && back.solutions[0].repeat === 12);
ok('custom bundle', back.bundles[0].name === 'Deployment & Infrastructure');
ok('settings: platform', deepEqual(back.settings['edly-plat-v1'], sample.settings['edly-plat-v1']));
ok('settings: raw string value', back.settings['edly-open-est-v1'] === 'EST-1');
ok('settings: working state', deepEqual(back.settings['edly-bundle-calc-v1'], sample.settings['edly-bundle-calc-v1']));

/* ---------- 3. oversized values must chunk, not truncate ---------- */

section('long values (Excel caps a cell at 32,767 chars)');
ok('test payload exceeds one cell', bigJson.length > 32767, bigJson.length + ' chars');
const settingsSheet = stateToSheets(sample)[TABLES.settings.sheet];
const chunkRows = settingsSheet.filter(r => String(r[0]).indexOf('##') > 0);
ok('long values were split', chunkRows.length >= 2, chunkRows.length + ' chunk rows');
ok('no cell exceeds the limit', settingsSheet.every(r => String(r[1] || '').length <= 28002));
ok('loaded catalog rejoined exactly', deepEqual(back.settings['edly-catalog-sheet-v1'], sample.settings['edly-catalog-sheet-v1']));
ok('platform sheet map rejoined exactly', deepEqual(back.settings['edly-catalog-sheetmap-v1'], sample.settings['edly-catalog-sheetmap-v1']));

/* ---------- 4. the API must not let a blank payload wipe the store ---------- */

section('API guards (local file store)');
process.env.EDLY_STORE = 'local';
process.env.EDLY_STATE_PATH = './data/check-' + Date.now() + '.xlsx';

const call = (method, body, qs) => stateHandle(new Request('http://localhost/api/state' + (qs || ''), {
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
}));

let res = await call('GET');
let out = await res.json();
ok('empty store reads cleanly', out.ok === true && out.empty === true, out.label);

res = await call('PUT', sample);
out = await res.json();
ok('write accepted', out.ok === true, JSON.stringify(out.counts || out.error));

res = await call('GET');
out = await res.json();
ok('read back through the API', out.ok && !out.empty && out.state.estimations.length === 2);
ok('API preserved the snapshot', deepEqual(out.state.estimations[0].snap, sample.estimations[0].snap));
ok('API preserved the loaded catalog', deepEqual(out.state.settings['edly-catalog-sheet-v1'], sample.settings['edly-catalog-sheet-v1']));

res = await call('PUT', { estimations: [], requests: [], solutions: [], bundles: [], settings: {} });
out = await res.json();
ok('blank payload is refused', res.status === 409 && out.refused === true, out.error);

res = await call('GET');
out = await res.json();
ok('store survived the blank write', out.state.estimations.length === 2);

res = await call('PUT', { estimations: [], requests: [], solutions: [], bundles: [], settings: {} }, '?force=1');
out = await res.json();
ok('force=1 clears deliberately', out.ok === true && out.counts.estimations === 0);

res = await call('GET', undefined, '?format=xlsx');
ok('xlsx export works', res.ok && res.headers.get('content-type').indexOf('spreadsheetml') > 0);

res = await call('GET', undefined, '?probe=1');
out = await res.json();
ok('probe reports the store', out.ok && out.reachable === true, out.label);

res = await call('DELETE');
ok('unknown method rejected', res.status === 405);

try {
  const { unlink } = await import('node:fs/promises');
  await unlink(process.env.EDLY_STATE_PATH);
} catch {}

/* ---------- 5. the Vercel (req, res) adapter ---------- */

section('handler adapter');
const { universal } = await import('../lib/handler.js');
const wrapped = universal(stateHandle);
const fakeReq = (method, url, bodyStr) => ({
  method, url, headers: { host: 'example.vercel.app' },
  [Symbol.asyncIterator]: async function* () { if (bodyStr) yield new TextEncoder().encode(bodyStr); }
});
const fakeRes = () => ({ statusCode: 0, headers: {}, chunks: [], setHeader(k, v) { this.headers[k] = v; }, end(b) { this.chunks.push(b); } });

let nr = fakeRes();
await wrapped(fakeReq('GET', '/api/state?probe=1'), nr);
ok('node-style GET', nr.statusCode === 200 && new TextDecoder().decode(nr.chunks[0]).indexOf('"ok":true') > 0, 'status ' + nr.statusCode);
nr = fakeRes();
await wrapped(fakeReq('PUT', '/api/state', JSON.stringify(sample)), nr);
ok('node-style PUT', nr.statusCode === 200 && new TextDecoder().decode(nr.chunks[0]).indexOf('"ok":true') > 0, 'status ' + nr.statusCode);
ok('node-style headers', /application\/json/.test(nr.headers['content-type'] || ''));

/* ---------- 6. the served catalog ---------- */

section('catalog workbook');
try {
  const { readFile } = await import('node:fs/promises');
  const cat = new Uint8Array(await readFile('./public/catalog-source.xlsx'));
  const wb = await readWorkbook(cat);
  const all = wb['All Components'] || [];
  const ids = all.slice(4).map(r => r[2]).filter(v => /^[A-Z]{2,}-\d+$/.test(String(v)));
  ok('catalog parses', all.length > 10, Object.keys(wb).length + ' sheets');
  ok('solution rows found', ids.length >= 80, ids.length + ' solution ids');
  ok('ids are unique', new Set(ids).size === ids.length);
} catch (err) {
  ok('catalog parses', false, String(err.message || err));
}

console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
