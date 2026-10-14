import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogDetail, Solution } from '../src/types';
import { blank, catalogDetailId, clientNames, detailFor, forMatcher, internalForm, knownClients, mergeDetails, provenance, readInternalForm, readYesNo, reuseLine, scrub, typedAny, withoutDetails, yesNoLabel } from '../src/domain/catalogDetails';
import { EMPTY_ENTRY, ENTRY_STATUSES, nextEntryForm, readEntryForm, type EntryForm } from '../src/domain/deskEntry';
import { readTracker, type TrackerPlan } from '../src/domain/trackerImport';

/**
 * Internal details of catalog solutions: who built a feature, for which client, who to ask and
 * where the code is. They are read from the team's reusable features tracker, matched to the
 * catalog, and kept apart from anything a client sees. The AI that matches tenders reads only what
 * helps it match, with client names and links taken out.
 */

const solution = (id: string, name: string, first: number | null = 10): Solution => ({
  id,
  name,
  desc: '',
  form: null,
  status: 'Production',
  deploy: null,
  first,
  repeat: null,
  build: null,
  saving: null,
  account: null,
  integrations: null,
  notes: null,
  ref: null,
  category: null,
  subCategory: null
});

const catalog: Catalog = {
  meta: { title: 'Open edX', subtitle: '' },
  bundles: [
    {
      id: 'B04',
      name: 'Assessment & Credentials',
      pitch: '',
      offerWhen: '',
      featureCount: 3,
      buildHrs: null,
      firstHrs: null,
      repeatHrs: null,
      saved: null,
      noEstimate: 0,
      inDev: 0,
      accounts: null,
      pairsWith: null,
      items: [solution('EDU-013', 'Badges', 180), solution('EDU-005', 'Dynamic Theming', 8), solution('EDU-020', 'Program'), solution('EDU-021', 'Program')]
    }
  ]
} as unknown as Catalog;

/* the tracker as the team keeps it: a title, a note, a row of column groups, then the real header */
const header = [
  '#', 'Feature / Module Name', 'Description', 'Category', 'Plugin Status', 'Already a Plugin?', 'Mixed With Other Features?', 'Originally Built For (Client)',
  'Original Dev Hours (a)', 'Reuse Count (so far)', 'Hours to Convert to Plugin (b)', 'Hours for Custom Config per Reuse (c)', 'Est. Hours \u2014 First Reuse (b+c)',
  'Hours Saved per Subsequent Reuse (a\u2212c)', '% Effort Reduction', 'Status', 'Dependencies', 'Implementation Description', 'GitHub URL', 'Person of Contact', 'Configuration Notes', 'Owner / Team'
];
const row = (over: Record<string, string>): string[] => header.map((name) => over[name] ?? '');
const tracker = (rows: string[][], extra: Record<string, string[][]> = {}): Record<string, string[][]> => ({
  Inventory: [
    ['Reusable Features & Effort Optimization Tracker'],
    ['Centralized inventory of reusable modules.'],
    ['Identification', '', '', '', 'Classification', '', '', 'Effort \u2014 Original Build'],
    header,
    ...rows
  ],
  Summary: [['KPI', 'Value'], ['Total Features Tracked', '2']],
  ...extra
});

const badges = row({
  '#': '1.0',
  'Feature / Module Name': 'Badges',
  'Already a Plugin?': 'No',
  'Mixed With Other Features?': 'Yes',
  'Originally Built For (Client)': 'Acme Academy',
  'Reuse Count (so far)': '2.0',
  'Hours to Convert to Plugin (b)': '90.0',
  'Hours for Custom Config per Reuse (c)': '90.0',
  'Est. Hours \u2014 First Reuse (b+c)': '180',
  Dependencies: 'Will require core changes in the platform and MFEs',
  'Implementation Description': 'Built for Acme Academy first. Details in https://github.com/example/badges/issues/7',
  'GitHub URL': 'https://github.com/example/badges',
  'Person of Contact': 'Sam Rivers',
  'Owner / Team': 'Team Orange'
});
const theming = row({
  '#': '2.0',
  'Feature / Module Name': 'dynamic   THEMING',
  'Originally Built For (Client)': 'Nordic University',
  'Hours to Convert to Plugin (b)': '120',
  'Hours for Custom Config per Reuse (c)': '8',
  'Est. Hours \u2014 First Reuse (b+c)': '8',
  'GitHub URL': 'Nordic Azure DevOps (Private)',
  'Person of Contact': 'Slack - #platform'
});

