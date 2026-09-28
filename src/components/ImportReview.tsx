import { useState } from 'react';
import { approveAll, setGroup, setRow, type GroupKind, type ImportReview, type ReviewGroup, type ReviewSummary } from '@/domain/importReview';
import { hours, plural } from '@/lib/format';
import { useHover } from '@/lib/useHover';
import { color, font, radius } from '@/theme';
import { Button, Field, Row, Select, Spacer } from '@/components/ui';

/**
 * The review step of an import: every group the file proposes, each to be approved, sent
 * elsewhere, renamed or left out, and its rows to be moved or left out one by one.
 *
 * It only edits the decisions. Where each row lands, what is blocked and what is still pending
 * all come from the plan (`planEstimateImport`, `planBundleImport`), the same functions the
 * import itself runs.
 */

const KIND: Record<GroupKind, { label: string; bg: string; co: string }> = {
  existing: { label: 'Existing bundle', bg: color.brandWash, co: color.brandInk },
  new: { label: 'New bundle', bg: color.amberWash, co: color.amberInk },
  clash: { label: 'Same ID, other bundle', bg: color.redWash, co: color.redInk },
  unassigned: { label: 'No bundle given', bg: color.surfaceMuted, co: color.muted }
};

const EDGE = { pending: color.amberEdge, approved: color.brand, skipped: color.rule } as const;

/** Rows drawn per group before "Show more", so a 1,200-row file stays quick to open. */
const PAGE = 100;

export function ImportReviewPanel({
  summary,
  review,
  onChange,
  noun
}: {
  summary: ReviewSummary;
  review: ImportReview;
  onChange: (next: ImportReview) => void;
  /** "estimate" or "solution". */
  noun: string;
}): JSX.Element {
  const approvable = summary.groups.filter((group) => group.status === 'pending' && !group.blocked).length;
  return (
    <div style={{ border: `1px solid ${color.hairline}`, borderRadius: radius.lg, background: color.surfaceSoft, padding: '14px 16px' }}>
      <Row gap={10}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: color.ink }}>Review before importing</div>
          <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.55, marginTop: 2, maxWidth: 560 }}>
            Decide every group: approve it, send it to another bundle, or leave it out. Open a group to move or leave out single{' '}
            {noun}s.
          </div>
        </div>
        <Spacer />
        <span style={{ fontSize: 12, fontWeight: 700, color: summary.pending > 0 ? color.amberInk : color.brandInk }}>
          {summary.pending > 0 ? `${plural(summary.pending, 'group')} to review` : 'Every group decided'}
        </span>
        <Button size="sm" disabled={approvable === 0} onClick={() => onChange(approveAll(review, summary.groups))} title="Approve every group still pending">
          Approve all remaining{approvable > 0 ? ` (${approvable})` : ''}
        </Button>
      </Row>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {summary.groups.map((group) => (
          <GroupCard key={group.key} group={group} summary={summary} review={review} onChange={onChange} noun={noun} />
        ))}
      </div>
    </div>
  );
}

