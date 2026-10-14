import { memo, useCallback, useMemo, useState } from 'react';
import type { RequirementPriority, Tender, TenderDocument, TenderRequirement } from '@/types';
import type { Action } from '@/state/reducer';
import { docRefs, type TenderRunner } from '@/state/useTenderRunner';
import { byTopic, extracting, groupingWanted, idList, rangeLabel, repeatSets, sectionPages, skippedSections, sourceLabel, tenderCounts, ungrouped } from '@/domain/tender';
import { plural } from '@/lib/format';
import { color, font, radius } from '@/theme';
import { Banner, Button, Empty, Field, Mono, Row, SearchInput, Select, Spacer, TextArea } from '@/components/ui';
import { useHover } from '@/lib/useHover';
import { Check, FilterPill, PriorityToggle, Progress, RequirementBody, rowEdge, SourceQuote, TextButton, TopicChip } from '@/components/tender/parts';
import { RepeatCompare } from '@/components/tender/RepeatCompare';

/**
 * Step 1: what the tender asks for. The AI proposes each requirement with the tender's wording
 * beside it; a person approves, rewords, merges, splits or removes, and only approved ones go on.
 * Once the tender is read, a grouping call puts each under a topic and sets side by side the ones
 * that ask for the same work, for a person to keep one of.
 */

