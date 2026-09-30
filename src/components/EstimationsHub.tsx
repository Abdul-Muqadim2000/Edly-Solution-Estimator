import { useMemo, useState, type ReactNode } from 'react';
import type { EstimationStage, EstimationTag } from '@/types';
import { useApp, usePlatformEstimations } from '@/state/AppProvider';
import { hubStats, requestsFor } from '@/state/reducer';
import { isDemoEstimation } from '@/domain/demo';
import { openByEstimation } from '@/domain/salesLegal';
import { deskCounts, ESTIMATION_STAGES, stageOf, stageStep } from '@/domain/stages';
import { calcEstimate } from '@/domain/estimate';
import { color, dueInfo, font, radius, shadow, tagStyle } from '@/theme';
import { hours, money, plural } from '@/lib/format';
import { isLiveCatalog } from '@/data/practices';
import { LANDING, platformTrail } from '@/lib/router';
import { pressable } from '@/lib/pressable';
import { BackTo, Breadcrumbs } from '@/components/Nav';
import { AppHeader } from '@/components/AppHeader';
import { Banner, Button, DemoTag, Empty, Field, Mono, Row, SearchInput, Select, Spacer, Stat, useRowHover } from '@/components/ui';
import { useHover } from '@/lib/useHover';
import { TenderIntake } from '@/components/tender/TenderIntake';
import { TenderStrip } from '@/components/tender/TenderList';
import { EstimationBoard } from '@/components/EstimationBoard';
import { StagePicker, StageTrack, useStoredView, ViewSwitch } from '@/components/stages';
import { VIEW_KEYS } from '@/state/keys';
import { AssignControl, DEMO_ASSIGN } from '@/components/people';
import { assignedUsers, isAdmin } from '@/domain/people';

/** The sales landing page: every deal for this platform, with the numbers that matter on the card. */

const TAGS: EstimationTag[] = ['Active', 'Urgent', 'On hold', 'Closed'];
type Filter = 'all' | 'mine' | 'open' | 'urgent' | 'pending' | 'closed';

/** The status filters above the card grid. */
function FilterPill({ children, on, onClick }: { children: string; on: boolean; onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...h.bind}
      style={{
        border: `1px solid ${on ? color.brand : color.rule}`,
        cursor: 'pointer',
        borderRadius: radius.pill,
        padding: '7px 15px',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: font.body,
        background: on ? color.brandWash : color.surface,
        color: on ? color.brandDeep : h.on ? color.ink : color.muted,
        whiteSpace: 'nowrap',
        transition: 'color 120ms ease, border-color 120ms ease'
      }}
    >
      {children}
    </button>
  );
}

/** One deal on the hub. Lifts on hover, because the whole card is a click target. */
function EstimationCard({
  pending,
  accent,
  children
}: {
  pending: number;
  accent: string;
  children: ReactNode;
}): JSX.Element {
  const hover = useRowHover({ borderColor: color.brand, boxShadow: '0 14px 32px rgba(20, 20, 20, 0.09)' });
  return (
    <div
      {...hover.bind}
      style={{
        background: color.surface,
        border: `1px solid ${pending > 0 ? color.amberEdge : color.hairline}`,
        borderRadius: radius.xl,
        overflow: 'hidden',
        transition: 'border-color 140ms ease, box-shadow 140ms ease',
        ...hover.style
      }}
    >
      <div style={{ height: 3, background: accent }} />
      {children}
    </div>
  );
}