function GroupCard({
  group,
  summary,
  review,
  onChange,
  noun
}: {
  group: ReviewGroup;
  summary: ReviewSummary;
  review: ImportReview;
  onChange: (next: ImportReview) => void;
  noun: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const kind = KIND[group.kind];
  const canOwn = group.kind === 'new' || group.kind === 'clash';
  const options = [
    ...(canOwn ? [{ value: group.key, label: group.kind === 'clash' ? 'Its own bundle, under a free ID' : 'Its own new bundle (name it below)' }] : []),
    /* an existing bundle's group key is its own destination, so only a group with a bundle of its own drops it */
    ...summary.destinations.filter((one) => !(canOwn && one.key === group.key)).map((one) => ({ value: one.key, label: one.label }))
  ];
  const decide = (status: 'approved' | 'skipped'): void => onChange(setGroup(review, group.key, { status: group.status === status ? 'pending' : status }));
  const moved = group.rows.filter((row) => row.to || row.skip).length;

  return (
    <div
      data-review-group={group.key}
      data-status={group.status}
      style={{
        background: color.surface,
        border: `1px solid ${color.hairline}`,
        borderLeft: `4px solid ${EDGE[group.status]}`,
        borderRadius: radius.md,
        padding: '10px 12px',
        opacity: group.status === 'skipped' ? 0.72 : 1
      }}
    >
      <Row gap={8}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: kind.co, background: kind.bg, borderRadius: radius.pill, padding: '2px 9px', whiteSpace: 'nowrap' }}>{kind.label}</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: color.ink }}>{group.label}</span>
        <span style={{ fontSize: 11.5, color: color.muted }}>
          {plural(group.rows.length, noun)} · {hours(group.hours)} h{moved > 0 ? ` · ${moved} changed one by one` : ''}
        </span>
        <Spacer />
        <DecisionButton on={group.status === 'approved'} tone="approve" disabled={Boolean(group.blocked) && group.status !== 'approved'} onClick={() => decide('approved')}>
          {group.status === 'approved' ? 'Approved' : 'Approve'}
        </DecisionButton>
        <DecisionButton on={group.status === 'skipped'} tone="skip" onClick={() => decide('skipped')}>
          {group.status === 'skipped' ? 'Left out' : 'Leave out'}
        </DecisionButton>
      </Row>

      {group.status !== 'skipped' ? (
        <div style={{ display: 'grid', gridTemplateColumns: group.renameable ? 'repeat(auto-fit, minmax(220px, 1fr))' : 'minmax(0, 1fr)', gap: 10, marginTop: 10 }}>
          <Select
            label="Put them in"
            value={group.to}
            options={options}
            hint="Where this group's rows go"
            onChange={(value) => onChange(setGroup(review, group.key, { to: value }))}
          />
          {group.renameable ? (
            <Field label="Name of the new bundle" value={group.name} onChange={(value) => onChange(setGroup(review, group.key, { name: value }))} placeholder={group.label} />
          ) : null}
        </div>
      ) : null}

      <div style={{ fontSize: 12, color: color.body, marginTop: 8, lineHeight: 1.5 }}>
        <span style={{ color: color.muted }}>{group.status === 'skipped' ? 'Not imported.' : 'Lands in: '}</span>
        {group.status === 'skipped' ? null : <b>{group.lands}</b>}
      </div>
      {group.note ? <div style={{ fontSize: 12, color: color.amberInk, marginTop: 4, lineHeight: 1.5 }}>{group.note}</div> : null}
      {group.blocked ? <div style={{ fontSize: 12, color: color.redInk, fontWeight: 600, marginTop: 4 }}>{group.blocked}</div> : null}

      <div style={{ marginTop: 8 }}>
        <TextButton onClick={() => setOpen((value) => !value)}>
          {open ? `Hide the ${plural(group.rows.length, noun).replace(/^\S+ /, '')}` : `Show the ${plural(group.rows.length, noun)}`}
        </TextButton>
      </div>

      {open ? (
        <div style={{ marginTop: 8, borderTop: `1px solid ${color.hairlineSoft}` }}>
          {group.rows.slice(0, shown).map((row) => (
            <div
              key={row.key}
              style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) minmax(180px, 260px)', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${color.hairlineSoft}` }}
            >
              <input
                type="checkbox"
                checked={!row.skip}
                disabled={group.status === 'skipped'}
                aria-label={`Import ${row.title}`}
                onChange={(event) => onChange(setRow(review, row.key, { skip: !event.target.checked }))}
                style={{ width: 16, height: 16, accentColor: color.brand, cursor: 'pointer' }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: row.skip ? color.faint : color.ink, textDecoration: row.skip ? 'line-through' : 'none' }}>{row.title}</div>
                <div style={{ fontSize: 11, color: color.muted, lineHeight: 1.45 }}>
                  {row.detail}
                  {row.to || row.skip ? <span style={{ color: color.brandInk, fontWeight: 600 }}> · {row.lands}</span> : null}
                </div>
                {row.notes ? (
                  <div
                    title={row.notes}
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      whiteSpace: 'pre-line',
                      fontSize: 11,
                      color: color.body,
                      lineHeight: 1.45,
                      marginTop: 2
                    }}
                  >
                    {row.notes}
                  </div>
                ) : null}
              </div>
              <Select
                value={row.to ?? ''}
                options={[{ value: '', label: 'With the group' }, ...summary.destinations.map((one) => ({ value: one.key, label: one.label }))]}
                hint={`Where ${row.title} goes`}
                onChange={(value) => onChange(setRow(review, row.key, { to: value || undefined }))}
                style={{ padding: '6px 8px', fontSize: 12, borderRadius: 8 }}
              />
            </div>
          ))}
          {group.rows.length > shown ? (
            <div style={{ marginTop: 8 }}>
              <TextButton onClick={() => setShown((value) => value + PAGE)}>{`Show ${Math.min(PAGE, group.rows.length - shown)} more`}</TextButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DecisionButton({
  on,
  tone,
  disabled,
  onClick,
  children
}: {
  on: boolean;
  tone: 'approve' | 'skip';
  disabled?: boolean;
  onClick: () => void;
  children: string;
}): JSX.Element {
  const h = useHover();
  /* white on the deeper brand green; on the light one it falls under readable contrast */
  const active = tone === 'approve' ? { bg: color.brandDeep, co: color.onSolid, edge: color.brandDeep } : { bg: color.surfaceMuted, co: color.ink, edge: color.ghost };
  const idle = tone === 'approve' ? { co: color.brandInk, edge: color.brandEdge } : { co: color.muted, edge: color.rule };
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      {...h.bind}
      title={on ? 'Click again to undo' : undefined}
      style={{
        borderWidth: 1.5,
        borderStyle: 'solid',
        borderColor: on ? active.edge : h.on && !disabled ? active.edge : idle.edge,
        background: on ? active.bg : h.on && !disabled ? color.surfaceSoft : color.surface,
        color: on ? active.co : idle.co,
        borderRadius: radius.pill,
        padding: '5px 12px',
        fontSize: 11.5,
        fontWeight: 700,
        fontFamily: font.body,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease'
      }}
    >
      {children}
    </button>
  );
}

function TextButton({ onClick, children }: { onClick: () => void; children: string }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...h.bind}
      style={{
        border: 'none',
        background: 'none',
        padding: 0,
        fontFamily: font.body,
        fontSize: 12,
        fontWeight: 700,
        color: color.brandDeep,
        textDecoration: h.on ? 'underline' : 'none',
        cursor: 'pointer',
        transition: 'color 120ms ease'
      }}
    >
      {children}
    </button>
  );
}
