import { useMemo, useState, type ReactNode } from 'react';
import type { EstimationTag } from '@/types';
import { useApp, usePlatformEstimations } from '@/state/AppProvider';
import { requestsFor } from '@/state/reducer';
import { calcEstimate } from '@/domain/estimate';
import { color, dueInfo, font, radius, shadow, tagStyle } from '@/theme';
import { hours, money } from '@/lib/format';
import { findPlatform, isLiveCatalog } from '@/data/practices';
import { AppHeader } from '@/components/AppHeader';
import { Banner, Button, Empty, Field, Mono, Row, SearchInput, Select, Spacer, Stat, useRowHover } from '@/components/ui';
import { useHover } from '@/lib/useHover';

/** The sales landing page: every deal for this platform, with the numbers that matter on the card. */

const TAGS: EstimationTag[] = ['Active', 'Urgent', 'On hold', 'Closed'];
type Filter = 'all' | 'open' | 'urgent' | 'pending' | 'closed';

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
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [tag, setTag] = useState<EstimationTag>('Active');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return estimations.filter((estimation) => {
      if (filter === 'open' && estimation.tag === 'Closed') return false;
      if (filter === 'urgent' && estimation.tag !== 'Urgent') return false;
      if (filter === 'closed' && estimation.tag !== 'Closed') return false;
      if (filter === 'pending' && !requestsFor(state, estimation.id).some((request) => !request.manual && !(Number(request.est) > 0))) return false;
      if (!needle) return true;
      return `${estimation.name} ${estimation.client}`.toLowerCase().includes(needle);
    });
  }, [estimations, filter, query, state]);

  const live = estimations.filter((estimation) => estimation.tag !== 'Closed');
  const pendingCount = estimations.reduce(
    (total, estimation) => total + requestsFor(state, estimation.id).filter((request) => !request.manual && !(Number(request.est) > 0)).length,
    0
  );
  const totalHours = live.reduce((total, estimation) => total + Number(estimation.total ?? 0), 0);
  const sampleCatalog = !isLiveCatalog(state.platform) && !state.loadedCatalogs[state.platform];
  const platformRef = findPlatform(state.platform);
  const crumb = platformRef ? `${platformRef.practice.name} / ${platformRef.platform.name}` : '';

  const create = (): void => {
    if (!name.trim()) {
      setError('Give the estimation a name — the client or project works best.');
      return;
    }
    setError('');
    dispatch({ type: 'createEstimation', input: { name: name.trim(), client: client.trim(), tag, due } });
    setName('');
    setClient('');
    setDue('');
    setTag('Active');
    setCreating(false);
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 74px)', background: color.page }}>
      <AppHeader sticky />
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 28px 90px' }}>
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
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: color.brandDeep }}>
              {crumb}
            </div>
            <h1 style={{ fontFamily: font.display, fontSize: 32, fontWeight: 700, margin: '8px 0 0', letterSpacing: -0.6 }}>Your estimations</h1>
            <p style={{ fontSize: 13.5, color: color.muted, lineHeight: 1.6, margin: '7px 0 0', maxWidth: 560 }}>
              Each one keeps its own selections, buffers, rate card, custom requests and delivery plan.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, flex: '1 1 330px' }}>
            <Stat value={String(live.length)} label={live.length === 1 ? 'open deal' : 'open deals'} />
            <Stat value={hours(totalHours)} label="hours in play" tone={color.brandDeep} />
            <Stat value={String(pendingCount)} label="awaiting estimates" tone={pendingCount > 0 ? color.amber : color.quiet} />
          </div>
        </Row>

        <Row gap={10} style={{ marginTop: 26, paddingBottom: 14, borderBottom: `1px solid ${color.hairline}` }}>
          {(
            [
              ['all', `All ${estimations.length}`],
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14, marginTop: 22 }}>
          {rows.map((estimation) => {
            const requests = requestsFor(state, estimation.id);
            const pending = requests.filter((request) => !request.manual && !(Number(request.est) > 0)).length;
            const shown = estimation.tag || 'Active';
            const style = tagStyle(shown);
            const due = dueInfo(estimation.due);
            const numbers = calcEstimate(catalog, estimation.snap, requests);
            const asking = confirmDelete === estimation.id;

            return (
              <EstimationCard key={estimation.id} pending={pending} accent={style.co}>
                <div
                  onClick={() => router.navigate({ screen: 'builder', estimation: estimation.slug || estimation.id })}
                  style={{ padding: '18px 20px 14px', cursor: 'pointer' }}
                >
                  <Row gap={10} align="flex-start" wrap={false}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 600, lineHeight: 1.28 }}>{estimation.name}</div>
                      <div style={{ fontSize: 12.5, color: color.faint, marginTop: 3 }}>{estimation.client || 'No client set'}</div>
                    </div>
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
                  </Row>

                  {due ? (
                    <div style={{ marginTop: 12 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: radius.pill, padding: '4px 10px', background: due.bg, color: due.co }}>
                        {due.label}
                      </span>
                    </div>
                  ) : null}
                </div>

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

                {pending > 0 ? (
                  <div style={{ background: color.amberWash, borderTop: `1px solid ${color.amberEdgeSoft}`, padding: '8px 20px', fontSize: 11, fontWeight: 700, color: color.amberInk }}>
                    {pending} awaiting estimate
                  </div>
                ) : null}
              </EstimationCard>
            );
          })}
        </div>
      </main>
    </div>
  );
}
