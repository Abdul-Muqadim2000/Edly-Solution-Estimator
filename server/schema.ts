import type {
  AddedBundle,
  Assignment,
  AddedSolution,
  EstimateRequest,
  Estimation,
  EstimationSnapshot,
  EstimationTag,
  PersistedState,
  SalesLegalItem,
  Tender,
  TenderStage
} from '../src/types.js';
import type { CellValue, SheetTable, WriteSheets, Workbook } from '../src/lib/xlsx.js';
import { joinNotes, withSlugs } from '../src/lib/format.js';
import { usdOf } from '../src/domain/aiPrice.js';
import { aiSpent, aiStep, DEFAULT_AI_LIMIT } from '../src/domain/tender.js';
import { categoryLabel, readCategory, readDay, readStatus, readTopic, statusLabel, topicLabel } from '../src/domain/salesLegal.js';
import { withoutDemo } from '../src/domain/demo.js';
import { assignedDetail, assignedLabel, normalUsername, readAssigned, readEvent } from '../src/domain/people.js';
import { defaultStage, readRequestStage, readStage, stageLabel, stageOf, ticketLabel, ticketStage } from '../src/domain/stages.js';

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
  settings: 'Settings',
  tenders: 'Tenders',
  salesLegal: 'SalesAccountLegal'
} as const;

