import type {
  AddedBundle,
  AddedSolution,
  EstimateRequest,
  Estimation,
  EstimationSnapshot,
  EstimationTag,
  PersistedState
} from '../src/types';
import type { CellValue, SheetTable, WriteSheets, Workbook } from '../src/lib/xlsx';

/**
 * The bridge between app state and spreadsheet rows.
 *
 * Every row keeps its scalar columns readable so a human can scan the sheet in Excel, and
 * stashes the nested parts (selections, rate card, delivery plan) in a single JSON column so
 * the app round-trips losslessly.
 */

export const SHEETS = {
  estimations: 'Estimations',
  requests: 'Requests',
  solutions: 'EstimatedSolutions',
  bundles: 'CustomBundles',
  settings: 'Settings'
} as const;

export const COLUMNS = {
  estimations: ['id', 'plat', 'name', 'client', 'tag', 'due', 'created', 'updated', 'totalHours', 'cost', 'solutions', 'snapshotJson'],
  requests: [
    'id', 'plat', 'estimationId', 'estimationName', 'client', 'title', 'details', 'area', 'urgency',
    'integrations', 'requestedBy', 'email', 'org', 'submitted', 'estimateHours', 'repeatHours',
    'catalogId', 'bundleId', 'estimatedBy', 'estimatedOn', 'note', 'extraJson'
  ],
  solutions: [
    'id', 'plat', 'bundleId', 'name', 'description', 'firstHours', 'repeatHours', 'form', 'deploy',
    'category', 'subCategory', 'account', 'limits', 'note', 'fromRequest', 'addedOn', 'direct'
  ],
  bundles: ['id', 'plat', 'name', 'pitch', 'offerWhen', 'pairsWith', 'addedOn'],
  settings: ['key', 'valueJson']
} as const;

/**
 * Excel caps a cell at 32,767 characters and Google Sheets at 50,000. An imported catalog
 * serialises well past that, so long values are split across numbered rows and rejoined on
 * read — otherwise the tail is silently truncated and the value fails to parse.
 *
 * Each chunk is pipe-wrapped because the reader trims cell whitespace, which would otherwise
 * eat a space landing on a chunk boundary and corrupt the JSON.
 */
const CELL_LIMIT = 28_000;
const CHUNK_RE = /^(.*)##(\d+)\/(\d+)$/;
const wrapChunk = (value: string): string => `|${value}|`;
const unwrapChunk = (value: unknown): string => {
  const s = String(value ?? '');
  return s.startsWith('|') && s.endsWith('|') ? s.slice(1, -1) : s;
};

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const num = (value: unknown): number | null => {
  const parsed = Number.parseFloat(String(value).replace(/,/g, ''));
  return Number.isNaN(parsed) ? null : parsed;
};
const toJson = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
};
const fromJson = <T>(value: unknown): T | null => {
  if (value === null || value === undefined || value === '') return null;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return null;
  }
};

const TAGS: EstimationTag[] = ['Active', 'Urgent', 'On hold', 'Closed'];
const asTag = (value: unknown): EstimationTag => (TAGS.includes(value as EstimationTag) ? (value as EstimationTag) : 'Active');

/* ------------------------------------------------------- state → rows ---- */