type Filter = 'all' | 'review' | 'approved' | 'removed' | 'out' | 'repeats';
type View = 'order' | 'topic';

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
  showTopic,
  repeats,
  onCompare,
  onFind,
  dispatch
}: {
  req: TenderRequirement;
  docs: TenderDocument[];
  tenderId: string;
  picked: boolean;
  onPick: (id: string, on: boolean) => void;
  /** Off in the "By topic" view, where the heading above says it. */
  showTopic: boolean;
  /** The other requirements in its open set of repeats, as "R-53 and R-104", or ''. A string, so the memo holds. */
  repeats: string;
  onCompare: (set: string) => void;
  /** Show one requirement by its id: the one this was removed as a repeat of. */
  onFind: (id: string) => void;
  dispatch: (action: Action) => void;
}): JSX.Element {
  const hover = useHover();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(req.title ?? '');
  const [text, setText] = useState(req.text);
  const [context, setContext] = useState(req.context ?? '');
  const [section, setSection] = useState(req.section);
  const removed = req.status === 'removed';
  const approved = req.status === 'approved';

  const save = (): void => {
    if (text.trim()) {
      dispatch({ type: 'editRequirement', id: tenderId, reqId: req.id, patch: { title: title.trim(), text: text.trim(), context: context.trim(), section: section.trim() } });
    }
    setEditing(false);
  };
  const reset = (): void => {
    setTitle(req.title ?? '');
    setText(req.text);
    setContext(req.context ?? '');
    setSection(req.section);
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
          {showTopic && req.topic ? <TopicChip topic={req.topic} /> : null}
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
            <Field label="Title" value={title} onChange={setTitle} placeholder="A short name, as a bid team would head it" onEnter={save} />
            <TextArea label="Requirement" value={text} onChange={setText} />
            <TextArea label="Elsewhere in the tender" value={context} onChange={setContext} placeholder="Where else the tender asks for it, or what it depends on. Optional" />
            <Field label="Section" value={section} onChange={setSection} onEnter={save} />
            <Row gap={8}>
              <Button size="sm" tone="primary" onClick={save}>
                Save
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  reset();
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </Row>
          </div>
        ) : (
          <RequirementBody req={req} struck={removed} />
        )}

        {repeats && req.repeat && !removed ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              gap: '4px 12px',
              marginTop: 8,
              padding: '8px 12px',
              borderRadius: radius.md,
              background: color.amberWash,
              borderLeft: `3px solid ${color.amberEdge}`,
              fontSize: 12.5,
              lineHeight: 1.55,
              color: color.amberInk
            }}
          >
            <span style={{ flex: '1 1 320px', minWidth: 0 }}>
              <strong>Asks for the same work as {repeats}.</strong> {req.repeat.note}
            </span>
            <TextButton onClick={() => onCompare(req.repeat?.set ?? '')} tone={color.amberInk} title="See them side by side and choose what to keep">
              Compare and choose
            </TextButton>
          </div>
        ) : null}
        {removed && req.repeatOf && req.repeatOf.length > 0 ? (
          <div style={{ fontSize: 12, color: color.muted, marginTop: 6, lineHeight: 1.6 }}>
            Removed as a repeat of{' '}
            {req.repeatOf.map((id, index, ids) => (
              <span key={id}>
                <TextButton onClick={() => onFind(id)} tone={color.brandDeep} title={`Show ${id}`}>
                  {id}
                </TextButton>
                {index < ids.length - 2 ? ', ' : index === ids.length - 2 ? ' and ' : '. '}
              </span>
            ))}
            Restore it to count it on its own again.
          </div>
        ) : null}

        <Row gap={14} style={{ marginTop: 6 }}>
          <SourceQuote source={sourceLabel(req, docs)} quote={req.quote} />
          <Spacer />
          {!editing ? (
            <TextButton
              onClick={() => {
                /* from the record, not from mount: a merge may have reworded it since */
                reset();
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
  const [view, setView] = useState<View>('order');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [comparing, setComparing] = useState('');
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newText, setNewText] = useState('');
  const [newSection, setNewSection] = useState('');
  const [newPriority, setNewPriority] = useState<RequirementPriority>('must');

  const counts = tenderCounts(tender);
  const done = tender.ranges.filter((range) => range.status === 'done').length;
  const reading = counts.pendingRanges > 0;
  const filesGone = docRefs(tender) === null;

  const sets = useMemo(() => repeatSets(tender), [tender]);
  /* each requirement in an open set, with the others in it, as the row shows them */
  const repeatsOf = useMemo(() => {
    const others = new Map<string, string>();
    for (const entry of sets) for (const req of entry.reqs) others.set(req.id, idList(entry.reqs.filter((one) => one.id !== req.id).map((one) => one.id)));
    return others;
  }, [sets]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tender.reqs.filter((req) => {
      if (filter === 'review' && req.status !== 'proposed') return false;
      if (filter === 'approved' && req.status !== 'approved') return false;
      if (filter === 'removed' && req.status !== 'removed') return false;
      if (filter === 'out' && (!req.outOfScope || req.status === 'removed')) return false;
      if (filter === 'repeats' && !repeatsOf.has(req.id)) return false;
      if (!needle) return true;
      return [req.id, req.ref, req.title, req.text, req.context, req.topic, req.section, req.quote].join(' ').toLowerCase().includes(needle);
    });
  }, [tender.reqs, filter, query, repeatsOf]);
  /* in the Repeats filter, a set's members sit together, the way they are compared */
  const shown = useMemo(() => {
    if (filter !== 'repeats') return rows;
    const order = new Map(sets.flatMap((entry, index) => entry.reqs.map((req) => [req.id, index] as const)));
    return [...rows].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [rows, filter, sets]);
  const topics = useMemo(() => byTopic(shown), [shown]);
  const hasTopics = tender.reqs.some((req) => req.topic);
  const comparedSet = sets.find((entry) => entry.set === comparing) ?? null;
  const onCompare = useCallback((set: string) => setComparing(set), []);
  const onFind = useCallback((id: string) => {
    setFilter('all');
    setQuery(id);
  }, []);
  const waiting = ungrouped(tender).length;

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
    dispatch({ type: 'addRequirement', id: tender.id, input: { title: newTitle, text: newText, section: newSection, priority: newPriority } });
    setNewTitle('');
    setNewText('');
    setNewSection('');
    setAdding(false);
  };
  const row = (req: TenderRequirement, showTopic: boolean): JSX.Element => (
    <RequirementRow
      key={req.id}
      req={req}
      docs={tender.docs}
      tenderId={tender.id}
      picked={picked.has(req.id)}
      onPick={pick}
      showTopic={showTopic}
      repeats={repeatsOf.get(req.id) ?? ''}
      onCompare={onCompare}
      onFind={onFind}
      dispatch={dispatch}
    />
  );

  const failed = tender.ranges.filter((range) => range.status === 'failed');
  const skipped = skippedSections(tender);
  /* running in any tab, not just this one: a claim is shared through storage */
  const active = runner.reading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {reading || failed.length > 0 ? (
        <div style={{ background: color.surface, border: `1px solid ${color.brandEdgeSoft}`, borderRadius: radius.lg, padding: '14px 18px' }}>
          <Row gap={10}>
            <span style={{ fontFamily: font.display, fontSize: 14.5, fontWeight: 600 }}>{reading ? (runner.held && active.length === 0 ? 'Paused at the AI limit' : 'Reading the tender') : 'Some parts could not be read'}</span>
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

      {runner.grouping ? (
        <Banner tone="good">Checking every requirement against the rest of the tender for repeats, and putting each under a topic.</Banner>
      ) : runner.groupError ? (
        <Banner tone="bad">
          <Row gap={10}>
            <span style={{ flex: '1 1 320px' }}>{runner.groupError}</span>
            <Button size="sm" onClick={runner.runGrouping}>
              Try again
            </Button>
          </Row>
        </Banner>
      ) : !extracting(tender) && groupingWanted(tender) && !runner.held ? (
        <Row gap={10} style={{ fontSize: 12.5, color: color.body, border: `1px solid ${color.hairline}`, borderRadius: radius.md, padding: '10px 14px' }}>
          <span style={{ flex: '1 1 320px', lineHeight: 1.55 }}>
            {waiting === counts.total - counts.removed
              ? 'These requirements have not been checked for repeats or grouped by topic. The tender may ask for the same work in more than one place.'
              : `${plural(waiting, 'requirement')} ${waiting === 1 ? 'has' : 'have'} not been checked against the rest for repeats yet.`}{' '}
            It reads only the requirements, not the documents, so it costs cents.
          </span>
          <Button size="sm" tone="brand" onClick={runner.runGrouping}>
            Find repeats and topics
          </Button>
        </Row>
      ) : null}

      {sets.length > 0 && filter !== 'repeats' ? (
        <Banner tone="warn">
          <Row gap={10}>
            <span style={{ flex: '1 1 320px', lineHeight: 1.55 }}>
              The tender asks for the same work in more than one place: {plural(sets.length, 'set')} of repeats. Keep one of each, so the work is
              not estimated twice.
            </span>
            <Button size="sm" onClick={() => setFilter('repeats')}>
              Show them
            </Button>
          </Row>
        </Banner>
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
            ['removed', `Removed ${counts.removed}`],
            /* only while there is something to settle, or the person is looking at them */
            ...(sets.length > 0 || filter === 'repeats' ? [['repeats', `Repeats ${repeatsOf.size}`]] : [])
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
          <Field label="Title" value={newTitle} onChange={setNewTitle} placeholder="A short name, as a bid team would head it. Optional" />
          <TextArea label="Requirement" value={newText} onChange={setNewText} placeholder="What must be delivered, who uses it, and what the tender says about it" />
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
        <Spacer />
        {/* only once something has a topic: before the grouping call there is one order to show */}
        {hasTopics ? (
          <div role="group" aria-label="Order the list" style={{ display: 'inline-flex', gap: 6 }}>
            <FilterPill on={view === 'order'} onClick={() => setView('order')}>
              Tender order
            </FilterPill>
            <FilterPill on={view === 'topic'} onClick={() => setView('topic')}>
              By topic
            </FilterPill>
          </div>
        ) : null}
      </Row>

      {shown.length === 0 ? (
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
      ) : view === 'topic' && hasTopics ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {topics.map((group) => (
            <section key={group.topic} aria-label={group.topic} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Row gap={10} style={{ paddingBottom: 4, borderBottom: `1px solid ${color.hairline}` }}>
                <span style={{ fontFamily: font.display, fontSize: 14.5, fontWeight: 600, color: color.ink }}>{group.topic}</span>
                <span style={{ fontSize: 12, color: color.muted }}>{plural(group.reqs.length, 'requirement')}</span>
              </Row>
              {group.reqs.map((req) => row(req, false))}
            </section>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{shown.map((req) => row(req, true))}</div>
      )}

      {comparedSet ? <RepeatCompare tenderId={tender.id} entry={comparedSet} docs={tender.docs} dispatch={dispatch} onClose={() => setComparing('')} /> : null}

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