export const COLUMNS = {
  /* `slug` sits beside `name` rather than at the end: every column is read by name, so inserting
     one cannot break an older file, and burying it past the 28 KB snapshotJson cell would defeat
     the point of keeping the scalar columns scannable in Excel. */
  estimations: [
    'id', 'plat', 'name', 'slug', 'client', 'tag', 'stage', 'assignedTo', 'due', 'created', 'updated', 'totalHours', 'cost', 'solutions',
    'assignedJson', 'snapshotJson'
  ],
  /* `stage` and `status` are written as the words a person reads ("In review", "Needs info") and
     read back from whatever a person typed there, like the sales and legal list. A row from before
     either existed has a blank there: a deal reads as Completed when tagged Closed and In progress
     otherwise, and a request as Backlog. A priced request is written as Estimated, and its hours,
     not the word, are what say so on the way back.
     `assignedTo` is the people on a deal or a request, as "@muqadim, @sara", and it is what says who
     on the way back, so a name typed there assigns that person and one deleted there unassigns them.
     Who assigned each and when sits in JSON beside it (`assignedJson`, or the request's `extraJson`). */
  requests: [
    'id', 'plat', 'estimationId', 'estimationName', 'client', 'title', 'status', 'assignedTo', 'details', 'area', 'urgency',
    'integrations', 'requestedBy', 'email', 'org', 'submitted', 'estimateHours', 'repeatHours',
    'catalogId', 'bundleId', 'estimatedBy', 'estimatedOn', 'note', 'tenderId', 'tenderRequirement', 'extraJson'
  ],
  /* `integrations` and `estimationName` came later, and so did the five columns after `direct`,
     which only an estimate imported from a workbook fills in. All are read by name and default
     when absent, so a sheet written before them still loads.
     `note` is the solution's Notes / Assumptions, its one note. A `limits` column used to sit
     beside it and is no longer written; a row that still has one is joined into the note when
     read. The column kept its name so a tab still running an older build reads the whole entry
     as its note rather than dropping it. `note` on Requests, and `catLimits` in its extraJson,
     work the same way. */
  solutions: [
    'id', 'plat', 'bundleId', 'name', 'description', 'firstHours', 'repeatHours', 'form', 'deploy',
    'integrations', 'category', 'subCategory', 'account', 'note', 'fromRequest', 'estimationName',
    'addedOn', 'direct', 'importedFrom', 'sourceId', 'client', 'estimatedBy', 'importedOn'
  ],
  bundles: ['id', 'plat', 'name', 'pitch', 'offerWhen', 'pairsWith', 'addedOn', 'importedFrom'],
  settings: ['key', 'valueJson'],
  /* The counts between `updated` and `sentOn` are written for whoever scans the sheet and never
     read back: the requirements in `detailJson` are the record, and the counts follow from them.
     `aiSpent` is the same: the dollars in `detailJson` are the record. `detailJson` stays last,
     because a tender's continuation rows put their part in the last column. */
  tenders: [
    'id', 'plat', 'name', 'slug', 'client', 'due', 'stage', 'created', 'updated', 'requirements', 'approved',
    'catalog', 'partial', 'custom', 'outOfScope', 'estimationId', 'sentOn', 'aiSpent', 'aiLimit', 'aiApproved', 'readTerms', 'detailJson'
  ],
  /* The columns a legal or account colleague works in come first, so the sheet reads without
     scrolling. `estimationName` and `client` are written for them and never read back: the item
     keeps its deal's id, and a renamed deal shows its new name on the next save. */
  salesLegal: [
    'id', 'plat', 'estimationId', 'estimationName', 'client', 'category', 'item', 'status', 'owner', 'due', 'note',
    'reason', 'kind', 'topic', 'priority', 'source', 'section', 'quote', 'tenderId', 'tenderItem', 'created', 'updated'
  ]
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

const assignedField = (assigned: Assignment[]): Pick<Estimation, 'assigned'> => (assigned.length > 0 ? { assigned } : {});
const asTag = (value: unknown): EstimationTag => (TAGS.includes(value as EstimationTag) ? (value as EstimationTag) : 'Active');

/* ------------------------------------------------------- state → rows ---- */

export function stateToSheets(state: PersistedState): WriteSheets {
  const sheets: WriteSheets = {};
  const header = (key: keyof typeof COLUMNS): CellValue[][] => [[...COLUMNS[key]]];

  const estimations = header('estimations');
  for (const e of state.estimations ?? []) {
    estimations.push([
      str(e.id), str(e.plat || 'openedx'), str(e.name), str(e.slug), str(e.client), str(e.tag || 'Active'), stageLabel(stageOf(e)),
      assignedLabel(e.assigned), str(e.due), str(e.at), str(e.up), Number(e.total ?? 0), Number(e.cost ?? 0), Number(e.items ?? 0),
      assignedDetail(e.assigned), toJson(e.snap)
    ]);
  }
  sheets[SHEETS.estimations] = estimations;

  const requests = header('requests');
  for (const r of state.requests ?? []) {
    requests.push([
      str(r.id), str(r.plat || 'openedx'), str(r.estId), str(r.estName), str(r.client), str(r.title), ticketLabel(ticketStage(r)),
      assignedLabel(r.assigned), str(r.details), str(r.area), str(r.urgency), str(r.integrations), str(r.name), str(r.email), str(r.org),
      str(r.at),
      r.est !== undefined && r.est !== null ? Number(r.est) : '',
      r.repeatEst !== undefined && r.repeatEst !== null ? Number(r.repeatEst) : '',
      str(r.csId), str(r.catBundle), str(r.estBy), str(r.estAt), str(r.catNotes), str(r.tender), str(r.tenderReq),
      toJson({
        manual: Boolean(r.manual),
        catForm: r.catForm, catDeploy: r.catDeploy, catInteg: r.catInteg,
        catCategory: r.catCategory, catSub: r.catSub, catAccount: r.catAccount,
        /* who filed it, who is on it and who last moved or priced it: what notifications are made from */
        by: r.by || undefined, assigned: r.assigned?.length ? r.assigned : undefined, staged: r.staged, priced: r.priced
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
      str(s.form), str(s.deploy), str(s.integrations), str(s.category), str(s.subCategory), str(s.account),
      str(s.notes), str(s.from), str(s.estName), str(s.estAt), s.direct ? 'yes' : '',
      str(s.imported), str(s.sourceId), str(s.client), str(s.estBy), str(s.importedOn)
    ]);
  }
  sheets[SHEETS.solutions] = solutions;

  const bundles = header('bundles');
  for (const b of state.bundles ?? []) {
    bundles.push([str(b.id), str(b.plat || 'openedx'), str(b.name), str(b.pitch), str(b.offerWhen), str(b.pairsWith), str(b.at), str(b.imported)]);
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

  /* A tender's requirements run well past one cell, so its detail splits the way a long setting
     does: the tender's own row holds the first part, and each further part gets a row keyed
     `id##2/3` with every other column blank. Parts are pipe-wrapped for the same reason. */
  const tenders = header('tenders');
  for (const t of state.tenders ?? []) {
    /* the terms and their reads are absent from a tender that never asked for them, and stay absent */
    const detail = toJson({ summary: t.summary, docs: t.docs, fit: t.fit, outline: t.outline, ranges: t.ranges, reqs: t.reqs, tokens: t.tokens, terms: t.terms, termReads: t.termReads });
    const parts = Math.max(1, Math.ceil(detail.length / CELL_LIMIT));
    const part = (i: number): string => (parts === 1 ? detail : wrapChunk(detail.slice(i * CELL_LIMIT, (i + 1) * CELL_LIMIT)));
    const counts = { total: t.reqs.length, approved: 0, catalog: 0, partial: 0, custom: 0, out: 0 };
    for (const req of t.reqs) {
      if (req.status !== 'approved') continue;
      counts.approved += 1;
      if (req.match) counts[req.match.kind] += 1;
    }
    tenders.push([
      str(t.id), str(t.plat || 'openedx'), str(t.name), str(t.slug), str(t.client), str(t.due), str(t.stage), str(t.at), str(t.up),
      counts.total, counts.approved, counts.catalog, counts.partial, counts.custom, counts.out, str(t.estId), str(t.sentAt),
      Math.round(aiSpent(t) * 100) / 100, aiStep(t), Math.max(0, Number(t.aiApproved) || 0), t.readTerms ? 'yes' : '', part(0)
    ]);
    for (let i = 1; i < parts; i++) {
      tenders.push([`${str(t.id)}##${i + 1}/${parts}`, ...new Array<string>(COLUMNS.tenders.length - 2).fill(''), part(i)]);
    }
  }
  sheets[SHEETS.tenders] = tenders;

  /* Category and status go in as the words a person reads, and come back from whatever a person
     typed over them in the sheet: the teams assign and close these rows there. */
  const deals = new Map((state.estimations ?? []).map((one) => [one.id, one] as const));
  const salesLegal = header('salesLegal');
  for (const item of state.salesLegal ?? []) {
    const deal = deals.get(item.estId);
    salesLegal.push([
      str(item.id), str(item.plat || 'openedx'), str(item.estId), str(deal?.name), str(deal?.client),
      item.category ? categoryLabel(item.category) : '', str(item.text), statusLabel(item.status), str(item.owner), str(item.due), str(item.note),
      str(item.reason), item.kind === 'term' ? 'term' : 'obligation', item.topic ? topicLabel(item.topic) : '', item.priority === 'should' ? 'should' : 'must',
      str(item.source), str(item.section), str(item.quote), str(item.tender), str(item.tenderItem), str(item.at), str(item.up)
    ]);
  }
  sheets[SHEETS.salesLegal] = salesLegal;

  return sheets;
}

/* ------------------------------------------------------- rows → state ---- */

/** A tab's rows as objects keyed by its header, skipping blank rows. Columns are read by name, never by position. */
export function objects(table: SheetTable | undefined): Record<string, string>[] {
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
  /* Rows written before the slug column existed come back blank; `withSlugs` fills those in,
     uniquely per platform, without ever recomputing one that is already set. */
  const estimations: Estimation[] = withSlugs(
    objects(workbook[SHEETS.estimations])
    .map((r) => ({
      id: r.id ?? '',
      plat: r.plat || 'openedx',
      name: r.name ?? '',
      slug: r.slug ?? '',
      client: r.client ?? '',
      tag: asTag(r.tag),
      stage: readStage(r.stage) ?? defaultStage(asTag(r.tag)),
      due: r.due ?? '',
      at: r.created ?? '',
      up: r.updated ?? '',
      total: num(r.totalHours) ?? 0,
      cost: num(r.cost) ?? 0,
      items: num(r.solutions) ?? 0,
      snap: fromJson<EstimationSnapshot>(r.snapshotJson) ?? { sel: {}, buf: {}, bufPct: 0 },
      /* set only when someone is on it, so a deal nobody is on reads back exactly as it was written */
      ...assignedField(readAssigned(r.assignedTo, r.assignedJson))
    }))
      .filter((e) => e.id)
  );

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
        estBy: r.estimatedBy ?? '',
        estAt: r.estimatedOn ?? '',
        csId: r.catalogId ?? '',
        catBundle: r.bundleId ?? ''
      };
      /* set only when present, so a request typed by hand reads back exactly as it was written */
      if (r.tenderId) out.tender = r.tenderId;
      if (r.tenderRequirement) out.tenderReq = r.tenderRequirement;
      /* an un-estimated request must come back with NO hours: 0 would join the totals */
      const est = num(r.estimateHours);
      if (est !== null) out.est = est;
      /* Backlog is the absence of a stage, and a priced request carries none: its hours place it */
      const stage = readRequestStage(r.status);
      if (stage && stage !== 'backlog' && !(Number(out.est) > 0)) out.stage = stage;
      const repeat = num(r.repeatHours);
      if (repeat !== null) out.repeatEst = repeat;
      if (extra.manual) out.manual = true;
      const by = normalUsername(extra.by);
      if (by) out.by = by;
      const assigned = readAssigned(r.assignedTo, extra.assigned);
      if (assigned.length > 0) out.assigned = assigned;
      const staged = readEvent(extra.staged);
      if (staged) out.staged = staged;
      const priced = readEvent(extra.priced);
      if (priced) out.priced = priced;
      for (const key of ['catForm', 'catDeploy', 'catInteg', 'catCategory', 'catSub', 'catAccount'] as const) {
        const value = extra[key];
        if (typeof value === 'string' && value) out[key] = value;
      }
      /* an older row kept the desk's limits apart from its note; they are one entry now, limits first */
      const notes = joinNotes(typeof extra.catLimits === 'string' ? extra.catLimits : '', r.note);
      if (notes) out.catNotes = notes;
      return out;
    })
    .filter((r) => r.id);

  const solutions: AddedSolution[] = objects(workbook[SHEETS.solutions])
    .map((r) => {
      const out: AddedSolution = {
        id: r.id ?? '',
        plat: r.plat || 'openedx',
        bundleId: r.bundleId ?? '',
        name: r.name ?? '',
        desc: r.description ?? '',
        first: num(r.firstHours) ?? 0,
        repeat: num(r.repeatHours) ?? 0,
        form: r.form ?? '',
        deploy: r.deploy ?? '',
        integrations: r.integrations ?? '',
        category: r.category ?? '',
        subCategory: r.subCategory ?? '',
        account: r.account ?? '',
        notes: joinNotes(r.limits, r.note),
        from: r.fromRequest ?? '',
        estAt: r.addedOn ?? '',
        direct: String(r.direct ?? '').toLowerCase() === 'yes'
      };
      /* only a solution priced from a request belongs to a deal; one entered at the desk has none */
      if (r.estimationName) out.estName = r.estimationName;
      /* set only when present, like estName, so a solution priced in the app reads back as written */
      if (r.importedFrom) out.imported = r.importedFrom;
      if (r.sourceId) out.sourceId = r.sourceId;
      if (r.client) out.client = r.client;
      if (r.estimatedBy) out.estBy = r.estimatedBy;
      if (r.importedOn) out.importedOn = r.importedOn;
      return out;
    })
    .filter((s) => s.id);

  const bundles: AddedBundle[] = objects(workbook[SHEETS.bundles])
    .map((r) => {
      const out: AddedBundle = {
        id: r.id ?? '',
        plat: r.plat || 'openedx',
        name: r.name ?? '',
        pitch: r.pitch ?? '',
        offerWhen: r.offerWhen ?? '',
        pairsWith: r.pairsWith || null,
        at: r.addedOn ?? ''
      };
      if (r.importedFrom) out.imported = r.importedFrom;
      return out;
    })
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
    /* Hold the place of the first chunk, so a split value comes back where it was written.
       Appending it after the loop moved the Open edX catalog to the end on every read. */
    if (!chunks.has(key) && !(key in settings)) settings[key] = undefined;
    const bag = chunks.get(key) ?? { total: Number(match[3]), parts: [] };
    bag.parts[Number(match[2]) - 1] = unwrapChunk(row.valueJson);
    chunks.set(key, bag);
  }
  for (const [key, bag] of chunks) {
    let have = 0;
    for (let i = 0; i < bag.total; i++) if (bag.parts[i] !== undefined) have += 1;
    if (have !== bag.total) {
      /* a partial value is worse than none */
      if (settings[key] === undefined) delete settings[key];
      continue;
    }
    settings[key] = fromJson(bag.parts.join(''));
  }

  /* read by name and forgiving, because people edit this sheet by hand: a status typed as "done",
     a date typed the way the sheet displays dates */
  const salesLegal: SalesLegalItem[] = objects(workbook[SHEETS.salesLegal])
    .map((r): SalesLegalItem => {
      const topic = readTopic(r.topic);
      return {
      id: r.id ?? '',
      plat: r.plat || 'openedx',
      estId: r.estimationId ?? '',
      tender: r.tenderId ?? '',
      tenderItem: r.tenderItem ?? '',
      category: readCategory(r.category),
      kind: String(r.kind ?? '').trim().toLowerCase() === 'term' ? 'term' : 'obligation',
      text: r.item ?? '',
      quote: r.quote ?? '',
      source: r.source ?? '',
      section: r.section ?? '',
      reason: r.reason ?? '',
      /* set only when present, so an item that is not a term reads back as written */
      ...(topic ? { topic } : {}),
      priority: String(r.priority ?? '').trim().toLowerCase() === 'should' ? 'should' : 'must',
      owner: r.owner ?? '',
      status: readStatus(r.status),
      due: readDay(r.due),
      note: r.note ?? '',
      at: r.created ?? '',
      up: r.updated ?? ''
      };
    })
    .filter((item) => item.id);

  return { estimations, requests, solutions, bundles, settings, tenders: readTenders(workbook[SHEETS.tenders]), salesLegal };
}