const plan = (workbook: Record<string, string[][]>): TrackerPlan => {
  const read = readTracker(workbook, catalog, 'openedx', 'Reusable features.xlsx', '2026-10-14');
  if ('error' in read) throw new Error(read.error);
  return read;
};

describe('reading the tracker', () => {
  it('finds the header under the title rows, passes over the Summary sheet, and reads each feature', () => {
    const read = plan(tracker([badges, theming]));
    expect(read.sheet).toBe('Inventory');
    expect(read.matched.map((one) => [one.row, one.solutionId])).toEqual([
      [5, 'EDU-013'],
      [6, 'EDU-005']
    ]);
    expect(read.details[0]).toEqual({
      plat: 'openedx',
      solutionId: 'EDU-013',
      name: 'Badges',
      importedFrom: 'Reusable features.xlsx',
      up: '2026-10-14',
      builtFor: 'Acme Academy',
      contact: 'Sam Rivers',
      team: 'Team Orange',
      source: 'https://github.com/example/badges',
      plugin: false,
      mixed: true,
      reuseCount: 2,
      dependencies: 'Will require core changes in the platform and MFEs',
      implementation: 'Built for Acme Academy first. Details in https://github.com/example/badges/issues/7'
    });
    /* a name typed with other spacing and case is still the same feature */
    expect(read.details[1]).toMatchObject({ solutionId: 'EDU-005', source: 'Nordic Azure DevOps (Private)', contact: 'Slack - #platform', plugin: null });
  });

  it('names the columns the file has, so a second import keeps what it has no column for', () => {
    const read = plan(tracker([badges]));
    expect(read.columns).toEqual(['name', 'builtFor', 'contact', 'team', 'source', 'plugin', 'mixed', 'reuseCount', 'dependencies', 'implementation']);
    expect(read.columns).not.toContain('keywords');
  });

  it('flags a feature whose first-reuse hours are not its own conversion plus configuration', () => {
    /* the catalog's first-delivery hours were copied from this column, so a slip here underprices a bid */
    expect(plan(tracker([badges, theming])).warnings).toEqual([
      'dynamic   THEMING (EDU-005, row 6): first reuse is 8 h, but conversion 120 h plus configuration 8 h is 128 h. The catalog prices it at 8 h.'
    ]);
  });

  it('matches by Solution ID when the sheet has one, and says why a row could not be matched', () => {
    const withIds = ['Solution ID', ...header];
    const idRow = (id: string, name: string): string[] => [id, ...row({ 'Feature / Module Name': name, 'Originally Built For (Client)': 'Acme Academy' })];
    const read = plan({
      Inventory: [
        withIds,
        idRow('edu-013', 'Renamed in the tracker'),
        idRow('EDU-999', 'Gone from the catalog'),
        idRow('', 'Not in the catalog at all'),
        idRow('', 'Program'),
        idRow('', 'Badges'),
        idRow('EXAMPLE-1', 'Template row')
      ]
    });
    expect(read.matched).toEqual([{ row: 2, name: 'Renamed in the tracker', solutionId: 'EDU-013' }]);
    expect(read.unmatched.map((one) => [one.row, one.why])).toEqual([
      [3, 'The catalog has no solution EDU-999.'],
      [4, 'No catalog solution has this name. Add a Solution ID column to match it by id.'],
      [5, 'More than one catalog solution has this name (EDU-020, EDU-021). Add a Solution ID column to say which.'],
      [6, 'Row 2 already describes EDU-013; the first one is kept.']
    ]);
  });

  it('reads a trimmed-down tracker, with a solution named by id alone and keywords the team added', () => {
    /* a sheet keeping only some columns brings only those, and an id with no name still matches */
    const read = plan({
      Features: [
        ['Solution ID', 'Feature', 'Tender keywords', 'Reuse Count', 'Hours to Convert to Plugin', 'Hours for Custom Config per Reuse', 'Est. Hours First Reuse'],
        ['EDU-020', '', 'programs, pathways', 'n/a', '10', '5', '15'],
        ['EDU-005', 'Dynamic Theming', '', '-3', '120', '8', '8']
      ]
    });
    expect(read.columns).toEqual(['name', 'reuseCount', 'keywords']);
    expect(read.details[0]).toEqual({ plat: 'openedx', solutionId: 'EDU-020', name: 'EDU-020', importedFrom: 'Reusable features.xlsx', up: '2026-10-14', reuseCount: null, keywords: 'programs, pathways' });
    /* a negative count is a typing slip, not a negative number of reuses */
    expect(read.details[1]?.reuseCount).toBe(0);
    expect(read.matched[0]).toEqual({ row: 2, name: 'EDU-020', solutionId: 'EDU-020' });
    /* sums that add up raise nothing; the catalog's hours are named only when it has them */
    expect(read.warnings).toEqual(['Dynamic Theming (EDU-005, row 3): first reuse is 8 h, but conversion 120 h plus configuration 8 h is 128 h. The catalog prices it at 8 h.']);
    const unpriced = plan({ Features: [['Solution ID', 'Feature', 'Team', 'Hours to Convert to Plugin', 'Hours for Custom Config per Reuse', 'Est. Hours First Reuse'], ['EDU-020', 'Program', 'Ops', '1.5', '1', '1']] });
    expect(unpriced.warnings).toEqual(['Program (EDU-020, row 2): first reuse is 1 h, but conversion 1.5 h plus configuration 1 h is 2.5 h. The catalog prices it at 10 h.']);
  });

  it('refuses a workbook that is not the tracker, such as the catalog itself, and one with no features', () => {
    const notTracker = readTracker({ B04: [['Solution ID', 'Feature', 'What it does'], ['EDU-013', 'Badges', 'Digital badges']] }, catalog, 'openedx', 'catalog.xlsx', '2026-10-14');
    expect(notTracker).toEqual({ error: expect.stringContaining('who built them') });
    expect(readTracker(tracker([]), catalog, 'openedx', 'empty.xlsx', '2026-10-14')).toEqual({ error: 'The Inventory sheet has a header row but no features under it.' });
  });
});

