import { useEffect, useState } from 'react';
import type { SalesLegalCategory, SalesLegalItem, SalesLegalStatus } from '@/types';
import { useApp } from '@/state/AppProvider';
import { openEstimationRecord, salesLegalFor } from '@/state/reducer';
import { byCategory, categoryLabel, deletable, OWNERS, SALES_LEGAL_CATEGORIES, salesLegalCounts, topicLabel, type SalesLegalPatch } from '@/domain/salesLegal';
import { plural, today } from '@/lib/format';
import { useHover } from '@/lib/useHover';
import { color, font, radius } from '@/theme';
import { Button, Chip, Field, Modal, Mono, Row, SearchInput, Select, Spacer, Stat } from '@/components/ui';
import { DeferredField, FilterPill, PriorityToggle, rowEdge, SourceQuote, TextButton } from '@/components/tender/parts';
import { categoryOptions, GroupHeading, STATUS_OPTIONS, statusTone } from '@/components/salesLegal/parts';

/**
 * Sales & legal: what this deal commits Edly to that is not software, for the teams who own it.
 *
 * A window of its own rather than a dropdown, because each item needs what the match step showed
 * to be acted on: its words, why it is here, where the tender says it and in what words, and then
 * who has it, by when and where it stands. Items arrive from the tender the estimation was created
 * from, and anyone can add one by hand on any estimation.
 *
 * The builder hides this while presenting, like Rates and the Excel sheet, because sales
 * screen-shares the builder and "must hold a state security certification" is not for the client's
 * eyes. Nothing here reaches the client's sheet, the printed quote or the plain-text quote.
 */

type Filter = SalesLegalStatus | 'all';

const OWNER_LIST = 'sales-legal-owners';

function ItemCard({ item, tenderName, canDelete }: { item: SalesLegalItem; tenderName: string; canDelete: boolean }): JSX.Element {
  const { dispatch } = useApp();
  const hover = useHover();
  const [noting, setNoting] = useState(false);
  const tone = statusTone(item.status);
  const set = (patch: SalesLegalPatch): void => dispatch({ type: 'patchSalesLegal', ids: [item.id], patch });
  const closed = item.status !== 'open';
  const overdue = !closed && item.due !== '' && item.due < today();
  const accent = item.status === 'handled' ? color.brand : item.status === 'not-ours' ? color.hairline : item.owner ? color.amberEdge : color.amber;
  const why =
    item.reason ||
    (item.kind === 'term' ? `A key ${item.topic ? topicLabel(item.topic).toLowerCase() : 'legal or commercial'} term of the contract, read for the legal team.` : '');
  const where = [item.source, item.section ? `under ${item.section}` : ''].filter(Boolean).join(', ');
  const from = item.tender ? `${item.tenderItem ? `${item.tenderItem} of ` : ''}${tenderName ? `the tender ${tenderName}` : 'a tender since deleted'}` : '';

  return (
    <div
      {...hover.bind}
      style={{ background: closed ? color.surfaceSoft : color.surface, ...rowEdge(hover.on, accent), borderRadius: radius.md, padding: '12px 14px', transition: 'border-color 120ms ease' }}
    >
      <Row gap={8}>
        <Mono size={11} tone={color.brandDeep}>
          {item.id}
        </Mono>
        <PriorityToggle value={item.priority} onChange={item.tender ? undefined : (priority) => set({ priority })} />
        {item.kind === 'term' ? <Chip>{item.topic ? topicLabel(item.topic) : 'Contract term'}</Chip> : null}
        <span style={{ fontSize: 11.5, color: color.faint }} title={from || undefined}>
          {item.tender ? `Tender item ${item.tenderItem || ''}`.trim() : 'Added by hand'}
        </span>
        <Spacer />
        {overdue ? <Chip bg={color.redWash} co={color.redInk}>Overdue</Chip> : null}
        <Select
          value={item.status}
          options={STATUS_OPTIONS}
          onChange={(status) => set({ status })}
          hint={`Where ${item.id} stands`}
          style={{ padding: '5px 8px', fontSize: 12, fontWeight: 700, width: 120, background: tone.bg, color: tone.co, borderColor: tone.bg }}
        />
      </Row>

      {item.tender ? (
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: closed ? color.muted : color.ink, marginTop: 8, textDecoration: item.status === 'not-ours' ? 'line-through' : 'none' }}>
          {item.text}
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <DeferredField label="Item" value={item.text} onCommit={(text) => set({ text })} />
        </div>
      )}
      {why ? <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.5, marginTop: 4 }}>{why}</div> : null}
      {item.tender ? (
        /* a line of its own that wraps: a source with a section heading runs long */
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 12px', marginTop: 4 }}>
          <span style={{ fontSize: 11.5, color: color.faint, lineHeight: 1.5, overflowWrap: 'anywhere', minWidth: 0 }}>
            {where ? `In ${where}` : 'In the tender'}
            {from ? `. ${from.charAt(0).toUpperCase()}${from.slice(1)}` : ''}
          </span>
        </div>
      ) : null}
      {item.tender && item.quote ? (
        <div style={{ marginTop: 2 }}>
          <SourceQuote source={where || 'the tender'} quote={item.quote} label="Show the tender wording" />
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 10, alignItems: 'end' }}>
        <Select label="Team" value={item.category} options={categoryOptions(item.category)} onChange={(category) => set({ category })} hint="Which team needs to know" />
        <DeferredField label="Owner" value={item.owner} onCommit={(owner) => set({ owner })} placeholder="A team or a name" list={OWNER_LIST} />
        <Field label="Due" type="date" value={item.due} onChange={(due) => set({ due })} />
      </div>

      {noting ? (
        <div
          style={{ marginTop: 10 }}
          onBlur={(event) => {
            /* the note field commits on blur; close it once focus has left the whole note */
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setNoting(false);
          }}
        >
          <DeferredField multiline label="Note" value={item.note} onCommit={(note) => set({ note })} placeholder="What was agreed, who was asked, what is still needed" />
        </div>
      ) : item.note ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: color.surfaceMuted, borderRadius: radius.sm, padding: '8px 10px', marginTop: 10 }}>
          <span style={{ flex: 1, fontSize: 12.5, color: color.body, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{item.note}</span>
          <TextButton onClick={() => setNoting(true)} title={`Edit the note on ${item.id}`}>
            Edit note
          </TextButton>
        </div>
      ) : null}

      <Row gap={12} style={{ marginTop: 8 }}>
        {!noting && !item.note ? (
          <TextButton onClick={() => setNoting(true)} title={`Add a note to ${item.id}`}>
            + Add a note
          </TextButton>
        ) : null}
        <Spacer />
        <span style={{ fontSize: 11, color: color.faint }}>Updated {item.up || item.at}</span>
        {canDelete ? (
          <TextButton tone={color.redInk} onClick={() => dispatch({ type: 'deleteSalesLegal', id: item.id })} title={`Delete ${item.id}`}>
            Delete
          </TextButton>
        ) : null}
      </Row>
    </div>
  );
}