const STAGES: TenderStage[] = ['requirements', 'match', 'apply', 'done'];

interface TenderDetail {
  summary?: string;
  docs?: Tender['docs'];
  fit?: Tender['fit'];
  outline?: Tender['outline'];
  ranges?: Tender['ranges'];
  reqs?: Tender['reqs'];
  tokens?: Partial<Tender['tokens']>;
  terms?: Tender['terms'];
  termReads?: Tender['termReads'];
}

/**
 * Tenders, with their split detail joined back up. A tender whose parts do not all arrive is
 * dropped rather than loaded with half its requirements: a partial list reads as a finished one.
 */
function readTenders(table: SheetTable | undefined): Tender[] {
  const rows = objects(table);
  const split = new Map<string, { total: number; parts: (string | undefined)[] }>();
  for (const row of rows) {
    const match = CHUNK_RE.exec(row.id ?? '');
    if (!match) continue;
    const bag = split.get(match[1]!) ?? { total: Number(match[3]), parts: [] };
    bag.parts[Number(match[2]) - 1] = unwrapChunk(row.detailJson);
    split.set(match[1]!, bag);
  }

  const tenders: Tender[] = [];
  for (const row of rows) {
    if (!row.id || CHUNK_RE.test(row.id)) continue;
    const bag = split.get(row.id);
    let detail: TenderDetail | null;
    if (bag) {
      bag.parts[0] = unwrapChunk(row.detailJson);
      /* a counting loop, not `every`: `every` skips the hole a missing middle part leaves */
      let whole = true;
      for (let i = 0; i < bag.total; i++) if (bag.parts[i] === undefined) whole = false;
      detail = whole ? fromJson<TenderDetail>(bag.parts.slice(0, bag.total).join('')) : null;
    } else {
      detail = fromJson<TenderDetail>(row.detailJson);
    }
    if (!detail) continue;

    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...(detail.tokens ?? {}) };
    const limit = num(row.aiLimit);
    const approved = num(row.aiApproved);
    tenders.push({
      id: row.id,
      plat: row.plat || 'openedx',
      name: row.name ?? '',
      slug: row.slug ?? '',
      client: row.client ?? '',
      due: row.due ?? '',
      summary: detail.summary ?? '',
      at: row.created ?? '',
      up: row.updated ?? '',
      stage: STAGES.includes(row.stage as TenderStage) ? (row.stage as TenderStage) : 'requirements',
      docs: Array.isArray(detail.docs) ? detail.docs : [],
      fit: detail.fit ?? null,
      outline: Array.isArray(detail.outline) ? detail.outline : [],
      ranges: Array.isArray(detail.ranges) ? detail.ranges : [],
      reqs: Array.isArray(detail.reqs) ? detail.reqs : [],
      estId: row.estimationId ?? '',
      sentAt: row.sentOn ?? '',
      /* a tender saved before its cost was kept is priced from its tokens at Opus 5.5, the default
         model since 2026-09-28, so that its limit means something when it is opened again */
      tokens: { ...tokens, usd: typeof tokens.usd === 'number' ? tokens.usd : usdOf(tokens, 'claude-opus-5-5') },
      aiLimit: limit !== null && limit > 0 ? limit : DEFAULT_AI_LIMIT,
      aiApproved: approved !== null && approved > 0 ? approved : 0,
      /* each set only when present, so a tender that never asked for its terms reads back as written */
      ...(String(row.readTerms ?? '').trim().toLowerCase() === 'yes' ? { readTerms: true } : {}),
      ...(Array.isArray(detail.terms) ? { terms: detail.terms } : {}),
      ...(Array.isArray(detail.termReads) ? { termReads: detail.termReads } : {})
    });
  }
  return withSlugs(tenders);
}