describe('keeping the details', () => {
  const stored: CatalogDetail[] = [
    { ...blank('openedx', 'EDU-013'), name: 'Badges', builtFor: 'Old client', keywords: 'open badges', contact: 'Old contact' },
    { ...blank('openedx', 'EDU-049'), name: 'Word Cloud', builtFor: 'Edly Cloud' }
  ];

  it('replaces a solution’s details from a new import, but keeps a field the file has no column for', () => {
    const next = mergeDetails(stored, [{ plat: 'openedx', solutionId: 'EDU-013', name: 'Badges', builtFor: 'Acme Academy', contact: '', importedFrom: 'tracker.xlsx', up: '2026-10-14' }], new Set(['name', 'builtFor', 'contact']));
    /* keywords typed into the sheet survive a tracker that has no keywords column; an emptied contact is emptied */
    expect(next[0]).toMatchObject({ id: 'openedx/EDU-013', builtFor: 'Acme Academy', contact: '', keywords: 'open badges', importedFrom: 'tracker.xlsx' });
    expect(next[1]).toBe(stored[1]);
  });

  it('adds a solution it has not seen, with every field present, and skips one with no solution', () => {
    const next = mergeDetails(stored, [{ plat: 'openedx', solutionId: 'EDU-005', name: 'Dynamic Theming', team: 'Team Orange' }, { plat: 'openedx', name: 'No id' }], new Set(['name', 'team']));
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ ...blank('openedx', 'EDU-005'), name: 'Dynamic Theming', team: 'Team Orange' });
  });

  it('finds a solution’s details on its own platform only', () => {
    expect(detailFor(stored, 'openedx', 'EDU-013')?.name).toBe('Badges');
    expect(detailFor(stored, 'moodle', 'EDU-013')).toBeUndefined();
    expect(catalogDetailId('moodle', 'MD-1')).toBe('moodle/MD-1');
  });

  it('says how ready a feature is to reuse, and nothing when the tracker does not say', () => {
    expect(reuseLine({ plugin: true, mixed: false, reuseCount: 1 })).toBe('Already a plugin; reused 1 time so far.');
    expect(reuseLine({ plugin: false, mixed: true, reuseCount: 0 })).toBe('Not packaged as a plugin yet; mixed with other features, so it is extracted before reuse; not reused yet.');
    expect(reuseLine({ plugin: null, mixed: null, reuseCount: null })).toBe('');
  });

  it('reads a yes or no however it was typed, and anything else as no answer', () => {
    expect(['Yes', ' y ', 'TRUE', '1'].map(readYesNo)).toEqual([true, true, true, true]);
    expect(['No', 'n', 'false', '0'].map(readYesNo)).toEqual([false, false, false, false]);
    /* "Partly" is not a no: reading it as one would claim the feature is not a plugin */
    expect(['', 'Partly', undefined].map(readYesNo)).toEqual([null, null, null]);
    expect([true, false, null].map(yesNoLabel)).toEqual(['Yes', 'No', '']);
  });

  it('drops the details of solutions that are gone, on their platform only, and changes nothing otherwise', () => {
    const moodle = { ...blank('moodle', 'EDU-013'), name: 'Badges on Moodle' };
    const all = [...stored, moodle];
    expect(withoutDetails(all, 'openedx', ['EDU-013']).map((one) => one.id)).toEqual(['openedx/EDU-049', 'moodle/EDU-013']);
    /* the same list back, so a removal with no details makes no change for the sync to save */
    expect(withoutDetails(all, 'openedx', ['CS-09'])).toBe(all);
  });

  it('says where the details came from: the tracker by file name, or who typed them', () => {
    expect(provenance({ importedFrom: 'tracker.xlsx', up: '2026-10-14' })).toBe('From tracker.xlsx, 2026-10-14');
    expect(provenance({ importedFrom: 'Typed in Quotient by Sara Khan', up: '2026-10-14' })).toBe('Typed in Quotient by Sara Khan, 2026-10-14');
    /* rows the team typed straight into the sheet have neither */
    expect(provenance({ importedFrom: '', up: '' })).toBe('From the features tracker');
  });
});

