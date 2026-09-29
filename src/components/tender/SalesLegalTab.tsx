import { useState } from 'react';
import type { SalesLegalCategory, SalesLegalItem, Tender } from '@/types';
import type { Action, AppState } from '@/state/reducer';
import type { RouterApi } from '@/state/useRouting';
import type { TenderRunner } from '@/state/useTenderRunner';
import { byCategory, categoryLabel, copiedItems, goesWithEstimation, needsSorting, salesLegalDrafts, SALES_LEGAL_CATEGORIES, topicLabel, type SalesLegalDraft } from '@/domain/salesLegal';
import { heldDocs, outOfScopeMatches } from '@/domain/tender';
import { plural } from '@/lib/format';
import { useHover } from '@/lib/useHover';
import { color, radius } from '@/theme';
import { Banner, Button, Chip, Empty, Mono, Row, Select, Spacer, Stat } from '@/components/ui';
import { Check, ConfidenceChip, FilterPill, PriorityToggle, rowEdge, SourceQuote, TextButton } from '@/components/tender/parts';
import { categoryOptions, GroupHeading, keepAction, StatusChip } from '@/components/salesLegal/parts';

/**
 * Sales, account and legal: a tab beside the three steps, not a step. It blocks nothing.
 *
 * It lists what the tender commits Edly to that is not software: the requirements matched as out of
 * scope, and the key legal and commercial terms when a person asked for them. Here a person sorts
 * them into teams, accepts them, leaves them out or turns one into custom work for the desk. When the
 * estimation is created the accepted ones are copied to it, and from then on the estimation's list
 * is the record: this tab shows where each one stands there.
 */

type Filter = 'all' | 'accept' | 'left';

function DraftRow({
  draft,
  item,
  onCategory,
  onKeep,
  onAccept,
  onCustom
}: {
  draft: SalesLegalDraft;
  /** The estimation's copy, once there is one. */
  item: SalesLegalItem | undefined;
  onCategory: (category: SalesLegalCategory) => void;
  onKeep: (keep: boolean) => void;
  onAccept: (accept: boolean) => void;
  onCustom: () => void;
}): JSX.Element {
  const hover = useHover();
  const accent = item ? color.brand : draft.skip ? color.hairline : draft.accepted ? color.brand : color.amberEdge;
  return (
    <div
      {...hover.bind}
      style={{ background: draft.skip && !item ? color.surfaceSoft : color.surface, ...rowEdge(hover.on, accent), borderRadius: radius.md, padding: '12px 14px', transition: 'border-color 120ms ease' }}
    >
      <Row gap={8}>
        <Mono size={11} tone={color.brandDeep}>
          {draft.key}
        </Mono>
        <PriorityToggle value={draft.priority} />
        {draft.topic ? <Chip>{topicLabel(draft.topic)}</Chip> : null}
        {draft.confidence && !item ? <ConfidenceChip value={draft.confidence} /> : null}
        <Spacer />
        {item ? (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, color: color.brandInk }}>On the estimation</span>
            <StatusChip status={item.status} />
            <span style={{ fontSize: 11.5, color: color.muted }}>{item.owner || 'No owner yet'}</span>
          </>
        ) : draft.kind === 'term' ? null : draft.accepted ? (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, color: color.brandInk }}>Accepted</span>
            <TextButton onClick={() => onAccept(false)}>Undo</TextButton>
          </>
        ) : (
          <Button size="sm" tone="brand" onClick={() => onAccept(true)} style={{ padding: '4px 12px' }}>
            Accept
          </Button>
        )}
      </Row>

      <div style={{ fontSize: 13.5, lineHeight: 1.55, color: draft.skip && !item ? color.muted : color.ink, marginTop: 6 }}>{draft.text}</div>
      {draft.reason ? <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.5, marginTop: 4 }}>{draft.reason}</div> : null}

      {item ? null : (
        <Row gap={12} style={{ marginTop: 10 }}>
          <Select
            value={draft.category}
            options={categoryOptions(draft.category)}
            onChange={(category) => category && onCategory(category)}
            hint="Which team needs to know"
            style={{ padding: '6px 8px', fontSize: 12.5 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: color.body, cursor: 'pointer' }}>
            <Check checked={!draft.skip} onChange={onKeep} label={`Keep ${draft.key} for the estimation`} />
            {draft.skip ? 'Left out' : 'Keep for the estimation'}
          </label>
          {draft.kind === 'obligation' ? (
            <TextButton onClick={onCustom} title="It is work Edly would price after all: send it to the estimation desk">
              Make it custom work
            </TextButton>
          ) : null}
        </Row>
      )}

      <div style={{ marginTop: 6 }}>
        <SourceQuote source={[draft.source, draft.section ? `under ${draft.section}` : ''].filter(Boolean).join(', ')} quote={draft.quote} />
      </div>
    </div>
  );
}