export function EstimationsHub(): JSX.Element {
  const { state, dispatch, router, catalog } = useApp();
  const estimations = usePlatformEstimations();

  const [filter, setFilter] = useState<Filter>('all');
  /* the admin account is nobody's to assign, so it has no deals of its own to filter to */
  const me = isAdmin(state.auth) ? '' : state.auth?.user ?? '';
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [tag, setTag] = useState<EstimationTag>('Active');
  const [stage, setStage] = useState<EstimationStage>('progress');
  const [due, setDue] = useState('');
  const [view, setView] = useStoredView(VIEW_KEYS.hub);
  const board = view === 'board';
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [intake, setIntake] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return estimations.filter((estimation) => {
      if (filter === 'open' && estimation.tag === 'Closed') return false;
      if (filter === 'urgent' && estimation.tag !== 'Urgent') return false;
      if (filter === 'closed' && estimation.tag !== 'Closed') return false;
      if (filter === 'mine' && !assignedUsers(estimation.assigned).includes(me)) return false;
      if (filter === 'pending' && !requestsFor(state, estimation.id).some((request) => !request.manual && !(Number(request.est) > 0))) return false;
      if (!needle) return true;
      return `${estimation.name} ${estimation.client}`.toLowerCase().includes(needle);
    });
  }, [estimations, filter, query, state, me]);

  /* one pass for every card, rather than a filter of the whole list per card */
  const openLegal = useMemo(() => openByEstimation(state.salesLegal), [state.salesLegal]);
  /* about real deals only: the demo is not work in play */
  const stats = useMemo(() => hubStats(state), [state]);
  const sampleCatalog = !isLiveCatalog(state.platform) && !state.loadedCatalogs[state.platform];

  const create = (): void => {
    if (!name.trim()) {
      setError('Give the estimation a name — the client or project works best.');
      return;
    }
    setError('');
    dispatch({ type: 'createEstimation', input: { name: name.trim(), client: client.trim(), tag, stage, due } });
    setName('');
    setClient('');
    setDue('');
    setTag('Active');
    setStage('progress');
    setCreating(false);
  };

  return (
    <div style={{ background: color.page }}>
      <AppHeader sticky />
      {/* the board takes more of a wide screen, since six columns do not fit the cards' width */}
      <main style={{ maxWidth: board ? 1680 : 1180, margin: '0 auto', padding: '32px 28px 90px' }}>
        {state.catalogError ? (
          <div style={{ marginBottom: 20 }}>
            <Banner tone="bad">{state.catalogError}</Banner>
          </div>
        ) : null}

        {sampleCatalog ? (
          <div style={{ marginBottom: 20 }}>
            <Banner tone="warn">
              Sample catalog — these scopes and hours are industry benchmarks for this platform, not Edly delivery records. Load
              this practice’s sheet from 📚 Catalog, or add estimated solutions at the desk, to make it yours.
            </Banner>
          </div>
        ) : null}

        <Row gap={24} align="flex-end" style={{ rowGap: 18 }}>
          <div style={{ flex: '1 1 340px', minWidth: 0 }}>
            {/* the way back to every practice, which the hub used to have none of */}
            <BackTo to={LANDING}>← All practices</BackTo>
            <Breadcrumbs trail={platformTrail(state.platform, 'sales')} style={{ marginTop: 14 }} />
            <h1 style={{ fontFamily: font.display, fontSize: 32, fontWeight: 700, margin: '8px 0 0', letterSpacing: -0.6 }}>Your estimations</h1>
            <p style={{ fontSize: 13.5, color: color.muted, lineHeight: 1.6, margin: '7px 0 0', maxWidth: 560 }}>
              Each one keeps its own selections, buffers, rate card, custom requests and delivery plan.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, flex: '1 1 330px' }}>
            <Stat value={String(stats.open)} label={stats.open === 1 ? 'open deal' : 'open deals'} />
            <Stat value={hours(stats.hours)} label="hours in play" tone={color.brandDeep} />
            <Stat value={String(stats.awaiting)} label="awaiting estimates" tone={stats.awaiting > 0 ? color.amber : color.quiet} />
          </div>
        </Row>

        <Row gap={10} style={{ marginTop: 26, paddingBottom: 14, borderBottom: `1px solid ${color.hairline}` }}>
          {(
            [
              ['all', `All ${estimations.length}`],
              ...(me ? [['mine', 'Assigned to me'] as [Filter, string]] : []),
              ['open', 'Open'],
              ['urgent', 'Urgent'],
              ['pending', 'Awaiting estimates'],
              ['closed', 'Closed']
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <FilterPill key={key} on={filter === key} onClick={() => setFilter(key)}>
              {label}
            </FilterPill>
          ))}
          <Spacer />
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Find an estimation or client…"
            style={{ flex: '0 1 260px', minWidth: 150, padding: '9px 15px', fontSize: 12.5 }}
          />
          <Button tone="brand" pill onClick={() => setIntake(true)} style={{ padding: '9px 18px', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            Start from a tender
          </Button>
          <Button
            tone="primary"
            pill
            onClick={() => setCreating((value) => !value)}
            style={{ padding: '10px 20px', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' }}
          >
            {creating ? '× Close' : '+ New estimation'}
          </Button>
        </Row>

        {creating ? (
          <div style={{ marginTop: 18, background: color.surface, border: `1px solid ${color.brandEdge}`, borderRadius: radius.xl, padding: '20px 22px', boxShadow: shadow.brand }}>
            <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 600 }}>New estimation</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginTop: 14 }}>
              <Field label="Name" value={name} onChange={setName} placeholder="e.g. Acme Corporate Academy" onEnter={create} />
              <Field label="Client / contact" value={client} onChange={setClient} placeholder="Optional" onEnter={create} />
              <Select label="Status" value={tag} options={TAGS.map((value) => ({ value, label: value }))} onChange={setTag} />
              <Select label="Stage" value={stage} options={ESTIMATION_STAGES.map((one) => ({ value: one.id, label: one.label }))} onChange={setStage} />
              <Field label="Deadline" type="date" value={due} onChange={setDue} />
            </div>
            <Row gap={10} style={{ marginTop: 14 }}>
              <Button tone="primary" onClick={create} style={{ letterSpacing: 0.7, textTransform: 'uppercase' }}>
                Create &amp; open
              </Button>
              <Button onClick={() => setCreating(false)}>Cancel</Button>
              {error ? <span style={{ fontSize: 12, fontWeight: 600, color: color.redInk }}>{error}</span> : null}
            </Row>
          </div>
        ) : null}

        {intake ? <TenderIntake onClose={() => setIntake(false)} /> : null}
        <TenderStrip />

        {rows.length === 0 ? (
          <div style={{ marginTop: 22 }}>
            <Empty
              title={estimations.length === 0 ? 'No estimations yet' : 'Nothing matches that'}
              body={
                estimations.length === 0
                  ? 'Start one for the deal you are working on — it keeps its own selections, rates and delivery plan.'
                  : 'Clear the search or pick a different filter.'
              }
            />
          </div>
        ) : null}

        {/* its own row above the results: the toolbar has no room for it at 1440px */}
        {estimations.length > 0 ? (
          <Row gap={10} style={{ marginTop: 20 }}>
            <span style={{ fontSize: 12, color: color.muted }}>
              {rows.length === estimations.length ? plural(estimations.length, 'estimation') : `${rows.length} of ${plural(estimations.length, 'estimation')}`}
            </span>
            <Spacer />
            <ViewSwitch view={view} onChange={setView} />
          </Row>
        ) : null}

        {board ? (estimations.length > 0 ? <EstimationBoard rows={rows} /> : null) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14, marginTop: 14 }}>
          {rows.map((estimation) => {
            const requests = requestsFor(state, estimation.id);
            const { waiting: pending, needsInfo } = deskCounts(requests);
            const dealStage = stageOf(estimation);
            const shown = estimation.tag || 'Active';
            const style = tagStyle(shown);
            const due = dueInfo(estimation.due);
            const numbers = calcEstimate(catalog, estimation.snap, requests);
            const asking = confirmDelete === estimation.id;
            const legalOpen = openLegal.get(estimation.id) ?? 0;
            const demo = isDemoEstimation(estimation);

            return (
              <EstimationCard key={estimation.id} pending={pending} accent={style.co}>
                <div
                  {...pressable(() => router.navigate({ screen: 'builder', estimation: estimation.slug || estimation.id }))}
                  style={{ padding: '18px 20px 14px', cursor: 'pointer' }}
                >
                  <Row gap={10} align="flex-start" wrap={false}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 600, lineHeight: 1.28 }}>{estimation.name}</div>
                      <div style={{ fontSize: 12.5, color: color.faint, marginTop: 3 }}>{estimation.client || 'No client set'}</div>
                    </div>
                    {demo ? <DemoTag /> : null}
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                        borderRadius: radius.pill,
                        padding: '4px 10px',
                        whiteSpace: 'nowrap',
                        background: style.bg,
                        color: style.co
                      }}
                    >
                      {shown}
                    </span>
                  </Row>

                  <Row gap={8} align="baseline" style={{ marginTop: 16 }}>
                    <span style={{ fontFamily: font.display, fontSize: 27, fontWeight: 700, lineHeight: 1, letterSpacing: -0.5 }}>
                      {hours(numbers.grand)}
                    </span>
                    <span style={{ fontSize: 11.5, color: color.faint }}>hours</span>
                    <Spacer />
                    {numbers.usd > 0 ? (
                      <Mono size={12.5} tone={color.brandDeep}>
                        {money(numbers.usd, estimation.snap.cur ?? 'USD')}
                      </Mono>
                    ) : null}
                  </Row>

                  {/* where it stands: the menu moves it, the track shows how far along it is */}
                  <div style={{ marginTop: 14 }}>
                    <Row gap={8} wrap={false}>
                      <StagePicker
                        stages={ESTIMATION_STAGES}
                        value={dealStage}
                        onChange={(next) => dispatch({ type: 'patchEstimation', id: estimation.id, patch: { stage: next } })}
                        stepper
                      />
                      <Spacer />
                      <Mono size={10.5} tone={color.quiet}>
                        {stageStep(dealStage)}/{ESTIMATION_STAGES.length}
                      </Mono>
                    </Row>
                    <StageTrack stage={dealStage} style={{ marginTop: 9 }} />
                  </div>

                  <Row gap={14} style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${color.hairlineSoft}` }}>
                    {[
                      ['solutions', String(numbers.selIds.length), color.ink],
                      ['custom', String(requests.length), requests.length > 0 ? color.ink : color.quiet],
                      ['pending', String(pending), pending > 0 ? color.amber : color.quiet]
                    ].map(([label, value, tone]) => (
                      <div key={label}>
                        <div style={{ fontFamily: font.mono, fontSize: 13, fontWeight: 600, color: tone }}>{value}</div>
                        <div style={{ fontSize: 10, color: color.quiet, letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
                      </div>
                    ))}
                    <Spacer />
                    {/* who is on the deal; its own clicks and keys stop at it, so the card does not open */}
                    <AssignControl ticket="deal" id={estimation.id} assigned={estimation.assigned} align="right" disabledReason={demo ? DEMO_ASSIGN : undefined} />
                  </Row>

                  {due ? (
                    <div style={{ marginTop: 12 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: radius.pill, padding: '4px 10px', background: due.bg, color: due.co }}>
                        {due.label}
                      </span>
                    </div>
                  ) : null}
                </div>

                {demo ? (
                  /* nothing to set or delete on the demo: it is always there, and never saved */
                  <Row gap={7} style={{ padding: '11px 20px', background: color.surfaceSoft, borderTop: `1px solid ${color.hairlineSoft}` }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.45, color: color.muted }}>
                      A finished example to learn from. Try anything in it: nothing is saved.
                    </span>
                    <Button size="sm" tone="ghost" title="Put the demo back as it was prepared" onClick={() => dispatch({ type: 'resetDemo' })}>
                      Reset
                    </Button>
                  </Row>
                ) : (
                  <Row
                    gap={7}
                    style={{ padding: '11px 20px', background: color.surfaceSoft, borderTop: `1px solid ${color.hairlineSoft}` }}
                  >
                    <Select
                      value={shown}
                      options={TAGS.map((value) => ({ value, label: value }))}
                      onChange={(value) => dispatch({ type: 'patchEstimation', id: estimation.id, patch: { tag: value } })}
                      hint="Status tag"
                    />
                    <input
                      type="date"
                      value={estimation.due}
                      title="Deadline"
                      onChange={(event) => dispatch({ type: 'patchEstimation', id: estimation.id, patch: { due: event.target.value } })}
                      style={{
                        border: `1px solid ${color.hairline}`,
                        borderRadius: radius.sm,
                        padding: '4px 7px',
                        fontSize: 11,
                        color: color.inkSoft,
                        background: color.surface,
                        outline: 'none'
                      }}
                    />
                    <Spacer />
                    <span style={{ fontSize: 10.5, color: color.quiet, whiteSpace: 'nowrap' }}>Updated {estimation.up || estimation.at || '—'}</span>
                    <Button
                      size="sm"
                      tone={asking ? 'danger' : 'ghost'}
                      title={asking ? 'Click again to permanently delete this estimation and its custom requests' : 'Delete estimation'}
                      onClick={() => {
                        if (asking) {
                          dispatch({ type: 'deleteEstimation', id: estimation.id });
                          setConfirmDelete('');
                        } else {
                          setConfirmDelete(estimation.id);
                          setTimeout(() => setConfirmDelete(''), 4000);
                        }
                      }}
                      style={{ padding: asking ? '3px 9px' : '2px 6px', fontSize: asking ? 11 : 15 }}
                    >
                      {asking ? 'Delete?' : '×'}
                    </Button>
                  </Row>
                )}

                {pending > 0 ? (
                  <div style={{ background: color.amberWash, borderTop: `1px solid ${color.amberEdgeSoft}`, padding: '8px 20px', fontSize: 11, fontWeight: 700, color: color.amberInk }}>
                    {pending} awaiting estimate
                  </div>
                ) : null}
                {/* the one thing on the desk sales has to answer */}
                {needsInfo > 0 ? (
                  <div style={{ background: color.roseWash, borderTop: `1px solid ${color.roseEdge}`, padding: '8px 20px', fontSize: 11, fontWeight: 700, color: color.roseInk }}>
                    The desk needs more detail on {plural(needsInfo, 'request')}
                  </div>
                ) : null}
                {/* internal, like the builder's panel, so it goes while presenting */}
                {legalOpen > 0 && !state.presenting ? (
                  <div
                    title="Open the estimation, then Sales & legal, to assign them"
                    style={{ background: color.surfaceSoft, borderTop: `1px solid ${color.hairlineSoft}`, padding: '8px 20px', fontSize: 11, fontWeight: 700, color: color.inkSoft }}
                  >
                    {plural(legalOpen, 'open sales and legal item')}
                  </div>
                ) : null}
              </EstimationCard>
            );
          })}
        </div>
        )}
      </main>
    </div>
  );
}