describe('what the AI may read', () => {
  const details = [
    { builtFor: 'Acme Academy and Nordic University' },
    { builtFor: 'Edly Cloud' },
    { builtFor: 'NU-LMS' },
    { builtFor: 'TC' }
  ];

  it('knows the client names to take out, each client of a shared row and the first word of a longer name', () => {
    /* Edly Cloud is Edly's own product, not a client; two letters are too short to replace safely */
    expect(clientNames(details)).toEqual(['Nordic University', 'Acme Academy', 'Nordic', 'NU-LMS', 'Acme']);
  });

  it('takes out links, email addresses and client names, whole words only', () => {
    const names = clientNames(details);
    expect(scrub('Built for nordic university first; see https://github.com/example/x and ask sam@example.com. NU-LMS specific.', names)).toBe(
      'Built for a client first; see and ask. a client specific.'
    );
    /* part of another word is left alone */
    expect(scrub('Acmeville and Nordicware are not clients', names)).toBe('Acmeville and Nordicware are not clients');
  });

  it('takes the first word of a longer name only when it is a name, never "The" or "Global"', () => {
    const names = clientNames([{ builtFor: 'The Riverside University' }, { builtFor: 'Harbor Foundation' }], ['Global Certification Academy', 'Open']);
    expect(names).toEqual(['Global Certification Academy', 'The Riverside University', 'Harbor Foundation', 'Harbor']);
    /* with "The" on the list every sentence the matcher read would lose its articles */
    expect(scrub('The pipeline is global and open source, first built for The Riverside University.', names)).toBe('The pipeline is global and open source, first built for a client.');
  });

  it('takes out every client the app knows, from its deals and imported estimates, once each', () => {
    const clients = knownClients([{ client: 'Acme Academy' }, { client: ' ' }], [{ client: 'Nordic University' }, { client: undefined }, { client: 'Acme Academy' }]);
    expect(clients).toEqual(['Acme Academy', 'Nordic University']);
    expect(scrub('Estimated for Nordic University, reused for Acme.', clientNames([], clients))).toBe('Estimated for a client, reused for a client.');
  });

  it('builds the matcher’s text from keywords, needs and how it is built, never from who or where', () => {
    const detail: CatalogDetail = {
      ...blank('openedx', 'EDU-013'),
      builtFor: 'Acme Academy',
      contact: 'Sam Rivers',
      source: 'https://github.com/example/badges',
      keywords: 'digital badges, micro-credentials',
      dependencies: 'Core changes in the platform',
      implementation: 'A Django app built for Acme Academy. https://docs.example.com/badges'
    };
    const text = forMatcher(detail, clientNames([detail]));
    expect(text).toBe('Also called: digital badges, micro-credentials. Needs: Core changes in the platform. How it is built: A Django app built for a client.');
    expect(text).not.toMatch(/Sam Rivers|github|Acme/);
    /* a part that lost its link at the end still stops before the next one begins */
    expect(forMatcher({ ...detail, keywords: '', dependencies: 'A Proctorio account, see https://example.com/p', implementation: 'An XBlock' }, [])).toBe('Needs: A Proctorio account, see. How it is built: An XBlock.');
    expect(forMatcher(undefined, [])).toBe('');
    expect(forMatcher({ ...detail, keywords: '', dependencies: '', implementation: 'https://only.a.link' }, [])).toBe('');
    /* long implementation notes are cut, so one solution cannot crowd the catalog out of a call */
    expect(forMatcher({ ...detail, implementation: 'word '.repeat(400) }, [], 120)).toHaveLength(120);
  });
});

