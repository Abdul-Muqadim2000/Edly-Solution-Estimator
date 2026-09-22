/* The app's whole state lives in five tables. Each row keeps its scalar columns readable in
   Excel and stashes the nested bits (selections, plan, rate card) in a single JSON column —
   so a human can scan the sheet and the app can still round-trip it losslessly. */

export const TABLES = {
  estimations: {
    sheet: 'Estimations',
    columns: ['id', 'plat', 'name', 'client', 'tag', 'due', 'created', 'updated', 'totalHours', 'cost', 'solutions', 'snapshotJson']
  },
  requests: {
    sheet: 'Requests',
    columns: ['id', 'plat', 'estimationId', 'estimationName', 'client', 'title', 'details', 'area', 'urgency',
      'integrations', 'requestedBy', 'email', 'org', 'submitted', 'estimateHours', 'repeatHours',
      'catalogId', 'bundleId', 'estimatedBy', 'estimatedOn', 'note', 'extraJson']
  },
  solutions: {
    sheet: 'EstimatedSolutions',
    columns: ['id', 'plat', 'bundleId', 'name', 'description', 'firstHours', 'repeatHours', 'form', 'deploy',
      'category', 'subCategory', 'account', 'limits', 'note', 'fromRequest', 'addedOn', 'direct']
  },
  bundles: {
    sheet: 'CustomBundles',
    columns: ['id', 'plat', 'name', 'pitch', 'offerWhen', 'pairsWith', 'addedOn']
  },
  settings: {
    sheet: 'Settings',
    columns: ['key', 'valueJson']
  }
};

/* Excel caps a cell at 32,767 characters and Google Sheets at 50,000. An imported catalog
   serialises to well over that, so long values are split across numbered rows and rejoined
   on read — otherwise the tail would be silently truncated.
   Each chunk is wrapped in pipes: readers trim cell whitespace, which would otherwise eat a
   space that happened to land on a chunk boundary and corrupt the JSON. */
const CELL_LIMIT = 28000;
const wrapChunk = s => '|' + s + '|';
const unwrapChunk = s => {
  const v = String(s == null ? '' : s);
  return v.startsWith('|') && v.endsWith('|') ? v.slice(1, -1) : v;
};

const str = v => (v == null ? '' : typeof v === 'string' ? v : String(v));
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; };
const json = (v) => { try { return JSON.stringify(v == null ? null : v); } catch { return 'null'; } };
const parse = (v) => { if (v == null || v === '') return null; try { return JSON.parse(v); } catch { return null; } };

/* ---------- app state -> sheet rows ---------- */

export function stateToSheets(state) {
  const s = state || {};
  const sheets = {};
  const head = key => [TABLES[key].columns.slice()];

  const est = head('estimations');
  (s.estimations || []).forEach(e => est.push([
    str(e.id), str(e.plat || 'openedx'), str(e.name), str(e.client), str(e.tag || 'Active'), str(e.due),
    str(e.at), str(e.up), e.total != null ? +e.total : 0, e.cost != null ? +e.cost : 0,
    e.items != null ? +e.items : 0, json(e.snap)
  ]));
  sheets[TABLES.estimations.sheet] = est;

  const req = head('requests');
  (s.requests || []).forEach(r => req.push([
    str(r.id), str(r.plat || 'openedx'), str(r.estId), str(r.estName), str(r.client), str(r.title),
    str(r.details), str(r.area), str(r.urgency), str(r.integrations), str(r.name), str(r.email), str(r.org),
    str(r.at), r.est != null && r.est !== '' ? +r.est : '', r.repeatEst != null && r.repeatEst !== '' ? +r.repeatEst : '',
    str(r.csId), str(r.catBundle), str(r.estBy), str(r.estAt), str(r.estNote),
    json({ manual: !!r.manual, catForm: r.catForm, catDeploy: r.catDeploy, catInteg: r.catInteg,
      catCategory: r.catCategory, catSub: r.catSub, catAccount: r.catAccount, catLimits: r.catLimits })
  ]));
  sheets[TABLES.requests.sheet] = req;

  const sol = head('solutions');
  (s.solutions || []).forEach(x => sol.push([
    str(x.id), str(x.plat || 'openedx'), str(x.bundleId), str(x.name), str(x.desc),
    x.first != null ? +x.first : '', x.repeat != null ? +x.repeat : '', str(x.form), str(x.deploy),
    str(x.category), str(x.subCategory), str(x.account), str(x.limits), str(x.note),
    str(x.from), str(x.estAt), x.direct ? 'yes' : ''
  ]));
  sheets[TABLES.solutions.sheet] = sol;

  const bun = head('bundles');
  (s.bundles || []).forEach(b => bun.push([
    str(b.id), str(b.plat || 'openedx'), str(b.name), str(b.pitch), str(b.offerWhen), str(b.pairsWith), str(b.at)
  ]));
  sheets[TABLES.bundles.sheet] = bun;

  const set = head('settings');
  Object.entries(s.settings || {}).forEach(([k, v]) => {
    const payload = json(v);
    if (payload.length <= CELL_LIMIT) { set.push([str(k), payload]); return; }
    const parts = Math.ceil(payload.length / CELL_LIMIT);
    for (let i = 0; i < parts; i++) {
      set.push([str(k) + '##' + (i + 1) + '/' + parts, wrapChunk(payload.slice(i * CELL_LIMIT, (i + 1) * CELL_LIMIT))]);
    }
  });
  sheets[TABLES.settings.sheet] = set;

  return sheets;
}

