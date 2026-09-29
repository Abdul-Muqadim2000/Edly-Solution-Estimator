import type { ReactNode } from 'react';
import type { SalesLegalCategory, SalesLegalStatus } from '@/types';
import type { Action } from '@/state/reducer';
import { SALES_LEGAL_CATEGORIES, SALES_LEGAL_STATUSES, statusLabel, type SalesLegalDraft } from '@/domain/salesLegal';
import { color } from '@/theme';
import { Chip, Row } from '@/components/ui';

/**
 * Pieces the tender tab, the apply step and the builder panel share for sales, account and legal
 * items. Status carries the colour: amber is what still needs someone, the brand green what is done.
 * Categories stay neutral, because violet already means an estimate everywhere in the app.
 */

const STATUS_TONE: Record<SalesLegalStatus, { bg: string; co: string }> = {
  open: { bg: color.amberWash, co: color.amberInk },
  handled: { bg: color.brandWashDeep, co: color.brandInk },
  'not-ours': { bg: color.surfaceMuted, co: color.muted }
};

export function StatusChip({ status }: { status: SalesLegalStatus }): JSX.Element {
  return (
    <Chip bg={STATUS_TONE[status].bg} co={STATUS_TONE[status].co}>
      {statusLabel(status)}
    </Chip>
  );
}

/**
 * Keeping a draft for the estimation, or leaving it out: stored on the match for an out-of-scope
 * requirement, on the term for a key term. The tab and the apply step both tick through this.
 */
export function keepAction(tenderId: string, draft: Pick<SalesLegalDraft, 'key' | 'kind'>, keep: boolean): Action {
  return draft.kind === 'term'
    ? { type: 'editTerm', id: tenderId, termId: draft.key, patch: { skip: !keep } }
    : { type: 'editMatch', id: tenderId, reqId: draft.key, patch: { skip: !keep } };
}

export const statusTone = (status: SalesLegalStatus): { bg: string; co: string } => STATUS_TONE[status];

export const STATUS_OPTIONS = SALES_LEGAL_STATUSES.map((one) => ({ value: one.id, label: one.label }));

/** The five teams, and a first entry for an item nobody has sorted yet. */
export function categoryOptions(current: SalesLegalCategory | ''): { value: SalesLegalCategory | ''; label: string }[] {
  const teams = SALES_LEGAL_CATEGORIES.map((one) => ({ value: one.id as SalesLegalCategory | '', label: one.label }));
  return current ? teams : [{ value: '', label: 'Choose a team…' }, ...teams];
}

/** A category's heading over its items, with the count and what belongs there. */
export function GroupHeading({ label, count, hint, action }: { label: string; count: number; hint?: string; action?: ReactNode }): JSX.Element {
  return (
    <Row gap={8} style={{ padding: '2px 2px 0' }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: color.muted }}>
        {label} <span style={{ color: color.faint }}>{count}</span>
      </span>
      {hint ? <span style={{ fontSize: 11, color: color.faint, flex: '1 1 200px', minWidth: 0 }}>{hint}</span> : <span style={{ flex: 1 }} />}
      {action}
    </Row>
  );
}