export function SalesLegalTab({
  tender,
  state,
  runner,
  dispatch,
  router
}: {
  tender: Tender;
  state: AppState;
  runner: TenderRunner;
  dispatch: (action: Action) => void;
  router: RouterApi;
}): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [notice, setNotice] = useState('');

  const estimation = state.estimations.find((one) => one.id === tender.estId) ?? null;
  const copied = copiedItems(state.salesLegal, tender.id);
  const drafts = salesLegalDrafts(tender, copied);
  const items = new Map(state.salesLegal.filter((one) => one.tender === tender.id).map((one) => [one.tenderItem, one] as const));
  const unaccepted = drafts.filter((draft) => !draft.accepted && !draft.copied);
  const leftOut = drafts.filter((draft) => draft.skip && !draft.copied);
  const unsorted = drafts.filter((draft) => !draft.category && !draft.copied);
  /* what Sort them would send: items still on the tender, and ones copied to the estimation with no team */
  const sortable = needsSorting(tender, state.salesLegal, 'unsorted').length;
  const waiting = drafts.filter(goesWithEstimation);
  const notMatched = Object.keys(outOfScopeMatches(tender)).length;
  /* read as out of scope but not approved yet: only approved requirements go anywhere, these included */
  const toReview = tender.reqs.filter((req) => req.status === 'proposed' && req.outOfScope).length;
  const held = heldDocs(tender.docs, Date.now());
  const failedReads = (tender.termReads ?? []).filter((read) => read.status === 'failed');

  const shown = drafts.filter((draft) => (filter === 'accept' ? !draft.accepted && !draft.copied : filter === 'left' ? draft.skip && !draft.copied : true));
  /* a copied item's team is the estimation's now; the tender's may be older */
  const grouped = byCategory(shown.map((draft) => ({ ...draft, category: items.get(draft.key)?.category ?? draft.category })));

  const keep = (draft: SalesLegalDraft, on: boolean): void => dispatch(keepAction(tender.id, draft, on));
  const setCategory = (draft: SalesLegalDraft, category: SalesLegalCategory): void => {
    if (draft.kind === 'term') dispatch({ type: 'editTerm', id: tender.id, termId: draft.key, patch: { category } });
    else dispatch({ type: 'editMatch', id: tender.id, reqId: draft.key, patch: { category } });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ fontSize: 13, color: color.body, lineHeight: 1.6, margin: 0, maxWidth: 860 }}>
        What this tender commits Edly to that is not software: reports, fees, certifications, staffing rules and contract terms. None of it is priced and none of
        it reaches the client. The accepted ones go with the estimation when it is created, for the sales, account and legal teams to own there.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        <Stat value={String(drafts.length)} label={drafts.length === 1 ? 'item' : 'items'} />
        <Stat value={String(waiting.length)} label={estimation ? 'not on the estimation yet' : 'go with the estimation'} tone={color.brandDeep} />
        <Stat value={String(unaccepted.length)} label="to accept" tone={unaccepted.length > 0 ? color.amber : color.quiet} />
        <Stat value={String(unsorted.length)} label="with no team yet" tone={unsorted.length > 0 ? color.amber : color.quiet} />
        <Stat value={String(leftOut.length)} label="left out" tone={color.muted} />
      </div>

      {notice ? <Banner tone="good">{notice}</Banner> : null}

      {estimation ? (
        <Banner tone="good">
          <Row gap={10}>
            <span>
              {copied.size > 0 ? `${plural(copied.size, 'item')} went with ${estimation.name}. Owners, status and due dates are kept there.` : `${estimation.name} has none of these yet.`}
            </span>
            <Spacer />
            {waiting.length > 0 ? (
              <Button size="sm" tone="primary" onClick={() => dispatch({ type: 'addTenderItems', id: tender.id })}>
                Add {waiting.length === 1 ? 'the new one' : `the ${waiting.length} new ones`} to the estimation
              </Button>
            ) : null}
            <Button size="sm" tone="brand" onClick={() => router.navigate({ screen: 'builder', estimation: estimation.slug || estimation.id })}>
              Open the estimation ›
            </Button>
          </Row>
        </Banner>
      ) : null}

      {toReview > 0 ? (
        <Banner tone="warn">
          {plural(toReview, 'requirement')} read as out of scope {toReview === 1 ? 'is' : 'are'} still to review on the requirements step. Once approved,{' '}
          {toReview === 1 ? 'it joins' : 'they join'} this list.
        </Banner>
      ) : null}

      {notMatched > 0 ? (
        <Banner tone="warn">
          <Row gap={10}>
            <span>
              {plural(notMatched, 'approved requirement')} marked out of scope when {notMatched === 1 ? 'it was' : 'they were'} read {notMatched === 1 ? 'is' : 'are'} not on this list
              yet. Matching adds {notMatched === 1 ? 'it' : 'them'}, or add {notMatched === 1 ? 'it' : 'them'} now: no AI is needed.
            </span>
            <Button size="sm" onClick={() => dispatch({ type: 'setMatches', id: tender.id, matches: outOfScopeMatches(tender) })}>
              Add {notMatched === 1 ? 'it' : 'them'}
            </Button>
          </Row>
        </Banner>
      ) : null}

      {unaccepted.length > 0 ? (
        <Banner tone="warn">
          <Row gap={10}>
            <span>
              {plural(unaccepted.length, 'item')} {unaccepted.length === 1 ? 'is' : 'are'} not accepted yet. Only accepted ones go with the estimation, as on the match step.
            </span>
            <Button size="sm" tone="brand" onClick={() => dispatch({ type: 'approveMatches', id: tender.id, reqIds: unaccepted.map((draft) => draft.key), approved: true })}>
              Accept all {unaccepted.length}
            </Button>
          </Row>
        </Banner>
      ) : null}

      {runner.sortError ? <Banner tone="bad">{runner.sortError}</Banner> : null}
      {runner.sorting ? (
        <Banner tone="good">Sorting the items into teams. The AI reads only their wording and the reason each is out of scope.</Banner>
      ) : sortable > 0 && !runner.held ? (
        <Banner tone="warn">
          <Row gap={10}>
            <span>
              {plural(sortable, 'item')} {sortable === 1 ? 'has' : 'have'} no team yet{estimation ? ', here or on the estimation' : ''}. The AI can sort them from their wording
              alone, for a few cents; you can change any it picks.
            </span>
            <Button size="sm" onClick={runner.runSorting}>
              Sort them
            </Button>
          </Row>
        </Banner>
      ) : null}

      {tender.readTerms ? (
        <>
          {runner.readingTerms > 0 ? <Banner tone="good">Reading the key legal and commercial terms of {plural(runner.readingTerms, 'document')}.</Banner> : null}
          {failedReads.map((read) => (
            <Banner key={read.key} tone="bad">
              <Row gap={10}>
                <span>
                  The key terms of {tender.docs.find((doc) => doc.n === read.doc)?.name ?? `document ${read.doc}`} could not be read: {read.error}
                </span>
                <Button size="sm" onClick={() => runner.retryTerms(read.key)} disabled={held.length !== tender.docs.length}>
                  Retry
                </Button>
              </Row>
            </Banner>
          ))}
        </>
      ) : (
        <div style={{ border: `1px dashed ${color.dashRule}`, borderRadius: radius.lg, padding: '12px 16px' }}>
          <Row gap={10}>
            <span style={{ fontSize: 12.5, color: color.body, flex: '1 1 380px', lineHeight: 1.55 }}>
              {held.length === tender.docs.length && held.length > 0
                ? 'The key legal and commercial terms (insurance, liability, payment, IP, termination and the like) were not read for this tender. The AI can list them for the legal team from the files it already holds: about $0.10 a document while the tender is still in its cache from the last few minutes, more when it has to be read in again.'
                : 'The key legal and commercial terms were not read for this tender, and the files are no longer at Anthropic, so they cannot be read now. Upload the tender again to have them read.'}
            </span>
            <Button size="sm" onClick={() => dispatch({ type: 'readTermsNow', id: tender.id })} disabled={held.length !== tender.docs.length || held.length === 0}>
              Read the terms now
            </Button>
          </Row>
        </div>
      )}

      <Row gap={8} style={{ paddingBottom: 10, borderBottom: `1px solid ${color.hairline}` }}>
        {(
          [
            ['all', `All ${drafts.length}`],
            ['accept', `To accept ${unaccepted.length}`],
            ['left', `Left out ${leftOut.length}`]
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <FilterPill key={key} on={filter === key} onClick={() => setFilter(key)}>
            {label}
          </FilterPill>
        ))}
      </Row>

      {drafts.length === 0 ? (
        <Empty
          title="Nothing here yet"
          body={
            tender.reqs.length === 0
              ? 'Requirements the AI reads as out of scope land here once the tender is read.'
              : 'No approved requirement is matched as out of scope. Anything matched that way on the match step shows here.'
          }
        />
      ) : shown.length === 0 ? (
        <Empty title="Nothing here" body="Pick a different filter." />
      ) : (
        grouped.map((group) => (
          <section key={group.category || 'unsorted'} aria-label={group.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <GroupHeading label={group.label} count={group.items.length} hint={SALES_LEGAL_CATEGORIES.find((one) => one.id === group.category)?.hint} />
            {group.items.map((draft) => (
              <DraftRow
                key={draft.key}
                draft={draft}
                item={items.get(draft.key)}
                onCategory={(category) => setCategory(draft, category)}
                onKeep={(on) => keep(draft, on)}
                onAccept={(accept) => dispatch({ type: 'approveMatches', id: tender.id, reqIds: [draft.key], approved: accept })}
                onCustom={() => {
                  dispatch({ type: 'editMatch', id: tender.id, reqId: draft.key, patch: { kind: 'custom' } });
                  setNotice(`${draft.key} is custom work now: it goes to the estimation desk from the last step${draft.accepted ? '' : ' once its match is accepted'}. Change it back on the match step.`);
                }}
              />
            ))}
          </section>
        ))
      )}

      {drafts.length > 0 && !estimation ? (
        <div style={{ fontSize: 12, color: color.muted }}>
          {plural(waiting.length, 'item')} {waiting.length === 1 ? 'goes' : 'go'} with the estimation when it is created on the last step{unsorted.length > 0 ? `, ${unsorted.length} still ${categoryLabel('').toLowerCase()}` : ''}.
        </div>
      ) : null}
    </div>
  );
}