/* ---------- sheet rows -> app state ---------- */

export function sheetsToState(workbook) {
  const wb = workbook || {};
  const rows = (sheetName) => {
    const table = wb[sheetName];
    if (!table || !table.length) return [];
    const header = (table[0] || []).map(h => String(h || '').trim());
    return table.slice(1)
      .filter(r => r && r.some(c => String(c == null ? '' : c).trim() !== ''))
      .map(r => {
        const o = {};
        header.forEach((h, i) => { if (h) o[h] = r[i] != null ? r[i] : ''; });
        return o;
      });
  };

  const estimations = rows(TABLES.estimations.sheet).map(r => ({
    id: r.id, plat: r.plat || 'openedx', name: r.name, client: r.client, tag: r.tag || 'Active',
    due: r.due || '', at: r.created || '', up: r.updated || '',
    total: num(r.totalHours) || 0, cost: num(r.cost) || 0, items: num(r.solutions) || 0,
    snap: parse(r.snapshotJson) || { sel: {}, buf: {}, bufPct: 0 }
  })).filter(e => e.id);

  const requests = rows(TABLES.requests.sheet).map(r => {
    const extra = parse(r.extraJson) || {};
    const out = {
      id: r.id, plat: r.plat || 'openedx', estId: r.estimationId, estName: r.estimationName,
      client: r.client, title: r.title, details: r.details, area: r.area, urgency: r.urgency,
      integrations: r.integrations, name: r.requestedBy, email: r.email, org: r.org, at: r.submitted,
      estNote: r.note || '', estBy: r.estimatedBy || '', estAt: r.estimatedOn || '',
      csId: r.catalogId || '', catBundle: r.bundleId || ''
    };
    const e = num(r.estimateHours); if (e != null) out.est = e;
    const rp = num(r.repeatHours); if (rp != null) out.repeatEst = rp;
    if (extra.manual) out.manual = true;
    ['catForm', 'catDeploy', 'catInteg', 'catCategory', 'catSub', 'catAccount', 'catLimits']
      .forEach(k => { if (extra[k]) out[k] = extra[k]; });
    return out;
  }).filter(r => r.id);

  const solutions = rows(TABLES.solutions.sheet).map(r => ({
    id: r.id, plat: r.plat || 'openedx', bundleId: r.bundleId, name: r.name, desc: r.description,
    first: num(r.firstHours), repeat: num(r.repeatHours), form: r.form, deploy: r.deploy,
    category: r.category, subCategory: r.subCategory, account: r.account, limits: r.limits,
    note: r.note, from: r.fromRequest, estAt: r.addedOn, direct: String(r.direct).toLowerCase() === 'yes'
  })).filter(x => x.id);

  const bundles = rows(TABLES.bundles.sheet).map(r => ({
    id: r.id, plat: r.plat || 'openedx', name: r.name, pitch: r.pitch,
    offerWhen: r.offerWhen, pairsWith: r.pairsWith || null, at: r.addedOn
  })).filter(b => b.id);

  const settings = {};
  const chunks = {};
  rows(TABLES.settings.sheet).forEach(r => {
    if (!r.key) return;
    const m = String(r.key).match(/^(.*)##(\d+)\/(\d+)$/);
    if (!m) { settings[r.key] = parse(r.valueJson); return; }
    const bag = chunks[m[1]] || (chunks[m[1]] = { total: +m[3], parts: [] });
    bag.parts[+m[2] - 1] = unwrapChunk(r.valueJson);
  });
  Object.entries(chunks).forEach(([key, bag]) => {
    let have = 0;
    for (let i = 0; i < bag.total; i++) if (bag.parts[i] != null) have++;
    if (have !== bag.total) return; /* a partial value is worse than none */
    settings[key] = parse(bag.parts.join(''));
  });

  return { estimations, requests, solutions, bundles, settings };
}

export const EMPTY_STATE = { estimations: [], requests: [], solutions: [], bundles: [], settings: {} };
