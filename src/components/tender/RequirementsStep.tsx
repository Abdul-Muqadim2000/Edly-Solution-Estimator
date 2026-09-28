import { memo, useCallback, useMemo, useState } from 'react';
import type { RequirementPriority, Tender, TenderDocument, TenderRequirement } from '@/types';
import type { Action } from '@/state/reducer';
import { docRefs, type TenderRunner } from '@/state/useTenderRunner';
import { rangeLabel, sectionPages, skippedSections, sourceLabel, tenderCounts } from '@/domain/tender';
import { plural } from '@/lib/format';
import { color, font, radius } from '@/theme';
import { Banner, Button, Empty, Field, Mono, Row, SearchInput, Select, Spacer, TextArea } from '@/components/ui';
import { useHover } from '@/lib/useHover';
import { Check, FilterPill, PriorityToggle, Progress, rowEdge, SourceQuote, TextButton } from '@/components/tender/parts';

/**
 * Step 1: what the tender asks for. The AI proposes each requirement with the tender's wording
 * beside it; a person approves, rewords, merges, splits or removes, and only approved ones go on.
 */

type Filter = 'all' | 'review' | 'approved' | 'removed' | 'out';

const PRIORITIES: { value: RequirementPriority; label: string }[] = [
  { value: 'must', label: 'Must have' },
  { value: 'should', label: 'Nice to have' }
];

/* memo: a click on one row re-renders that row, not all few hundred of them. Every prop is
   stable unless that requirement changed, which is why the row takes `docs` and not the tender. */
const RequirementRow = memo(function RequirementRow({
  req,
  docs,
  tenderId,
  picked,
  onPick,
  dispatch
}: {
  req: TenderRequirement;
  docs: TenderDocument[];
  tenderId: string;
  picked: boolean;
  onPick: (id: string, on: boolean) => void;
  dispatch: (action: Action) => void;
}): JSX.Element {
  const hover = useHover();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(req.text);
  const [section, setSection] = useState(req.section);
  const removed = req.status === 'removed';
  const approved = req.status === 'approved';

  const save = (): void => {
    if (text.trim()) dispatch({ type: 'editRequirement', id: tenderId, reqId: req.id, patch: { text: text.trim(), section: section.trim() } });
    setEditing(false);
  };
  const status = (next: TenderRequirement['status']): void => dispatch({ type: 'setRequirementStatus', id: tenderId, reqIds: [req.id], status: next });

  return (
    <div
      {...hover.bind}
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        background: removed ? color.surfaceSoft : color.surface,
        ...rowEdge(hover.on, approved ? color.brand : removed ? color.hairline : color.amberEdge),
        borderRadius: radius.md,
        padding: '12px 14px',
        transition: 'border-color 120ms ease'
      }}
    >
      <div style={{ paddingTop: 2 }}>
        <Check checked={picked} onChange={(on) => onPick(req.id, on)} label={`Select ${req.id}`} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Row gap={8}>
          <Mono size={11} tone={color.brandDeep}>
            {req.id}
          </Mono>
          <PriorityToggle value={req.priority} onChange={(priority) => dispatch({ type: 'editRequirement', id: tenderId, reqId: req.id, patch: { priority } })} />
          {req.outOfScope ? (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: color.muted, background: color.surfaceMuted, borderRadius: radius.pill, padding: '3px 10px' }}>
              Out of scope
            </span>
          ) : null}
          {req.section ? <span style={{ fontSize: 11.5, color: color.faint, overflowWrap: 'anywhere' }}>{req.section}</span> : null}
          {req.edited ? <span style={{ fontSize: 10.5, color: color.violet, fontWeight: 700 }}>edited</span> : null}
          <Spacer />
          {approved ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: color.brandInk }}>Approved</span>
          ) : removed ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: color.muted }}>Removed</span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, color: color.amberInk }}>To review</span>
          )}
        </Row>

        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <TextArea label="Requirement" value={text} onChange={setText} />
            <Field label="Section" value={section} onChange={setSection} onEnter={save} />
            <Row gap={8}>
              <Button size="sm" tone="primary" onClick={save}>
                Save
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setText(req.text);
                  setSection(req.section);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </Row>
          </div>
        ) : (
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              color: removed ? color.faint : color.ink,
              textDecoration: removed ? 'line-through' : 'none',
              marginTop: 6
            }}
          >
            {req.text}
          </div>
        )}

        <Row gap={14} style={{ marginTop: 6 }}>
          <SourceQuote source={sourceLabel(req, docs)} quote={req.quote} />
          <Spacer />
          {!editing ? (
            <TextButton
              onClick={() => {
                /* from the record, not from mount: a merge may have reworded it since */
                setText(req.text);
                setSection(req.section);
                setEditing(true);
              }}
            >
              Edit
            </TextButton>
          ) : null}
          <TextButton onClick={() => dispatch({ type: 'duplicateRequirement', id: tenderId, reqId: req.id })} title="Copy it, then reword each half">
            Split
          </TextButton>
          <TextButton onClick={() => dispatch({ type: 'editRequirement', id: tenderId, reqId: req.id, patch: { outOfScope: !req.outOfScope } })}>
            {req.outOfScope ? 'In scope' : 'Out of scope'}
          </TextButton>
          {removed ? (
            <TextButton onClick={() => status('proposed')}>Restore</TextButton>
          ) : (
            <>
              <TextButton onClick={() => status('removed')} tone={color.redInk}>
                Remove
              </TextButton>
              {approved ? (
                <TextButton onClick={() => status('proposed')}>Unapprove</TextButton>
              ) : (
                <Button size="sm" tone="brand" onClick={() => status('approved')} style={{ padding: '4px 12px' }}>
                  Approve
                </Button>
              )}
            </>
          )}
        </Row>
      </div>
    </div>
  );
});