export function stateToSheets(state: PersistedState): WriteSheets {
  const sheets: WriteSheets = {};
  const header = (key: keyof typeof COLUMNS): CellValue[][] => [[...COLUMNS[key]]];

  const estimations = header('estimations');
  for (const e of state.estimations ?? []) {
    estimations.push([
      str(e.id), str(e.plat || 'openedx'), str(e.name), str(e.client), str(e.tag || 'Active'), str(e.due),
      str(e.at), str(e.up), Number(e.total ?? 0), Number(e.cost ?? 0), Number(e.items ?? 0), toJson(e.snap)
    ]);
  }
  sheets[SHEETS.estimations] = estimations;

  const requests = header('requests');
  for (const r of state.requests ?? []) {
    requests.push([
      str(r.id), str(r.plat || 'openedx'), str(r.estId), str(r.estName), str(r.client), str(r.title),
      str(r.details), str(r.area), str(r.urgency), str(r.integrations), str(r.name), str(r.email), str(r.org),
      str(r.at),
      r.est !== undefined && r.est !== null ? Number(r.est) : '',
      r.repeatEst !== undefined && r.repeatEst !== null ? Number(r.repeatEst) : '',
      str(r.csId), str(r.catBundle), str(r.estBy), str(r.estAt), str(r.estNote),
      toJson({
        manual: Boolean(r.manual),
        catForm: r.catForm, catDeploy: r.catDeploy, catInteg: r.catInteg,
        catCategory: r.catCategory, catSub: r.catSub, catAccount: r.catAccount, catLimits: r.catLimits
      })
    ]);
  }
  sheets[SHEETS.requests] = requests;

  const solutions = header('solutions');
  for (const s of state.solutions ?? []) {
    solutions.push([
      str(s.id), str(s.plat || 'openedx'), str(s.bundleId), str(s.name), str(s.desc),
      s.first !== undefined && s.first !== null ? Number(s.first) : '',
      s.repeat !== undefined && s.repeat !== null ? Number(s.repeat) : '',
      str(s.form), str(s.deploy), str(s.category), str(s.subCategory), str(s.account), str(s.limits),
      str(s.note), str(s.from), str(s.estAt), s.direct ? 'yes' : ''
    ]);
  }
  sheets[SHEETS.solutions] = solutions;

  const bundles = header('bundles');
  for (const b of state.bundles ?? []) {
    bundles.push([str(b.id), str(b.plat || 'openedx'), str(b.name), str(b.pitch), str(b.offerWhen), str(b.pairsWith), str(b.at)]);
  }
  sheets[SHEETS.bundles] = bundles;

  const settings = header('settings');
  for (const [key, value] of Object.entries(state.settings ?? {})) {
    const payload = toJson(value);
    if (payload.length <= CELL_LIMIT) {
      settings.push([str(key), payload]);
      continue;
    }
    const parts = Math.ceil(payload.length / CELL_LIMIT);
    for (let i = 0; i < parts; i++) {
      settings.push([`${str(key)}##${i + 1}/${parts}`, wrapChunk(payload.slice(i * CELL_LIMIT, (i + 1) * CELL_LIMIT))]);
    }
  }
  sheets[SHEETS.settings] = settings;

  return sheets;
}

/* ------------------------------------------------------- rows → state ---- */

function objects(table: SheetTable | undefined): Record<string, string>[] {
  if (!table || table.length === 0) return [];
  const header = (table[0] ?? []).map((h) => String(h ?? '').trim());
  return table
    .slice(1)
    .filter((row) => row && row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      const out: Record<string, string> = {};
      header.forEach((name, i) => {
        if (name) out[name] = row[i] ?? '';
      });
      return out;
    });
}