function AddForm({ estId, onDone }: { estId: string; onDone: () => void }): JSX.Element {
  const { dispatch } = useApp();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<SalesLegalCategory | ''>('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const add = (): void => {
    if (!text.trim()) {
      setError('Say what the deal commits Edly to.');
      return;
    }
    dispatch({ type: 'addSalesLegal', estId, input: { text, category, owner, due, note: '', priority: 'must' } });
    onDone();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', border: `1px solid ${color.brandEdge}`, borderRadius: radius.lg, background: color.brandWashTint }}>
      <Field label="Item" value={text} onChange={setText} placeholder="e.g. Quarterly business review with the client's procurement team" onEnter={add} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <Select label="Team" value={category} options={categoryOptions(category)} onChange={setCategory} />
        <Field label="Owner" value={owner} onChange={setOwner} placeholder="A team or a name" list={OWNER_LIST} onEnter={add} />
        <Field label="Due" type="date" value={due} onChange={setDue} />
      </div>
      <Row gap={8}>
        <Button size="sm" tone="primary" onClick={add}>
          Add item
        </Button>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        {error ? <span style={{ fontSize: 11.5, fontWeight: 600, color: color.redInk }}>{error}</span> : null}
      </Row>
    </div>
  );
}

export function SalesLegalPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { state, dispatch } = useApp();
  const estimation = openEstimationRecord(state);
  const items = estimation ? salesLegalFor(state, estimation.id) : [];
  const day = today();
  const counts = salesLegalCounts(items, day);
  const [filter, setFilter] = useState<Filter>(() => (counts.open > 0 || items.length === 0 ? 'open' : 'all'));
  const [unowned, setUnowned] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tenderNames = new Map(state.tenders.map((tender) => [tender.id, tender.name] as const));
  const tenderIds = new Set(tenderNames.keys());
  const needle = query.trim().toLowerCase();
  const shown = items.filter((item) => {
    if (filter !== 'all' && item.status !== filter) return false;
    if (unowned && item.owner) return false;
    if (!needle) return true;
    return [item.text, item.owner, item.note, item.reason, item.source, item.section, item.quote, item.id, item.tenderItem].join(' ').toLowerCase().includes(needle);
  });
  const noOwner = items.filter((item) => item.status === 'open' && !item.owner).length;
  const groups = byCategory(shown);

  const title = (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: color.brandDeep }}>Sales, account and legal</div>
      <div style={{ fontFamily: font.display, fontSize: 21, fontWeight: 700, marginTop: 4, lineHeight: 1.3 }}>{estimation?.name ?? 'No estimation open'}</div>
      {estimation?.client ? <div style={{ fontSize: 13, color: color.faint, marginTop: 2 }}>{estimation.client}</div> : null}
      <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55, marginTop: 6, maxWidth: 780 }}>
        What this deal commits Edly to that is not software, for the sales, account and legal teams to own. Internal: it never reaches the client&apos;s sheet or
        quote, and it hides while presenting. An item from a tender is marked Not for us rather than deleted, so the tender does not offer it again.
      </div>
    </div>
  );

  return (
    <Modal title={title} onClose={onClose} width={1120} padding="24px 28px">
      <datalist id={OWNER_LIST}>
        {OWNERS.map((owner) => (
          <option key={owner} value={owner} />
        ))}
      </datalist>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
        {items.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <Stat value={String(counts.open)} label="open" tone={counts.open > 0 ? color.amber : color.quiet} />
            <Stat value={String(noOwner)} label="open with no owner" tone={noOwner > 0 ? color.amber : color.quiet} />
            <Stat value={String(counts.overdue)} label="overdue" tone={counts.overdue > 0 ? color.redInk : color.quiet} />
            <Stat value={String(counts.handled)} label="handled" tone={color.brandDeep} />
            <Stat value={String(counts.notOurs)} label="not for us" tone={color.muted} />
          </div>
        ) : null}

        {adding && estimation ? <AddForm estId={estimation.id} onDone={() => setAdding(false)} /> : null}

        <Row gap={8} style={{ paddingBottom: 12, borderBottom: `1px solid ${color.hairline}` }}>
          {items.length > 0
            ? (
                [
                  ['open', `Open ${counts.open}`],
                  ['handled', `Handled ${counts.handled}`],
                  ['not-ours', `Not for us ${counts.notOurs}`],
                  ['all', `All ${counts.total}`]
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <FilterPill key={key} on={filter === key} onClick={() => setFilter(key)}>
                  {label}
                </FilterPill>
              ))
            : null}
          {items.length > 0 ? (
            <FilterPill on={unowned} onClick={() => setUnowned((value) => !value)}>
              No owner yet
            </FilterPill>
          ) : null}
          <Spacer />
          {items.length > 0 ? (
            <SearchInput value={query} onChange={setQuery} placeholder="Find an item, owner or clause…" style={{ flex: '0 1 260px', minWidth: 160, padding: '8px 14px', fontSize: 12.5 }} />
          ) : null}
          {estimation && !adding ? (
            <Button size="sm" tone="brand" onClick={() => setAdding(true)}>
              + Add an item
            </Button>
          ) : null}
        </Row>

        {items.length === 0 ? (
          <div style={{ fontSize: 13, color: color.muted, lineHeight: 1.6, padding: '8px 2px' }}>
            Nothing here yet. When an estimation is created from a tender, its out-of-scope requirements and key terms arrive here with the tender&apos;s wording.
            Add anything else by hand: a report the client expects, a certification the bid depends on, a clause to check.
          </div>
        ) : shown.length === 0 ? (
          <div style={{ fontSize: 13, color: color.muted, padding: '8px 2px' }}>Nothing matches. Pick another filter or clear the search.</div>
        ) : (
          groups.map((group) => {
            const withoutOwner = group.items.filter((item) => !item.owner);
            return (
              <section key={group.category || 'unsorted'} aria-label={group.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <GroupHeading
                  label={group.label}
                  count={group.items.length}
                  hint={SALES_LEGAL_CATEGORIES.find((one) => one.id === group.category)?.hint ?? "Pick a team for each, or sort them with the AI on the tender's Sales, account and legal tab."}
                  action={
                    withoutOwner.length > 0 ? (
                      <Select
                        value=""
                        options={[
                          { value: '', label: `Owner for the ${withoutOwner.length === 1 ? 'one' : withoutOwner.length} without…` },
                          ...OWNERS.map((owner) => ({ value: owner, label: owner }))
                        ]}
                        onChange={(owner) => owner && dispatch({ type: 'patchSalesLegal', ids: withoutOwner.map((item) => item.id), patch: { owner } })}
                        hint={`Give every ${categoryLabel(group.category).toLowerCase()} item shown with no owner the same one`}
                        style={{ padding: '4px 8px', fontSize: 11.5, maxWidth: 220 }}
                      />
                    ) : null
                  }
                />
                {group.items.map((item) => (
                  <ItemCard key={item.id} item={item} tenderName={tenderNames.get(item.tender) ?? ''} canDelete={deletable(item, tenderIds)} />
                ))}
              </section>
            );
          })
        )}

        {items.length > 0 ? (
          <div style={{ fontSize: 11.5, color: color.faint, lineHeight: 1.5 }}>
            {plural(items.length, 'item')} on this deal. The same rows, with the same columns, are in the workbook&apos;s SalesAccountLegal sheet, where the teams can
            filter and assign them without opening the app.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
