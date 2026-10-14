import type { AddedSolution, CatalogDetail, Estimation } from '../types.js';

/**
 * Internal details of catalog solutions, as pure functions the server's sheet reader and the app
 * share. Relative imports only: `server/schema.ts` loads this file, and Vercel runs it under Node.
 *
 * The details are Edly's own knowledge (who built a feature, for which client, where its code is),
 * so three places must never see them: the client's Excel sheet, the printed quote, and the screen
 * while presenting. The AI that matches tenders sees only what helps it match, with client names
 * and links taken out (`forMatcher`).
 */

/** A detail's id: one per solution per platform, never the id of any other stored row. */
export const catalogDetailId = (plat: string, solutionId: string): string => `${plat}/${solutionId}`;

/**
 * A yes or no as a person typed it in the tracker or the sheet: "Yes", "y", "TRUE", "no". Anything
 * else is not an answer, so it reads as null rather than as a no.
 */
export function readYesNo(value: unknown): boolean | null {
  const word = String(value ?? '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(word)) return true;
  if (['no', 'n', 'false', '0'].includes(word)) return false;
  return null;
}

export const yesNoLabel = (value: boolean | null): string => (value === null ? '' : value ? 'Yes' : 'No');

/** The internal fields a person can type, in the order the forms show them. */
export type InternalField = 'builtFor' | 'contact' | 'team' | 'source' | 'plugin' | 'mixed' | 'reuseCount' | 'dependencies' | 'implementation' | 'keywords';
export const INTERNAL_FIELDS: readonly InternalField[] = ['builtFor', 'contact', 'team', 'source', 'plugin', 'mixed', 'reuseCount', 'dependencies', 'implementation', 'keywords'];

/** The internal fields as a form holds them: all text, a yes or no as 'yes', 'no' or '' for not known. */
export type InternalForm = Record<InternalField, string>;

/** A form filled from what is stored, or empty for a solution with no details yet. */
export function internalForm(detail?: CatalogDetail): InternalForm {
  const yesNo = (value: boolean | null | undefined): string => (value === true ? 'yes' : value === false ? 'no' : '');
  return {
    builtFor: detail?.builtFor ?? '',
    contact: detail?.contact ?? '',
    team: detail?.team ?? '',
    source: detail?.source ?? '',
    plugin: yesNo(detail?.plugin),
    mixed: yesNo(detail?.mixed),
    reuseCount: detail?.reuseCount === null || detail?.reuseCount === undefined ? '' : String(detail.reuseCount),
    dependencies: detail?.dependencies ?? '',
    implementation: detail?.implementation ?? '',
    keywords: detail?.keywords ?? ''
  };
}

/**
 * The details a form holds, every field present and trimmed, so an emptied field is emptied when
 * saved. Times reused is the only field that can be wrong: it is a count, and "a few" is not one.
 */
export function readInternalForm(form: InternalForm): { patch: Pick<CatalogDetail, InternalField> } | { error: string } {
  const count = form.reuseCount.trim();
  if (count && !/^\d+$/.test(count)) return { error: 'Times reused is a whole number, 0 or more. Leave it empty when nobody knows.' };
  return {
    patch: {
      builtFor: form.builtFor.trim(),
      contact: form.contact.trim(),
      team: form.team.trim(),
      source: form.source.trim(),
      plugin: readYesNo(form.plugin),
      mixed: readYesNo(form.mixed),
      reuseCount: count ? Number(count) : null,
      dependencies: form.dependencies.trim(),
      implementation: form.implementation.trim(),
      keywords: form.keywords.trim()
    }
  };
}

/** Whether a form holds anything at all, so an untouched one saves no record. */
export const typedAny = (patch: Partial<Pick<CatalogDetail, InternalField>>): boolean =>
  INTERNAL_FIELDS.some((key) => patch[key] !== undefined && patch[key] !== null && patch[key] !== '');

/** The detail of one solution on one platform, if the tracker had it. */
export function detailFor(details: readonly CatalogDetail[], plat: string, solutionId: string): CatalogDetail | undefined {
  return details.find((one) => one.plat === plat && one.solutionId === solutionId);
}

/**
 * What a second import of the tracker leaves stored. A detail it brings replaces the stored one for
 * that solution, but a column the workbook does not have keeps what is stored: keywords typed into
 * the sheet survive a tracker that has no keywords column. Details for solutions the workbook does
 * not mention stay as they were.
 */
export function mergeDetails(stored: readonly CatalogDetail[], incoming: readonly Partial<CatalogDetail>[], has: ReadonlySet<keyof CatalogDetail>): CatalogDetail[] {
  const out = [...stored];
  for (const next of incoming) {
    if (!next.plat || !next.solutionId) continue;
    const id = catalogDetailId(next.plat, next.solutionId);
    const at = out.findIndex((one) => one.id === id);
    /* the stored row holds every field, so spreading it first keeps whatever the file has no column for */
    const fromFile = Object.fromEntries(Object.entries(next).filter(([key]) => has.has(key as keyof CatalogDetail) || key === 'importedFrom' || key === 'up'));
    const merged: CatalogDetail = { ...blank(next.plat, next.solutionId), ...(at >= 0 ? out[at] : {}), ...fromFile, id, plat: next.plat, solutionId: next.solutionId };
    if (at >= 0) out[at] = merged;
    else out.push(merged);
  }
  return out;
}

export const blank = (plat: string, solutionId: string): CatalogDetail => ({
  id: catalogDetailId(plat, solutionId),
  plat,
  solutionId,
  name: '',
  builtFor: '',
  contact: '',
  team: '',
  source: '',
  plugin: null,
  mixed: null,
  reuseCount: null,
  dependencies: '',
  implementation: '',
  keywords: '',
  importedFrom: '',
  up: ''
});

/** The details left once some solutions of one platform are gone. The same list when none of them had any. */
export function withoutDetails(details: CatalogDetail[], plat: string, solutionIds: readonly string[]): CatalogDetail[] {
  const gone = new Set(solutionIds);
  return details.some((one) => one.plat === plat && gone.has(one.solutionId)) ? details.filter((one) => !(one.plat === plat && gone.has(one.solutionId))) : details;
}

/** The line under a solution's details: the workbook they came from, or who typed them, and when. */
export function provenance(detail: Pick<CatalogDetail, 'importedFrom' | 'up'>): string {
  const from = detail.importedFrom.trim();
  const where = !from ? 'From the features tracker' : /^typed in /i.test(from) ? from : `From ${from}`;
  return detail.up ? `${where}, ${detail.up}` : where;
}

/** How ready a feature is to reuse, in words, from the tracker's two yes-or-no columns and its count. */
export function reuseLine(detail: Pick<CatalogDetail, 'plugin' | 'mixed' | 'reuseCount'>): string {
  const parts = [
    detail.plugin === true ? 'already a plugin' : detail.plugin === false ? 'not packaged as a plugin yet' : '',
    detail.mixed === true ? 'mixed with other features, so it is extracted before reuse' : '',
    detail.reuseCount !== null && detail.reuseCount > 0 ? `reused ${detail.reuseCount} ${detail.reuseCount === 1 ? 'time' : 'times'} so far` : detail.reuseCount === 0 ? 'not reused yet' : ''
  ].filter(Boolean);
  const line = parts.join('; ');
  return line ? `${line.charAt(0).toUpperCase()}${line.slice(1)}.` : '';
}

/** Edly's own product is not a client, and its name is in the public catalog already. */
const OWN = new Set(['edly', 'edly cloud']);

/** Every client the app knows by name, from its deals and the estimates imported for them. */
export const knownClients = (estimations: readonly Pick<Estimation, 'client'>[], solutions: readonly Pick<AddedSolution, 'client'>[]): string[] => [
  ...new Set([...estimations.map((one) => one.client), ...solutions.map((one) => one.client ?? '')].map((name) => (name ?? '').trim()).filter(Boolean))
];

/**
 * Words that begin a client's name without being one. Taken alone, "The" of "The Riverside University"
 * would turn every "the" the AI reads into "a client", and "Global" of a Global Certification
 * Academy every "global"; so the first word stands for the client only when it is not one of these.
 */
const COMMON_FIRST = new Set(
  (
    'the a an and of for our my new old open global national international digital online learning smart ' +
    'university college school academy institute foundation group team ministry department centre center ' +
    'state royal united american british european african asian arab city community public private first one'
  ).split(' ')
);

/**
 * The client names the AI must not see: each client in "Originally built for" ("Acme Academy and
 * Nordic University" is two), every client the app knows from its deals and imported estimates, and
 * the first word of a longer name, since the text says "Acme specific" where the column says
 * "Acme-LMS".
 */
export function clientNames(details: readonly Pick<CatalogDetail, 'builtFor'>[], clients: readonly string[] = []): string[] {
  const names = new Set<string>();
  for (const said of [...details.map((detail) => detail.builtFor), ...clients]) {
    for (const part of said.split(/\s+and\s+|[,&;/]/i)) {
      const name = part.trim();
      if (name.length < 3 || OWN.has(name.toLowerCase()) || COMMON_FIRST.has(name.toLowerCase())) continue;
      names.add(name);
      const first = name.split(/[\s-]+/)[0] ?? '';
      if (first.length >= 3 && first !== name && !OWN.has(first.toLowerCase()) && !COMMON_FIRST.has(first.toLowerCase())) names.add(first);
    }
  }
  /* longest first, so "Acme-LMS" is replaced before "Acme" can split it */
  return [...names].sort((a, b) => b.length - a.length);
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Text for the AI with links and client names taken out. Neither helps it match, and both are Edly's to keep. */
export function scrub(text: string, names: readonly string[]): string {
  /* a link or an address ends before the punctuation after it, so the sentence keeps its full stop */
  let out = text.replace(/\b(?:https?:\/\/|www\.)\S*[^\s.,;:!?)\]'"]/gi, '').replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '');
  const pattern = namePattern(names);
  if (pattern) out = out.replace(pattern, 'a client');
  return out.replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

/* One pattern per list, built once: the matcher scrubs every solution against every client the app
   knows. The names come longest first, so "Acme-LMS" is tried before "Acme" at the same place. */
const patterns = new WeakMap<readonly string[], RegExp | null>();
function namePattern(names: readonly string[]): RegExp | null {
  let pattern = patterns.get(names);
  if (pattern === undefined) {
    pattern = names.length > 0 ? new RegExp(`(?<![\\w-])(?:${names.map(escape).join('|')})(?![\\w-])`, 'gi') : null;
    patterns.set(names, pattern);
  }
  return pattern;
}

/**
 * What the matcher reads from a solution's details: the words a tender would use, what it depends
 * on and how it is built, scrubbed. Never who built it, for whom, who to ask or where the code is.
 */
export function forMatcher(detail: Pick<CatalogDetail, 'keywords' | 'dependencies' | 'implementation'> | undefined, names: readonly string[], max = 600): string {
  if (!detail) return '';
  const parts = [
    detail.keywords ? `Also called: ${detail.keywords}` : '',
    detail.dependencies ? `Needs: ${detail.dependencies}` : '',
    detail.implementation ? `How it is built: ${detail.implementation}` : ''
  ]
    .map((part) => scrub(part, names))
    .filter((part) => part && !/^(Also called|Needs|How it is built):?$/.test(part))
    /* each part ends with a full stop, so "Needs: X" never runs into "How it is built" when X lost its link */
    .map((part) => `${part.replace(/[\s.,;:]+$/, '')}.`);
  const text = parts.join(' ');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