/* --------------------------------------------------- comparing for sync ---- */

/**
 * The state exactly as a store hands it back: into cells, every cell read as trimmed text, and
 * out again. It is the file round trip without the zip.
 *
 * A cell cannot tell '' from a missing field, the reader trims, and the sheet has no column for
 * a few fields the reducer sets. So the browser's copy and the store's copy of the same data are
 * never the same text, and comparing them raw made every poll look like a change.
 */
export function storedForm(state: PersistedState): PersistedState {
  const cells: Workbook = {};
  for (const [name, rows] of Object.entries(stateToSheets(state))) {
    cells[name] = rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim())));
  }
  return sheetsToState(cells);
}

/** JSON with object keys sorted, so two copies of one state serialise alike whatever order they were built in. */
const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner
  );

/**
 * Equal exactly when a store would hold the same thing. `useSync` compares these, never raw
 * payloads: one side of every comparison is the browser's copy and the other is the store's.
 */
export function syncKey(state: PersistedState): string {
  return stableJson(storedForm(state));
}

export const EMPTY_STATE: PersistedState = { estimations: [], requests: [], solutions: [], bundles: [], settings: {}, tenders: [], salesLegal: [] };

export function countRows(state: PersistedState | null): number {
  if (!state) return 0;
  return state.estimations.length + state.requests.length + state.solutions.length + state.bundles.length + state.tenders.length + state.salesLegal.length;
}