export function RequirementsStep({
  tender,
  runner,
  dispatch,
  onContinue
}: {
  tender: Tender;
  runner: TenderRunner;
  dispatch: (action: Action) => void;
  onContinue: () => void;
}): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [newSection, setNewSection] = useState('');
  const [newPriority, setNewPriority] = useState<RequirementPriority>('must');

  const counts = tenderCounts(tender);
  const done = tender.ranges.filter((range) => range.status === 'done').length;
  const reading = counts.pendingRanges > 0;
  const filesGone = docRefs(tender) === null;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tender.reqs.filter((req) => {
      if (filter === 'review' && req.status !== 'proposed') return false;
      if (filter === 'approved' && req.status !== 'approved') return false;
      if (filter === 'removed' && req.status !== 'removed') return false;
      if (filter === 'out' && (!req.outOfScope || req.status === 'removed')) return false;
      if (!needle) return true;
      return `${req.id} ${req.ref ?? ''} ${req.text} ${req.section} ${req.quote}`.toLowerCase().includes(needle);
    });
  }, [tender.reqs, filter, query]);

  const pickedIds = tender.reqs.filter((req) => picked.has(req.id)).map((req) => req.id);
  const allShownPicked = rows.length > 0 && rows.every((req) => picked.has(req.id));
  const toReview = tender.reqs.filter((req) => req.status === 'proposed').map((req) => req.id);

  const pick = useCallback(
    (id: string, on: boolean): void =>
      setPicked((current) => {
        const next = new Set(current);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    []
  );
  const bulk = (status: TenderRequirement['status']): void => {
    dispatch({ type: 'setRequirementStatus', id: tender.id, reqIds: pickedIds, status });
    setPicked(new Set());
  };
  const add = (): void => {
    if (!newText.trim()) return;
    dispatch({ type: 'addRequirement', id: tender.id, input: { text: newText, section: newSection, priority: newPriority } });
    setNewText('');
    setNewSection('');
    setAdding(false);
  };

  const failed = tender.ranges.filter((range) => range.status === 'failed');
  const skipped = skippedSections(tender);
  /* running in any tab, not just this one: a claim is shared through storage */
  const active = tender.ranges.filter((range) => range.status === 'running' || runner.running.has(range.key));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {reading || failed.length > 0 ? (
        <div style={{ background: color.surface, border: `1px solid ${color.brandEdgeSoft}`, borderRadius: radius.lg, padding: '14px 18px' }}>
          <Row gap={10}>
            <span style={{ fontFamily: font.display, fontSize: 14.5, fontWeight: 600 }}>{reading ? 'Reading the tender' : 'Some parts could not be read'}</span>
            <span style={{ fontSize: 12, color: color.muted }}>
              {done} of {tender.ranges.length} parts done, {plural(counts.total, 'requirement')} so far
            </span>
          </Row>
          <div style={{ marginTop: 10 }}>
            <Progress value={done} total={tender.ranges.length} />
          </div>
          {active.length > 0 ? (
            <div style={{ fontSize: 11.5, color: color.faint, marginTop: 8 }}>Now reading: {active.map((range) => rangeLabel(range, tender.docs)).join('; ')}</div>
          ) : null}
          {failed.map((range) => (
            <Row key={range.key} gap={10} style={{ marginTop: 8, fontSize: 12.5 }}>
              <span style={{ fontWeight: 600, color: color.redInk }}>{rangeLabel(range, tender.docs)}</span>
              <span style={{ color: color.body, flex: '1 1 240px' }}>{range.error}</span>
              <Button size="sm" onClick={() => runner.retry(range.key)} disabled={filesGone}>
                Retry
              </Button>
            </Row>
          ))}
        </div>
      ) : null}

      {skipped.length > 0 ? (
        <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.6, border: `1px solid ${color.hairline}`, borderRadius: radius.md, padding: '10px 14px' }}>
          <span style={{ fontWeight: 600, color: color.body }}>Not read for requirements</span>, because they hold nothing to build, host, support or
          provide:
          {/* wrapped rather than a row each, so a long tender's list does not push the requirements down the page */}
          <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 22, rowGap: 4, marginTop: 6 }}>
            {skipped.map(({ index, section }) => (
              <span key={index} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <span style={{ color: color.body, overflowWrap: 'anywhere' }}>
                  {section.title}{' '}
                  <Mono size={11} tone={color.faint}>
                    {tender.docs.length > 1 ? `${tender.docs.find((doc) => doc.n === section.doc)?.name ?? ''}, ` : ''}
                    {sectionPages(section, tender.docs)}
                  </Mono>
                </span>
                {!filesGone ? (
                  <TextButton onClick={() => dispatch({ type: 'readSection', id: tender.id, index })} title={`Read ${section.title} for requirements too`}>
                    Read it too
                  </TextButton>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {filesGone && (reading || failed.length > 0) ? (
        <Banner tone="warn">
          The tender files are no longer at Anthropic (removed, or past their 72 hours), so the remaining parts cannot be read. Add what is
          missing by hand, or start again from the tender.
        </Banner>
      ) : null}

      <Row gap={8} style={{ paddingBottom: 10, borderBottom: `1px solid ${color.hairline}` }}>
        {(
          [
            ['all', `All ${counts.total}`],
            ['review', `To review ${counts.proposed}`],
            ['approved', `Approved ${counts.approved}`],
            ['out', 'Out of scope'],
            ['removed', `Removed ${counts.removed}`]
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <FilterPill key={key} on={filter === key} onClick={() => setFilter(key)}>
            {label}
          </FilterPill>
        ))}
        <Spacer />
        <SearchInput value={query} onChange={setQuery} placeholder="Find a requirement…" style={{ flex: '0 1 240px', minWidth: 150, padding: '8px 14px', fontSize: 12.5 }} />
        <Button size="sm" onClick={() => setAdding((value) => !value)}>
          {adding ? 'Close' : '+ Add requirement'}
        </Button>
      </Row>

      {adding ? (
        <div style={{ background: color.surface, border: `1px solid ${color.brandEdge}`, borderRadius: radius.lg, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <TextArea label="Requirement" value={newText} onChange={setNewText} placeholder="What must be delivered, in one statement" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <Field label="Section" value={newSection} onChange={setNewSection} placeholder="Optional" onEnter={add} />
            <Select label="Priority" value={newPriority} options={PRIORITIES} onChange={setNewPriority} />
          </div>
          <Row gap={8}>
            <Button tone="primary" size="sm" onClick={add} disabled={!newText.trim()}>
              Add it, approved
            </Button>
            <Button size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </Row>
        </div>
      ) : null}

      <Row gap={10}>
        <Check
          checked={allShownPicked}
          onChange={(on) => setPicked(on ? new Set([...picked, ...rows.map((req) => req.id)]) : new Set())}
          label="Select every requirement shown"
        />
        <span style={{ fontSize: 12, color: color.muted }}>{pickedIds.length > 0 ? `${pickedIds.length} selected` : 'Select to act on several at once'}</span>
        {pickedIds.length > 0 ? (
          <>
            <Button size="sm" tone="brand" onClick={() => bulk('approved')}>
              Approve
            </Button>
            <Button size="sm" tone="danger" onClick={() => bulk('removed')}>
              Remove
            </Button>
            <Button size="sm" onClick={() => bulk('proposed')}>
              Back to review
            </Button>
            <Button
              size="sm"
              disabled={pickedIds.length < 2}
              title="Combine into the first one selected"
              onClick={() => {
                dispatch({ type: 'combineRequirements', id: tender.id, reqIds: pickedIds });
                setPicked(new Set());
              }}
            >
              Merge
            </Button>
          </>
        ) : null}
      </Row>

      {rows.length === 0 ? (
        <Empty
          title={tender.reqs.length === 0 ? (reading ? 'Nothing found yet' : 'No requirements found') : 'Nothing matches that'}
          body={
            tender.reqs.length === 0
              ? reading
                ? 'Requirements appear here as each part of the tender is read.'
                : 'The AI found no requirements in these documents. Add them by hand with + Add requirement.'
              : 'Clear the search or pick a different filter.'
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((req) => (
            <RequirementRow key={req.id} req={req} docs={tender.docs} tenderId={tender.id} picked={picked.has(req.id)} onPick={pick} dispatch={dispatch} />
          ))}
        </div>
      )}

      {/* right-aligned: the sync pill is fixed to the bottom-left corner and would cover the count */}
      <Row
        gap={10}
        style={{
          position: 'sticky',
          bottom: 0,
          justifyContent: 'flex-end',
          background: color.page,
          borderTop: `1px solid ${color.hairline}`,
          padding: '12px 0',
          marginTop: 4
        }}
      >
        <span style={{ fontSize: 12.5, color: color.body }}>
          <strong>{counts.approved}</strong> approved, <strong>{counts.proposed}</strong> to review
        </span>
        {toReview.length > 0 ? (
          <Button onClick={() => dispatch({ type: 'setRequirementStatus', id: tender.id, reqIds: toReview, status: 'approved' })}>
            Approve all {toReview.length} to review
          </Button>
        ) : null}
        <Button
          tone="primary"
          onClick={onContinue}
          disabled={counts.approved === 0 || reading}
          title={reading ? 'Wait until every part has been read' : counts.approved === 0 ? 'Approve at least one requirement' : undefined}
        >
          Continue to matching ›
        </Button>
      </Row>
    </div>
  );
}
