import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { Catalog, MatchKind, RequirementMatch, Solution, Tender, TenderDocument, TenderRequirement } from '@/types';
import type { Action } from '@/state/reducer';
import type { TenderRunner } from '@/state/useTenderRunner';
import { catalogHours, needsMatching, outOfScopeMatches, sourceLabel, tenderCounts, tenderSelection } from '@/domain/tender';
import { allSolutions } from '@/domain/catalog';
import { hours, plural } from '@/lib/format';
import { color, radius } from '@/theme';
import { Banner, Button, Empty, Mono, Row, Select, Spacer, Stat } from '@/components/ui';
import { useHover } from '@/lib/useHover';
import { Check, ConfidenceChip, DeferredField, FilterPill, KIND_LABEL, PriorityToggle, rowEdge, SourceQuote, TextButton } from '@/components/tender/parts';
import { categoryOptions } from '@/components/salesLegal/parts';

/**
 * Step 2: how the catalog covers each approved requirement. The AI proposes a kind and the
 * solutions; the hours beside them are the catalog's own, looked up by id. A person accepts,
 * changes or rejects each match, and only accepted ones reach the estimation.
 */

type Filter = 'all' | 'review' | MatchKind;

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as MatchKind[]).map((value) => ({ value, label: KIND_LABEL[value] }));

/* memo: accepting one match re-renders that row, not the whole list; hence `docs`, not the tender */
const MatchRow = memo(function MatchRow({
  req,
  docs,
  tenderId,
  byId,
  solutionOptions,
  matching,
  picked,
  onPick,
  dispatch
}: {
  req: TenderRequirement;
  docs: TenderDocument[];
  tenderId: string;
  byId: ReadonlyMap<string, Solution>;
  solutionOptions: { value: string; label: string }[];
  matching: boolean;
  picked: boolean;
  onPick: (id: string, on: boolean) => void;
  dispatch: (action: Action) => void;
}): JSX.Element {
  const hover = useHover();
  const match = req.match;
  const set = (patch: Partial<RequirementMatch>): void => dispatch({ type: 'editMatch', id: tenderId, reqId: req.id, patch });
  const covered = match && (match.kind === 'catalog' || match.kind === 'partial');

  return (
    <div
      {...hover.bind}
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        background: color.surface,
        ...rowEdge(hover.on, match?.approved ? color.brand : color.amberEdge),
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
          <PriorityToggle value={req.priority} />
          <Spacer />
          {match ? (
            match.approved ? (
              <>
                <span style={{ fontSize: 11, fontWeight: 700, color: color.brandInk }}>Accepted</span>
                <TextButton onClick={() => dispatch({ type: 'approveMatches', id: tenderId, reqIds: [req.id], approved: false })}>Undo</TextButton>
              </>
            ) : (
              <Button size="sm" tone="brand" onClick={() => dispatch({ type: 'approveMatches', id: tenderId, reqIds: [req.id], approved: true })} style={{ padding: '4px 12px' }}>
                Accept
              </Button>
            )
          ) : null}
        </Row>

        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: color.ink, marginTop: 6 }}>{req.text}</div>

        {match ? (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row gap={8}>
              <Select value={match.kind} options={KIND_OPTIONS} onChange={(kind) => set({ kind })} hint="How the catalog covers it" style={{ padding: '6px 8px', fontSize: 12.5 }} />
              {/* not Edly's software work, but someone's: it goes on the Sales, account and legal list */}
              {match.kind === 'out' ? (
                <Select
                  value={match.category ?? ''}
                  options={categoryOptions(match.category ?? '')}
                  onChange={(category) => category && set({ category })}
                  hint="Which team needs to know. It goes on the Sales, account and legal list"
                  style={{ padding: '6px 8px', fontSize: 12.5 }}
                />
              ) : null}
              {match.edited ? <span style={{ fontSize: 10.5, color: color.violet, fontWeight: 700 }}>changed by you</span> : <ConfidenceChip value={match.confidence} />}
              {match.kind === 'out' ? <span style={{ fontSize: 11.5, color: color.muted }}>for the Sales, account and legal list</span> : null}
            </Row>

            {covered ? (
              <Row gap={6}>
                {match.solutionIds.map((id) => {
                  const item = byId.get(id);
                  return (
                    <span
                      key={id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        background: color.brandWashPale,
                        border: `1px solid ${color.brandEdgeFaint}`,
                        borderRadius: radius.pill,
                        padding: '4px 6px 4px 12px',
                        fontSize: 12
                      }}
                    >
                      <span style={{ color: color.ink, fontWeight: 600 }}>{item?.name ?? id}</span>
                      <Mono size={11} tone={color.brandDeep}>
                        {item ? `${hours(item.first)} h` : 'not in the catalog'}
                      </Mono>
                      <TextButton onClick={() => set({ solutionIds: match.solutionIds.filter((one) => one !== id) })} title={`Remove ${item?.name ?? id}`}>
                        ×
                      </TextButton>
                    </span>
                  );
                })}
                <Select
                  value=""
                  options={solutionOptions}
                  onChange={(id) => id && !match.solutionIds.includes(id) && set({ solutionIds: [...match.solutionIds, id] })}
                  hint="Add a catalog solution"
                  style={{ padding: '6px 8px', fontSize: 12.5, maxWidth: 320 }}
                />
                {match.solutionIds.length === 0 ? <span style={{ fontSize: 12, color: color.redInk }}>Pick a solution, or change this to custom.</span> : null}
              </Row>
            ) : null}

            {match.kind === 'partial' ? (
              <DeferredField label="Left for the estimation desk" value={match.remainder} onCommit={(remainder) => set({ remainder })} placeholder="What the catalog does not cover" />
            ) : null}

            {match.reason ? <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.5 }}>{match.reason}</div> : null}
          </div>
        ) : (
          <Row gap={10} style={{ marginTop: 8 }}>
            <span style={{ fontSize: 12, color: color.amberInk, fontWeight: 600 }}>{matching ? 'Matching against the catalog…' : 'Not matched yet'}</span>
            <Select
              value=""
              options={[{ value: '', label: 'Set it by hand…' }, ...KIND_OPTIONS]}
              onChange={(kind) => kind && set({ kind: kind as MatchKind })}
              style={{ padding: '6px 8px', fontSize: 12.5 }}
            />
          </Row>
        )}

        <div style={{ marginTop: 6 }}>
          <SourceQuote source={sourceLabel(req, docs)} quote={req.quote} />
        </div>
      </div>
    </div>
  );
});