/**
 * Whether a save that holds no rows names every row the store holds as one a person deleted.
 *
 * The demo is never stored, so deleting the last real deal leaves nothing to save, and the guard
 * that stops a browser which lost its data from blanking the store refused it. A person's deletes
 * are named by id (`deleted`, kept by the reducer), and an empty save goes through only when those
 * names cover the whole store. A browser that lost its data names nothing, and a row another tab
 * added since is not named, so both are still refused.
 */
export function namesEveryRow(stored: PersistedState | null, deleted: unknown): boolean {
  if (!Array.isArray(deleted)) return false;
  const named = new Set(deleted.filter((id): id is string => typeof id === 'string' && id !== ''));
  if (named.size === 0) return false;
  const rows = [stored?.estimations, stored?.requests, stored?.solutions, stored?.bundles, stored?.tenders, stored?.salesLegal];
  return rows.every((list) => (list ?? []).every((row) => named.has(row.id)));
}

/**
 * Narrow an untrusted request body to the persisted shape. The demo estimation's records are taken
 * out whatever a client sends: the browser never sends them, and this makes sure none is stored.
 */
export function coerceState(body: unknown): PersistedState {
  const raw = (body ?? {}) as Partial<PersistedState>;
  const array = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  return withoutDemo({
    estimations: array<Estimation>(raw.estimations),
    requests: array<EstimateRequest>(raw.requests),
    solutions: array<AddedSolution>(raw.solutions),
    bundles: array<AddedBundle>(raw.bundles),
    tenders: array<Tender>(raw.tenders),
    salesLegal: array<SalesLegalItem>(raw.salesLegal),
    /* an array is an object, and one here would write numbered junk into the Settings sheet */
    settings:
      raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)
        ? (raw.settings as Record<string, unknown>)
        : {}
  });
}
