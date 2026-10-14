import type { AddedSolution, CatalogDetail } from '@/types';
import { readInternalForm, type InternalField, type InternalForm } from '@/domain/catalogDetails';

/**
 * The desk's Add to catalog form, read into what the reducer stores. Every field a solution in the
 * master sheet has can be typed here, so a feature built for a client before the catalog knew it
 * is entered as what it is, not as an estimate; and the internal details (who it was built for,
 * the code, who to ask) are saved beside it, never on it, so the Excel sheet and the quote, which
 * read solutions, cannot carry them.
 */

export interface NewSolutionInput {
  name: string;
  desc: string;
  first: number;
  repeat: number;
  bundleId: string;
  form: string;
  deploy: string;
  integrations: string;
  category: string;
  subCategory: string;
  account: string;
  /** Notes / Assumptions, one entry. Blank for none. */
  notes: string;
  /** Absent for an estimate; built before or being built otherwise. */
  status?: AddedSolution['status'];
  build?: number;
  saving?: number;
  ref?: string;
  /** Internal details saved with it (who built it, contact, code...), never shown to a client. */
  internal?: Partial<CatalogDetail>;
}

export type EntryStatus = '' | NonNullable<AddedSolution['status']>;

export interface EntryForm {
  name: string;
  desc: string;
  first: string;
  repeat: string;
  /** Empty until someone picks one; the form then shows the bundle guessed from the category. */
  bundleId: string;
  form: string;
  deploy: string;
  integrations: string;
  category: string;
  subCategory: string;
  account: string;
  notes: string;
  status: EntryStatus;
  build: string;
  saving: string;
  ref: string;
}

export const EMPTY_ENTRY: EntryForm = {
  name: '',
  desc: '',
  first: '',
  repeat: '',
  bundleId: '',
  form: 'Custom development',
  deploy: '',
  integrations: '',
  category: '',
  subCategory: '',
  account: '',
  notes: '',
  status: '',
  build: '',
  saving: '',
  ref: ''
};

/** The statuses as the form offers them, in the catalog's own words. */
export const ENTRY_STATUSES: { value: EntryStatus; label: string }[] = [
  { value: '', label: 'Estimate, not built yet' },
  { value: 'Production', label: 'Built before, in production' },
  { value: 'In Development', label: 'In development' }
];

/**
 * The form after an entry is added: what describes this one item is cleared, and where it is filed
 * stays, since the desk often enters several of a kind in a row. The status goes back to estimate,
 * so a built-before left over from the last entry cannot mark the next one as shipped.
 */
export const nextEntryForm = (form: EntryForm): EntryForm => ({
  ...form,
  name: '',
  desc: '',
  first: '',
  repeat: '',
  deploy: '',
  notes: '',
  status: '',
  build: '',
  saving: '',
  ref: ''
});

/** A number as typed, with thousands separators and a trailing % allowed. NaN when it is not one. */
const typedNumber = (value: string): number => Number(value.replace(/[,%\s]/g, ''));

/**
 * The entry the form describes, or the first thing wrong with it. `bundleId` is the bundle the form
 * shows, which is the guess from the category until someone picks one.
 */
export function readEntryForm(form: EntryForm, internal: InternalForm, bundleId: string): { input: NewSolutionInput } | { error: string } {
  const name = form.name.trim();
  if (!name) return { error: 'Give the solution a name.' };
  const first = typedNumber(form.first);
  if (!(first > 0)) return { error: 'Enter the first-delivery hours.' };
  const repeat = typedNumber(form.repeat);

  const build = form.build.trim() ? typedNumber(form.build) : undefined;
  if (build !== undefined && !(build > 0)) return { error: 'Original build hours are a number of hours. Leave them empty when nobody measured them.' };
  /* a saving is typed as a percentage, the way the catalog shows it, and stored as a fraction */
  const saving = form.saving.trim() ? typedNumber(form.saving) : undefined;
  if (saving !== undefined && !(saving >= 0 && saving <= 100)) return { error: 'Reuse saving is a percentage from 0 to 100.' };

  const details = readInternalForm(internal);
  if ('error' in details) return details;

  const input: NewSolutionInput = {
    name,
    desc: form.desc.trim(),
    first,
    repeat: repeat > 0 ? repeat : first,
    bundleId: bundleId || 'CX',
    form: form.form,
    deploy: form.deploy.trim(),
    integrations: form.integrations.trim(),
    category: form.category.trim() || 'Custom',
    subCategory: form.subCategory.trim(),
    account: form.account.trim(),
    notes: form.notes.trim()
  };
  /* set only when given, so an estimate is stored exactly as one always was */
  if (form.status) input.status = form.status;
  if (build !== undefined) input.build = build;
  if (saving !== undefined) input.saving = Math.round(saving * 100) / 10_000;
  if (form.ref.trim()) input.ref = form.ref.trim();
  const typed = Object.entries(details.patch).filter(([, value]) => value !== '' && value !== null);
  if (typed.length > 0) input.internal = Object.fromEntries(typed) as Partial<Pick<CatalogDetail, InternalField>>;
  return { input };
}