export function MatchStep({
  tender,
  runner,
  catalog,
  dispatch,
  onContinue
}: {
  tender: Tender;
  runner: TenderRunner;
  catalog: Catalog;
  dispatch: (action: Action) => void;
  onContinue: () => void;
}): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /* runs once on arrival, then only when asked: an automatic retry would loop on a failure */
  const [runNow, setRunNow] = useState(() => needsMatching(tender).length > 0 || Object.keys(outOfScopeMatches(tender)).length > 0);

  useEffect(() => {
    if (!runNow || runner.matching) return;
    setRunNow(false);
    runner.runMatching();
  }, [runNow, runner]);

  const byId = useMemo(() => new Map(allSolutions(catalog).map((item) => [item.id, item] as const)), [catalog]);
  const solutionOptions = useMemo(
    () => [
      { value: '', label: 'Add a catalog solution…' },
      ...catalog.bundles.flatMap((bundle) => bundle.items.map((item) => ({ value: item.id, label: `${bundle.name} / ${item.name} (${hours(item.first)} h)` })))
    ],
    [catalog]
  );

  const counts = tenderCounts(tender);
  const approved = tender.reqs.filter((req) => req.status === 'approved');
  const unmatched = approved.filter((req) => !req.match).length;
  const accepted = catalogHours(tenderSelection(tender, new Set(byId.keys())), catalog);

  const rows = approved.filter((req) => {
    if (filter === 'all') return true;
    if (filter === 'review') return !req.match?.approved;
    return req.match?.kind === filter;
  });
  const pickedIds = approved.filter((req) => picked.has(req.id)).map((req) => req.id);
  const allShownPicked = rows.length > 0 && rows.every((req) => picked.has(req.id));
  const sureOnes = approved.filter((req) => req.match && !req.match.approved && req.match.confidence === 'high').map((req) => req.id);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        <Stat value={String(counts.catalog)} label="in the catalog" tone={color.brandDeep} />
        <Stat value={String(counts.partial)} label="partly covered" tone={color.violet} />
        <Stat value={String(counts.custom)} label="custom, to the desk" tone={counts.custom > 0 ? color.amber : color.quiet} />
        <Stat value={String(counts.out)} label="out of scope" tone={color.muted} />
        <Stat value={`${counts.reviewed} / ${counts.approved}`} label="accepted" />
        <Stat value={hours(accepted.first)} label={accepted.unpriced > 0 ? `catalog hours, ${accepted.unpriced} unpriced` : 'catalog hours accepted'} tone={color.brandDeep} />
      </div>

      {runner.matchError ? <Banner tone="bad">{runner.matchError}</Banner> : null}
      {/* at the limit the question above says what is waiting; a second button here would only ask again */}
      {unmatched > 0 && !runner.matching && !runner.held ? (
        <Banner tone="warn">
          <Row gap={10}>
            <span>{plural(unmatched, 'approved requirement')} not matched yet.</span>
            <Button size="sm" onClick={() => setRunNow(true)}>
              Match {unmatched === 1 ? 'it' : 'them'} now
            </Button>
          </Row>
        </Banner>
      ) : null}
      {runner.matching ? <Banner tone="good">Matching against the catalog. Results appear on each requirement as they come back.</Banner> : null}

      <Row gap={8} style={{ paddingBottom: 10, borderBottom: `1px solid ${color.hairline}` }}>
        {(
          [
            ['all', `All ${approved.length}`],
            ['review', `To accept ${approved.length - counts.reviewed}`],
            ['catalog', 'Catalog'],
            ['partial', 'Partial'],
            ['custom', 'Custom'],
            ['out', 'Out of scope']
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <FilterPill key={key} on={filter === key} onClick={() => setFilter(key)}>
            {label}
          </FilterPill>
        ))}
      </Row>

      <Row gap={10}>
        <Check
          checked={allShownPicked}
          onChange={(on) => setPicked(on ? new Set([...picked, ...rows.map((req) => req.id)]) : new Set())}
          label="Select every requirement shown"
        />
        <span style={{ fontSize: 12, color: color.muted }}>{pickedIds.length > 0 ? `${pickedIds.length} selected` : 'Select to act on several at once'}</span>
        {pickedIds.length > 0 ? (
          <>
            <Button
              size="sm"
              tone="brand"
              onClick={() => {
                dispatch({ type: 'approveMatches', id: tender.id, reqIds: pickedIds, approved: true });
                setPicked(new Set());
              }}
            >
              Accept
            </Button>
            <Button
              size="sm"
              onClick={() => {
                dispatch({ type: 'approveMatches', id: tender.id, reqIds: pickedIds, approved: false });
                setPicked(new Set());
              }}
            >
              Undo accept
            </Button>
            <Button
              size="sm"
              title="Ask the AI to match these again"
              disabled={runner.matching}
              onClick={() => {
                dispatch({ type: 'clearMatches', id: tender.id, reqIds: pickedIds });
                setPicked(new Set());
                setRunNow(true);
              }}
            >
              Match again
            </Button>
          </>
        ) : null}
        <Spacer />
        {sureOnes.length > 0 ? (
          <Button size="sm" onClick={() => dispatch({ type: 'approveMatches', id: tender.id, reqIds: sureOnes, approved: true })}>
            Accept all {sureOnes.length} high-confidence
          </Button>
        ) : null}
      </Row>

      {rows.length === 0 ? (
        <Empty title="Nothing here" body={approved.length === 0 ? 'Approve requirements in step 1 first.' : 'Pick a different filter.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((req) => (
            <MatchRow
              key={req.id}
              req={req}
              docs={tender.docs}
              tenderId={tender.id}
              byId={byId}
              solutionOptions={solutionOptions}
              matching={runner.matching}
              picked={picked.has(req.id)}
              onPick={pick}
              dispatch={dispatch}
            />
          ))}
        </div>
      )}

      {/* right-aligned: the sync pill is fixed to the bottom-left corner and would cover the count */}
      <Row gap={10} style={{ position: 'sticky', bottom: 0, justifyContent: 'flex-end', background: color.page, borderTop: `1px solid ${color.hairline}`, padding: '12px 0', marginTop: 4 }}>
        <span style={{ fontSize: 12.5, color: color.body }}>
          <strong>{counts.reviewed}</strong> of {counts.approved} accepted. Only accepted matches reach the estimation and the desk.
        </span>
        <Button tone="primary" onClick={onContinue} disabled={counts.reviewed === 0} title={counts.reviewed === 0 ? 'Accept at least one match' : undefined}>
          Continue to apply ›
        </Button>
      </Row>
    </div>
  );
}