describe('typing the details by hand', () => {
  const stored: CatalogDetail = {
    ...blank('openedx', 'EDU-013'),
    name: 'Badges',
    builtFor: 'Acme Academy',
    source: 'https://example.com/acme/badges',
    plugin: true,
    mixed: false,
    reuseCount: 0
  };

  it('fills the form from what is stored and reads it back unchanged', () => {
    const form = internalForm(stored);
    expect(form).toMatchObject({ builtFor: 'Acme Academy', plugin: 'yes', mixed: 'no', reuseCount: '0', contact: '' });
    const read = readInternalForm(form);
    expect('patch' in read && { ...stored, ...read.patch }).toEqual(stored);
  });

  it('reads an empty form as nothing typed, with every field present so an emptied one is emptied', () => {
    const read = readInternalForm({ ...internalForm(), builtFor: '  ', reuseCount: ' ' });
    expect(read).toEqual({ patch: { builtFor: '', contact: '', team: '', source: '', plugin: null, mixed: null, reuseCount: null, dependencies: '', implementation: '', keywords: '' } });
    expect('patch' in read && typedAny(read.patch)).toBe(false);
    /* a no is an answer, so it counts as typed even though it is false */
    expect(typedAny({ plugin: false })).toBe(true);
  });

  it('refuses a times-reused that is not a count', () => {
    expect(readInternalForm({ ...internalForm(), reuseCount: 'a few' })).toEqual({ error: expect.stringMatching(/whole number/) });
    expect(readInternalForm({ ...internalForm(), reuseCount: '-1' })).toEqual({ error: expect.stringMatching(/whole number/) });
  });
});

describe('the desk adding a solution by hand', () => {
  const form = (over: Partial<EntryForm> = {}): EntryForm => ({ ...EMPTY_ENTRY, name: ' Proctoring ', first: '30', ...over });

  it('reads an estimate as one always was, with no status and no internal details', () => {
    const read = readEntryForm(form({ category: '' }), internalForm(), 'B02');
    expect(read).toEqual({
      input: { name: 'Proctoring', desc: '', first: 30, repeat: 30, bundleId: 'B02', form: 'Custom development', deploy: '', integrations: '', category: 'Custom', subCategory: '', account: '', notes: '' }
    });
  });

  it('reads every field the catalog has, the saving as a percentage, and the internal details typed', () => {
    const read = readEntryForm(
      form({ repeat: '8', status: 'Production', build: '1,200', saving: '75%', ref: ' https://example.com/acme/proctoring ' }),
      { ...internalForm(), builtFor: 'Acme Academy', plugin: 'no', contact: '' },
      'B02'
    );
    expect('input' in read && read.input).toMatchObject({ repeat: 8, status: 'Production', build: 1200, saving: 0.75, ref: 'https://example.com/acme/proctoring' });
    /* only what was typed goes with it: an empty contact is not a detail */
    expect('input' in read && read.input.internal).toEqual({ builtFor: 'Acme Academy', plugin: false });
  });

  it('says what is wrong, one thing at a time, before anything is added', () => {
    expect(readEntryForm(form({ name: ' ' }), internalForm(), 'B02')).toEqual({ error: 'Give the solution a name.' });
    expect(readEntryForm(form({ first: '0' }), internalForm(), 'B02')).toEqual({ error: 'Enter the first-delivery hours.' });
    expect(readEntryForm(form({ build: 'lots' }), internalForm(), 'B02')).toEqual({ error: expect.stringMatching(/Original build hours/) });
    expect(readEntryForm(form({ saving: '150' }), internalForm(), 'B02')).toEqual({ error: expect.stringMatching(/0 to 100/) });
    expect(readEntryForm(form(), { ...internalForm(), reuseCount: 'twice' }, 'B02')).toEqual({ error: expect.stringMatching(/Times reused/) });
  });

  it('files an entry with no bundle under Unassigned', () => {
    const read = readEntryForm(form(), internalForm(), '');
    expect('input' in read && read.input.bundleId).toBe('CX');
  });

  it('clears what describes the last entry and keeps where it was filed, status back to estimate', () => {
    const next = nextEntryForm(form({ bundleId: 'B02', category: 'Assessment', status: 'Production', build: '120', ref: 'x', notes: 'n' }));
    expect(next).toEqual({ ...EMPTY_ENTRY, bundleId: 'B02', category: 'Assessment' });
    expect(ENTRY_STATUSES.map((one) => one.value)).toEqual(['', 'Production', 'In Development']);
  });
});