export function sheetsToState(workbook: Workbook): PersistedState {
  const estimations: Estimation[] = objects(workbook[SHEETS.estimations])
    .map((r) => ({
      id: r.id ?? '',
      plat: r.plat || 'openedx',
      name: r.name ?? '',
      client: r.client ?? '',
      tag: asTag(r.tag),
      due: r.due ?? '',
      at: r.created ?? '',
      up: r.updated ?? '',
      total: num(r.totalHours) ?? 0,
      cost: num(r.cost) ?? 0,
      items: num(r.solutions) ?? 0,
      snap: fromJson<EstimationSnapshot>(r.snapshotJson) ?? { sel: {}, buf: {}, bufPct: 0 }
    }))
    .filter((e) => e.id);

  const requests: EstimateRequest[] = objects(workbook[SHEETS.requests])
    .map((r) => {
      const extra = fromJson<Record<string, unknown>>(r.extraJson) ?? {};
      const out: EstimateRequest = {
        id: r.id ?? '',
        plat: r.plat || 'openedx',
        estId: r.estimationId ?? '',
        estName: r.estimationName ?? '',
        client: r.client ?? '',
        title: r.title ?? '',
        details: r.details ?? '',
        area: r.area ?? '',
        urgency: r.urgency ?? '',
        integrations: r.integrations ?? '',
        name: r.requestedBy ?? '',
        email: r.email ?? '',
        org: r.org ?? '',
        at: r.submitted ?? '',
        estNote: r.note ?? '',
        estBy: r.estimatedBy ?? '',
        estAt: r.estimatedOn ?? '',
        csId: r.catalogId ?? '',
        catBundle: r.bundleId ?? ''
      };
      /* an un-estimated request must come back with NO hours: 0 would join the totals */
      const est = num(r.estimateHours);
      if (est !== null) out.est = est;
      const repeat = num(r.repeatHours);
      if (repeat !== null) out.repeatEst = repeat;
      if (extra.manual) out.manual = true;
      for (const key of ['catForm', 'catDeploy', 'catInteg', 'catCategory', 'catSub', 'catAccount', 'catLimits'] as const) {
        const value = extra[key];
        if (typeof value === 'string' && value) out[key] = value;
      }
      return out;
    })
    .filter((r) => r.id);

  const solutions: AddedSolution[] = objects(workbook[SHEETS.solutions])
    .map((r) => ({
      id: r.id ?? '',
      plat: r.plat || 'openedx',
      bundleId: r.bundleId ?? '',
      name: r.name ?? '',
      desc: r.description ?? '',
      first: num(r.firstHours) ?? 0,
      repeat: num(r.repeatHours) ?? 0,
      form: r.form ?? '',
      deploy: r.deploy ?? '',
      integrations: '',
      category: r.category ?? '',
      subCategory: r.subCategory ?? '',
      account: r.account ?? '',
      limits: r.limits ?? '',
      note: r.note ?? '',
      from: r.fromRequest ?? '',
      estAt: r.addedOn ?? '',
      direct: String(r.direct ?? '').toLowerCase() === 'yes'
    }))
    .filter((s) => s.id);

  const bundles: AddedBundle[] = objects(workbook[SHEETS.bundles])
    .map((r) => ({
      id: r.id ?? '',
      plat: r.plat || 'openedx',
      name: r.name ?? '',
      pitch: r.pitch ?? '',
      offerWhen: r.offerWhen ?? '',
      pairsWith: r.pairsWith || null,
      at: r.addedOn ?? ''
    }))
    .filter((b) => b.id);

  const settings: Record<string, unknown> = {};
  const chunks = new Map<string, { total: number; parts: (string | undefined)[] }>();
  for (const row of objects(workbook[SHEETS.settings])) {
    if (!row.key) continue;
    const match = CHUNK_RE.exec(row.key);
    if (!match) {
      settings[row.key] = fromJson(row.valueJson);
      continue;
    }
    const key = match[1]!;
    const bag = chunks.get(key) ?? { total: Number(match[3]), parts: [] };
    bag.parts[Number(match[2]) - 1] = unwrapChunk(row.valueJson);
    chunks.set(key, bag);
  }
  for (const [key, bag] of chunks) {
    let have = 0;
    for (let i = 0; i < bag.total; i++) if (bag.parts[i] !== undefined) have += 1;
    if (have !== bag.total) continue; /* a partial value is worse than none */
    settings[key] = fromJson(bag.parts.join(''));
  }

  return { estimations, requests, solutions, bundles, settings };
}

export const EMPTY_STATE: PersistedState = { estimations: [], requests: [], solutions: [], bundles: [], settings: {} };

export function countRows(state: PersistedState | null): number {
  if (!state) return 0;
  return state.estimations.length + state.requests.length + state.solutions.length + state.bundles.length;
}

/** Narrow an untrusted request body to the persisted shape. */
export function coerceState(body: unknown): PersistedState {
  const raw = (body ?? {}) as Partial<PersistedState>;
  const array = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  return {
    estimations: array<Estimation>(raw.estimations),
    requests: array<EstimateRequest>(raw.requests),
    solutions: array<AddedSolution>(raw.solutions),
    bundles: array<AddedBundle>(raw.bundles),
    settings: raw.settings && typeof raw.settings === 'object' ? (raw.settings as Record<string, unknown>) : {}
  };
}
