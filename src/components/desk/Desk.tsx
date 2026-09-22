import { useMemo, useState, type ReactNode } from 'react';
import type { EstimateRequest } from '@/types';
import { useApp } from '@/state/AppProvider';
import { platformEstimations, platformRequests, requestsFor } from '@/state/reducer';
import { calcEstimate } from '@/domain/estimate';
import { categories, guessBundle, subCategories } from '@/domain/catalog';
import { color, dueInfo, font, radius, shadow, tagStyle } from '@/theme';
import { hours, hours1, money, plural, today } from '@/lib/format';
import { AppHeader } from '@/components/AppHeader';
import { Banner, Button, Chip, Empty, Field, Mono, Row, Select, Spacer, useRowHover } from '@/components/ui';
import { allSolutions } from '@/domain/catalog';
import { useHover } from '@/lib/useHover';
import { isLiveCatalog } from '@/data/practices';

/**
 * The estimation desk.
 *
 * Three tabs: the request queue (work item by item), estimations (open a whole deal and see
 * what sales selected before pricing), and adding to the catalog directly.
 */
export function Desk(): JSX.Element {
  const { state, dispatch, catalog } = useApp();
  const openPage = state.deskView;
  const catChip = `${allSolutions(catalog).length} solutions · ${catalog.meta.compiled || 'catalog'}`;

  return (
    <div style={{ minHeight: '100vh', background: color.page }}>
      <AppHeader sticky>
        <span
          title="Catalog in use"
          style={{ fontSize: 11, color: color.brandDeep, background: color.brandWash, borderRadius: radius.pill, padding: '5px 11px', whiteSpace: 'nowrap' }}
        >
          📚 {catChip}
        </span>
      </AppHeader>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '34px 24px 80px' }}>
        {openPage ? <EstimationPage id={openPage} onBack={() => dispatch({ type: 'setDeskView', id: null })} /> : <DeskTabs />}
      </main>
    </div>
  );
}

/** The desk's filter and tab pills — 1.5px outline, brand wash when on. */
function TabPill({ children, on, onClick, small }: { children: ReactNode; on: boolean; onClick: () => void; small?: boolean }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...h.bind}
      style={{
        border: `1.5px solid ${on || h.on ? color.brand : color.rule}`,
        cursor: 'pointer',
        borderRadius: radius.pill,
        padding: small ? '6px 14px' : '8px 18px',
        fontSize: small ? 12 : 12.5,
        fontWeight: 700,
        fontFamily: font.body,
        background: on ? color.brandWash : color.surface,
        color: on ? color.brandDeep : color.muted,
        whiteSpace: 'nowrap',
        transition: 'border-color 120ms ease'
      }}
    >
      {children}
    </button>
  );
}

/** The desk's dashed empty state — one block of centred text, as in the source. */
function DeskEmpty({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        marginTop: 18,
        border: `1px dashed ${color.rule}`,
        borderRadius: radius.lg,
        padding: '40px 24px',
        textAlign: 'center',
        fontSize: 13.5,
        color: color.muted,
        lineHeight: 1.7
      }}
    >
      {children}
    </div>
  );
}

/** The red outline pill that steps back out of a page. */
function BackPill({ children, onClick }: { children: string; onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...h.bind}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: `1.5px solid ${color.red}`,
        cursor: 'pointer',
        background: h.on ? color.redWash : color.surface,
        color: color.red,
        borderRadius: radius.pill,
        padding: '7px 15px',
        fontSize: 12,
        fontWeight: 700,
        fontFamily: font.body,
        transition: 'background 120ms ease'
      }}
    >
      {children}
    </button>
  );
}

/** The brand pill that opens a request's estimation page. */
function EstChip({ children, onClick }: { children: ReactNode; onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <span
      onClick={onClick}
      title="Open this estimation’s page"
      {...h.bind}
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: color.brandInk,
        background: h.on ? color.brandChip : color.brandWashDeep,
        borderRadius: radius.pill,
        padding: '3px 10px',
        cursor: 'pointer',
        transition: 'background 120ms ease'
      }}
    >
      {children}
    </span>
  );
}

/** The desk's own stat card — larger number, quieter caption than the hub's. */
function DeskStat({ value, label, tone }: { value: string; label: string; tone?: string }): JSX.Element {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: 12, padding: '14px 16px', minWidth: 0 }}>
      <div style={{ fontFamily: font.display, fontSize: 24, fontWeight: 700, color: tone }}>{value}</div>
      <div style={{ fontSize: 11, color: color.muted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function SampleNotice(): JSX.Element | null {
  const { state } = useApp();
  if (isLiveCatalog(state.platform) || state.loadedCatalogs[state.platform]) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <Banner tone="warn">
        Sample catalog — benchmark scopes and hours for this platform, not delivery records. Load this practice’s sheet, or add
        estimated solutions below, to make it yours.
      </Banner>
    </div>
  );
}

function DeskTabs(): JSX.Element {
  const { state, dispatch } = useApp();
  const tabs: { id: typeof state.deskTab; label: string }[] = [
    { id: 'queue', label: 'Request queue' },
    { id: 'estimations', label: 'Estimations' },
    { id: 'add', label: 'Add to catalog' }
  ];

  return (
    <>
      <h1 style={{ fontFamily: font.display, fontSize: 25, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>Estimation desk</h1>
      <p style={{ fontSize: 13, color: color.muted, lineHeight: 1.6, margin: '6px 0 0', maxWidth: 660 }}>
        Requests submitted from the sales workspace land here automatically. Work the queue item by item, or open a single client
        estimation to see everything sales has selected before you price the custom work.
      </p>
      <SampleNotice />
      <Row gap={8} style={{ marginTop: 18 }}>
        {tabs.map((tab) => (
          <TabPill key={tab.id} on={state.deskTab === tab.id} onClick={() => dispatch({ type: 'setDeskTab', tab: tab.id })}>
            {tab.label}
          </TabPill>
        ))}
      </Row>

      {state.deskTab === 'queue' ? <RequestQueue /> : null}
      {state.deskTab === 'estimations' ? <EstimationList /> : null}
      {state.deskTab === 'add' ? <AddToCatalog /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ queue */

function RequestQueue(): JSX.Element {
  const { state } = useApp();
  const all = platformRequests(state).filter((request) => !request.manual);
  const [filter, setFilter] = useState<'' | 'pending' | 'done'>('');
  const [deal, setDeal] = useState('');
  const deals = platformEstimations(state);

  const requests = deal ? all.filter((request) => request.estId === deal) : all;
  const rows = requests.filter((request) => {
    if (filter === 'pending') return !(Number(request.est) > 0);
    if (filter === 'done') return Number(request.est) > 0;
    return true;
  });
  const pending = requests.filter((request) => !(Number(request.est) > 0)).length;
  const returned = requests.length - pending;
  const returnedHours = requests.reduce((total, request) => total + (Number(request.est) > 0 ? Number(request.est) : 0), 0);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 20 }}>
        <DeskStat value={String(pending)} label="awaiting estimate" tone={color.amber} />
        <DeskStat value={String(returned)} label="estimated & returned" tone={color.brandInk} />
        <DeskStat value={`${hours(returnedHours)} h`} label="hours returned to sales" />
      </div>

      <Row gap={10} style={{ marginTop: 18 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: color.muted }}>Estimation</span>
        <Select
          value={deal}
          options={[{ value: '', label: 'All estimations' }, ...deals.map((one) => ({ value: one.id, label: one.client ? `${one.name} · ${one.client}` : one.name }))]}
          onChange={setDeal}
          flex="0 1 320px"
        />
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: color.muted, marginLeft: 8 }}>Status</span>
        {(
          [
            ['', 'All'],
            ['pending', 'Awaiting'],
            ['done', 'Estimated']
          ] as ['' | 'pending' | 'done', string][]
        ).map(([key, label]) => (
          <TabPill key={key} small on={filter === key} onClick={() => setFilter(key)}>
            {label}
          </TabPill>
        ))}
      </Row>

      {rows.length === 0 ? (
        <DeskEmpty>
          No requests yet.
          <br />
          When a sales person submits “Request an estimate”, it appears here instantly.
        </DeskEmpty>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
        {rows.map((request) => (
          <RequestCard key={request.id} request={request} />
        ))}
      </div>
    </>
  );
}

function RequestCard({ request }: { request: EstimateRequest }): JSX.Element {
  const { state, dispatch, catalog } = useApp();
  const done = Number(request.est) > 0;

  const [hoursValue, setHours] = useState(done ? String(request.est) : '');
  const [repeat, setRepeat] = useState(request.repeatEst ? String(request.repeatEst) : '');
  const [bundleId, setBundleId] = useState(request.catBundle || guessBundle(catalog, request.catCategory ?? request.area));
  const [form, setForm] = useState(request.catForm ?? 'Custom development');
  const [deploy, setDeploy] = useState(request.catDeploy ?? '');
  const [category, setCategory] = useState(request.catCategory ?? request.area ?? 'Custom');
  const [subCategory, setSubCategory] = useState(request.catSub ?? '');
  const [integrations, setIntegrations] = useState(request.catInteg ?? request.integrations ?? '');
  const [account, setAccount] = useState(request.catAccount ?? '');
  const [limits, setLimits] = useState(request.catLimits ?? '');
  const [note, setNote] = useState(request.estNote ?? '');
  const [error, setError] = useState('');

  const estimation = state.estimations.find((candidate) => candidate.id === request.estId);
  const due = dueInfo(estimation?.due);
  const chips = [request.area, request.urgency, request.integrations].filter(Boolean);

  const submit = (): void => {
    const value = Number(hoursValue);
    if (!(value > 0)) {
      setError('Enter the estimated hours before submitting.');
      return;
    }
    setError('');
    dispatch({
      type: 'submitEstimate',
      id: request.id,
      submission: {
        hours: value,
        repeatHours: Number(repeat) || undefined,
        bundleId,
        form,
        deploy: deploy.trim(),
        integrations: integrations.trim(),
        category: category.trim() || 'Custom',
        subCategory: subCategory.trim(),
        account: account.trim(),
        limits: limits.trim(),
        note: note.trim(),
        by: state.auth?.user ?? 'estimator'
      }
    });
  };

  const bundleOptions = [
    ...catalog.bundles.map((bundle) => ({ value: bundle.id, label: `${bundle.id} · ${bundle.name}` })),
    ...(catalog.bundles.some((bundle) => bundle.id === 'CX') ? [] : [{ value: 'CX', label: 'CX · Estimated solutions (new group)' }])
  ];

  return (
    <div style={{ marginTop: 14, background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: radius.lg, padding: '18px 20px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: font.mono, fontSize: 11, fontWeight: 600, color: color.brandDeep, background: color.brandWash, borderRadius: radius.sm, padding: '3px 8px' }}>
          {request.id}
        </span>
        <EstChip onClick={() => dispatch({ type: 'setDeskView', id: request.estId })}>
          {(request.estName || 'General estimation') + (request.client ? ` · ${request.client}` : '')} ›
        </EstChip>
        {estimation?.tag ? (
          <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: radius.pill, padding: '3px 10px', background: tagStyle(estimation.tag).bg, color: tagStyle(estimation.tag).co }}>
            {estimation.tag}
          </span>
        ) : null}
        {due ? (
          <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: radius.pill, padding: '3px 10px', background: due.bg, color: due.co }}>{due.label}</span>
        ) : null}
        <span style={{ fontFamily: font.display, fontSize: 15.5, fontWeight: 600, color: color.ink }}>{request.title}</span>
        <Spacer />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            borderRadius: radius.pill,
            padding: '4px 11px',
            background: done ? color.brandWashDeep : color.amberWash,
            color: done ? color.brandInk : color.amber
          }}
        >
          {done ? 'Estimated' : 'Awaiting estimate'}
        </span>
      </div>

      {chips.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
          {chips.map((chip) => (
            <span key={chip} style={{ fontSize: 11.5, fontWeight: 500, color: color.inkSoft, background: color.surfaceMuted, borderRadius: radius.pill, padding: '3px 10px' }}>
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      <p style={{ fontSize: 13, color: color.body, lineHeight: 1.6, margin: '10px 0 0' }}>{request.details}</p>
      <div style={{ fontSize: 11.5, color: color.faint, marginTop: 8 }}>
        Requested by {[request.name, request.org, request.email].filter(Boolean).join(' · ') || 'Sales workspace'} · {request.at || '—'}
      </div>

      <div
        style={{
          marginTop: 12,
          background: color.fieldBg,
          border: `1px solid ${color.hairlineSoft}`,
          borderRadius: 10,
          padding: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10,
          alignItems: 'flex-end'
        }}
      >
        <Field label="Hours" hint="Enter the hours returned by the team — they join the total" type="number" min={0} mono value={hoursValue} onChange={setHours} placeholder="0" />
        <Field label="Repeat h" type="number" min={0} mono value={repeat} onChange={setRepeat} placeholder="same" />
        <Select label="Belongs to bundle" value={bundleId} options={bundleOptions} onChange={setBundleId} />
        <Select
          label="Delivery form"
          value={form}
          options={['Custom development', 'Plugin / extension', 'Theme / branding', 'MFE customization', 'Service integration', 'Configuration'].map((value) => ({ value, label: value }))}
          onChange={setForm}
        />
        <Field label="Std deploy" value={deploy} onChange={setDeploy} placeholder="e.g. 2–3 days" />
        <Field label="Category" value={category} onChange={setCategory} list="edly-categories" placeholder="e.g. Core Platform" />
        <Field label="Sub-category" value={subCategory} onChange={setSubCategory} list="edly-subcategories" placeholder="e.g. Custom" />
        <Field label="Integrations / vendors" value={integrations} onChange={setIntegrations} placeholder="e.g. MS Graph API, Zoom" />
        <Field label="3rd-party account (client-held)" value={account} onChange={setAccount} placeholder="e.g. Stripe, Zoom — or leave blank" />
        <Field label="Notes &amp; limits (goes to the catalog)" value={limits} onChange={setLimits} placeholder="Scope boundaries future clients must know" />
        <Field label="Note to sales (optional)" value={note} onChange={setNote} placeholder="Assumptions, exclusions, risks…" />
      </div>

      <Row gap={10} style={{ marginTop: 12 }}>
        <Button tone="primary" onClick={submit}>
          {done ? 'Update estimate' : 'Submit estimate'}
        </Button>
        {error ? <span style={{ fontSize: 12, fontWeight: 600, color: color.redInk }}>{error}</span> : null}
        <Spacer />
        {done ? (
          <span style={{ fontSize: 12, fontWeight: 600, color: color.brandInk }}>
            Estimated {hours(Number(request.est))} h · by {request.estBy ?? 'estimator'}
            {request.estAt ? ` · ${request.estAt}` : ''} — live in the sales total
            {request.csId ? ` · reusable as ${request.csId} in ${request.catBundle || 'CX'}, tagged Estimation` : ''}
          </span>
        ) : null}
      </Row>
      <div style={{ fontSize: 11, color: color.faint, lineHeight: 1.55, marginTop: 8 }}>
        On submit this becomes a reusable catalog solution in the bundle you pick, tagged{' '}
        <span style={{ fontWeight: 700, color: color.violet }}>Estimation</span> — priced and scoped, not yet engineered — so the
        next client can select it without re-requesting.
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- estimations */

/** A deal on the desk list. Whole card is clickable, so it lifts. */
function DeskCard({ pending, onOpen, children }: { pending: number; onOpen: () => void; children: ReactNode }): JSX.Element {
  const hover = useRowHover({ borderColor: color.brand, boxShadow: shadow.card });
  return (
    <div
      onClick={onOpen}
      {...hover.bind}
      style={{
        background: color.surface,
        border: `1px solid ${pending > 0 ? color.amberEdge : color.hairline}`,
        borderRadius: radius.lg,
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'border-color 140ms ease, box-shadow 140ms ease',
        ...hover.style
      }}
    >
      {children}
    </div>
  );
}

function EstimationList(): JSX.Element {
  const { state, dispatch, catalog } = useApp();
  const estimations = platformEstimations(state)
    .slice()
    .sort((a, b) => String(b.up).localeCompare(String(a.up)));

  if (estimations.length === 0) {
    return (
      <DeskEmpty>No estimations yet — they appear here as soon as sales creates one.</DeskEmpty>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12, marginTop: 18 }}>
      {estimations.map((estimation) => {
        const requests = requestsFor(state, estimation.id);
        const pending = requests.filter((request) => !(Number(request.est) > 0)).length;
        const style = tagStyle(estimation.tag);
        const due = dueInfo(estimation.due);
        const numbers = calcEstimate(catalog, estimation.snap, requests);

        return (
          <DeskCard key={estimation.id} pending={pending} onOpen={() => dispatch({ type: 'setDeskView', id: estimation.id })}>
            <div style={{ fontFamily: font.display, fontSize: 15.5, fontWeight: 600, lineHeight: 1.3 }}>{estimation.name}</div>
            {estimation.client ? <div style={{ fontSize: 12, color: color.muted, marginTop: 2 }}>{estimation.client}</div> : null}
            <div style={{ marginTop: 10 }}>
              <Mono size={11}>
                {hours(numbers.grand)} h · {plural(numbers.selIds.length, 'solution')} · {plural(requests.length, 'custom item')}
              </Mono>
            </div>
            <Row gap={6} style={{ marginTop: 10 }}>
              <Chip bg={style.bg} co={style.co}>
                {estimation.tag}
              </Chip>
              {due ? (
                <Chip bg={due.bg} co={due.co}>
                  {due.label}
                </Chip>
              ) : null}
            </Row>
            <Row gap={8} style={{ marginTop: 12 }}>
              <span style={{ fontSize: 11, color: color.faint }}>Updated {estimation.up || estimation.at}</span>
              <Spacer />
              {pending > 0 ? (
                <Chip bg={color.amberWash} co={color.amber}>
                  {pending} awaiting your estimate
                </Chip>
              ) : null}
              <span style={{ fontSize: 12, fontWeight: 700, color: color.brandDeep }}>Open estimation page ›</span>
            </Row>
          </DeskCard>
        );
      })}
    </div>
  );
}

function EstimationPage({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const { state, catalog } = useApp();
  const estimation = state.estimations.find((candidate) => candidate.id === id);
  const requests = requestsFor(state, id);

  if (!estimation) {
    return (
      <>
        <Button onClick={onBack}>← Back to desk</Button>
        <div style={{ marginTop: 18 }}>
          <Empty title="That estimation is gone" body="It was deleted or moved to another platform." />
        </div>
      </>
    );
  }

  const numbers = calcEstimate(catalog, estimation.snap, requests);
  const pending = requests.filter((request) => !(Number(request.est) > 0)).length;
  const currency = estimation.snap.cur ?? 'USD';
  const buffers = estimation.snap.buf ?? {};
  const pageDue = dueInfo(estimation.due);

  const totals: { label: string; value: string }[] = [{ label: 'Solution hours', value: `${hours(numbers.first)} h` }];
  if (requests.length > 0) {
    totals.push({
      label: `Custom development${pending > 0 ? ` · ${pending} pending` : ''}`,
      value: numbers.estSum > 0 ? `+${hours(numbers.estSum)} h` : 'awaiting your hours'
    });
  }
  if (numbers.bufH > 0) totals.push({ label: `Risk buffer${numbers.bufPct ? ` (incl. ${numbers.bufPct}%)` : ''}`, value: `+${hours(numbers.bufH)} h` });
  if (numbers.pm > 0) totals.push({ label: `PM overhead (${numbers.pm}%)`, value: `+${hours(numbers.pmH)} h` });
  if (numbers.qa > 0) totals.push({ label: `QA overhead (${numbers.qa}%)`, value: `+${hours(numbers.qaH)} h` });

  return (
    <>
      <BackPill onClick={onBack}>← Back to desk</BackPill>

      <div style={{ marginTop: 14, background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: radius.lg, padding: '20px 22px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <h1 style={{ fontFamily: font.display, fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>{estimation.name}</h1>
          {estimation.client ? <span style={{ fontSize: 13, color: color.muted }}>{estimation.client}</span> : null}
          <Spacer />
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              borderRadius: radius.pill,
              padding: '4px 11px',
              background: tagStyle(estimation.tag).bg,
              color: tagStyle(estimation.tag).co
            }}
          >
            {estimation.tag}
          </span>
          {pageDue ? (
            <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: radius.pill, padding: '4px 11px', background: pageDue.bg, color: pageDue.co }}>
              {pageDue.label}
            </span>
          ) : null}
        </div>
        <div style={{ fontFamily: font.mono, fontSize: 11.5, color: color.muted, marginTop: 10 }}>
          {hours(numbers.grand)} h · {plural(numbers.selIds.length, 'solution')} · {plural(requests.length, 'custom item')}
          {pending > 0 ? ` · ${pending} pending` : ''} · updated {estimation.up || estimation.at}
        </div>
      </div>

      {pending > 0 ? (
        <div style={{ marginTop: 12 }}>
          <Banner tone="warn">
            {plural(pending, 'custom item')} in this estimation {pending === 1 ? 'is' : 'are'} waiting on your hours — the sales
            total updates the moment you send them.
          </Banner>
        </div>
      ) : null}

      <div style={{ marginTop: 16, background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: radius.lg, padding: '18px 22px' }}>
        <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 600 }}>Solutions selected by sales · {numbers.selIds.length}</div>
        <div style={{ fontSize: 12, color: color.faint, lineHeight: 1.5, marginTop: 2 }}>
          The pre-built work already priced from the catalog — context for whatever you are asked to estimate below.
        </div>
        {numbers.groups.length === 0 ? (
          <div style={{ fontSize: 12.5, color: color.muted, marginTop: 10 }}>
            No pre-built solutions selected yet in this estimation — everything here is custom work.
          </div>
        ) : null}
        {numbers.groups.map((group) => (
          <div key={group.id} style={{ marginTop: 14 }}>
            <Row gap={8} align="baseline" style={{ background: color.surfaceSoft, borderRadius: radius.sm, padding: '7px 11px' }}>
              <Mono size={10.5} tone={color.brandDeep}>
                {group.id}
              </Mono>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{group.name}</span>
              <span style={{ fontSize: 11, color: color.faint }}>{plural(group.items.length, 'solution')}</span>
              <Spacer />
              <Mono size={12} tone={color.ink}>
                {hours(group.first)} h
              </Mono>
            </Row>
            {group.items.map((item) => (
              <div key={item.id} style={{ borderBottom: `1px solid ${color.surfaceMuted}`, padding: '9px 11px 8px' }}>
                <Row gap={8} align="baseline">
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{item.name}</span>
                  <Mono size={10} tone={color.ghost}>
                    {item.id}
                  </Mono>
                  {Number(buffers[item.id]) > 0 ? (
                    <Chip bg={color.amberWash} co={color.amberInk}>
                      +{hours(Number(buffers[item.id]))} h buffer
                    </Chip>
                  ) : null}
                  <Spacer />
                  <Mono size={12} tone={item.first === null ? color.amber : color.ink}>
                    {item.first === null ? (item.status === 'In Development' ? 'in development' : 'no estimate') : `${hours(item.first)} h`}
                  </Mono>
                </Row>
                <div style={{ fontSize: 12.5, color: color.body, lineHeight: 1.55, marginTop: 3 }}>{item.desc}</div>
                <div style={{ fontSize: 11, color: color.faint, lineHeight: 1.5, marginTop: 3 }}>
                  {[
                    item.form,
                    item.repeat !== null ? `${hours(item.repeat)} h repeat` : null,
                    item.deploy && item.deploy !== 'Not recorded' ? `Deploy ${item.deploy}` : null,
                    item.account ? `Client account: ${item.account}` : null,
                    item.integrations ? `Integrations: ${item.integrations}` : null
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {numbers.selIds.length > 0 || requests.length > 0 ? (
        <div style={{ marginTop: 16, background: color.dark, color: color.onSolid, borderRadius: radius.lg, padding: '18px 22px' }}>
          <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 600 }}>Where this estimation stands</div>
          {totals.map((line) => (
            <Row key={line.label} gap={12} style={{ marginTop: 7 }} wrap={false}>
              <span style={{ flex: 1, fontSize: 12.5, color: color.onDarkMuted }}>{line.label}</span>
              <Mono size={12} tone={color.onDark}>
                {line.value}
              </Mono>
            </Row>
          ))}
          <Row gap={12} align="baseline" style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${color.onDarkRule}` }} wrap={false}>
            <span style={{ fontSize: 12, color: color.onDarkMuted }}>Total estimate</span>
            <Spacer />
            <span style={{ fontFamily: font.display, fontSize: 27, fontWeight: 700 }}>{hours(numbers.grand)} h</span>
          </Row>
          <div style={{ textAlign: 'right', fontSize: 11.5, color: color.onDarkFaint }}>
            ≈ {hours1(numbers.days)} person-days · {hours1(numbers.weeks)} working weeks
          </div>
          {numbers.assignedH > 0 ? (
            <div style={{ borderTop: `1px solid ${color.onDarkRule}`, marginTop: 12, paddingTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: color.onDarkFaint }}>Cost by role</div>
              {numbers.roleRows.map((row) => (
                <Row key={row.id} gap={8} align="baseline" style={{ marginTop: 6 }} wrap={false}>
                  <span style={{ width: 7, height: 7, borderRadius: radius.pill, background: row.color, flex: '0 0 auto' }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: color.onDarkSoft }}>{row.name}</span>
                  <Mono size={10.5} tone={color.onDarkFaint}>
                    {hours(row.hrs)} h × {money(row.rate, currency)}
                  </Mono>
                  <Mono size={11.5} tone={color.onDark}>
                    {money(row.cost, currency)}
                  </Mono>
                </Row>
              ))}
              <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: color.brandGlow, marginTop: 8 }}>
                {money(numbers.usd, currency)} at {money(numbers.effRate, currency)}/h blended
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 600, marginTop: 24 }}>
        Custom items requested in this estimation · {requests.length}
      </div>
      {requests.length === 0 ? (
        <div style={{ marginTop: 10 }}>
          <Empty title="Nothing custom requested here yet" body="Nothing custom requested here yet — this estimation is pre-built solutions only." />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------- add to catalog */

function AddToCatalog(): JSX.Element {
  const { state, dispatch, catalog } = useApp();
  const [solution, setSolution] = useState({
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
    limits: '',
    note: ''
  });
  const [bundle, setBundle] = useState({ name: '', pitch: '', offerWhen: '' });
  const [solutionError, setSolutionError] = useState('');
  const [bundleError, setBundleError] = useState('');

  const bundleOptions = useMemo(
    () => [
      ...catalog.bundles.map((entry) => ({ value: entry.id, label: `${entry.id} · ${entry.name}` })),
      ...(catalog.bundles.some((entry) => entry.id === 'CX') ? [] : [{ value: 'CX', label: 'CX · Estimated solutions (new group)' }])
    ],
    [catalog.bundles]
  );

  const ownBundles = state.bundles.filter((entry) => (entry.plat || 'openedx') === (state.platform || 'openedx'));
  const added = state.solutions.filter((entry) => (entry.plat || 'openedx') === (state.platform || 'openedx'));

  const addSolution = (): void => {
    const first = Number(solution.first);
    if (!solution.name.trim()) {
      setSolutionError('Give the solution a name.');
      return;
    }
    if (!(first > 0)) {
      setSolutionError('Enter the first-delivery hours.');
      return;
    }
    setSolutionError('');
    dispatch({
      type: 'addSolution',
      input: {
        name: solution.name.trim(),
        desc: solution.desc.trim(),
        first,
        repeat: Number(solution.repeat) > 0 ? Number(solution.repeat) : first,
        bundleId: solution.bundleId || guessBundle(catalog, solution.category) || 'CX',
        form: solution.form,
        deploy: solution.deploy.trim(),
        integrations: solution.integrations.trim(),
        category: solution.category.trim() || 'Custom',
        subCategory: solution.subCategory.trim(),
        account: solution.account.trim(),
        limits: solution.limits.trim(),
        note: solution.note.trim()
      }
    });
    setSolution({ ...solution, name: '', desc: '', first: '', repeat: '', deploy: '', limits: '', note: '' });
  };

  const addBundle = (): void => {
    if (!bundle.name.trim()) {
      setBundleError('Name the bundle — “Deployment & Infrastructure”, for example.');
      return;
    }
    if (catalog.bundles.some((entry) => entry.name.toLowerCase() === bundle.name.trim().toLowerCase())) {
      setBundleError(`A bundle called “${bundle.name.trim()}” already exists.`);
      return;
    }
    setBundleError('');
    dispatch({ type: 'addBundle', name: bundle.name.trim(), pitch: bundle.pitch.trim(), offerWhen: bundle.offerWhen.trim() });
    setBundle({ name: '', pitch: '', offerWhen: '' });
  };

  const set = (key: keyof typeof solution) => (value: string) => setSolution((prev) => ({ ...prev, [key]: value }));

  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 18 }}>
      <datalist id="edly-categories">
        {categories(catalog).map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="edly-subcategories">
        {subCategories(catalog).map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>

      <section style={{ background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: radius.lg, padding: '18px 22px' }}>
        <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 600 }}>New feature estimation</div>
        <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.6, marginTop: 3, maxWidth: 620 }}>
          Price something the team knows how to build without waiting for sales to request it. It joins the catalog tagged{' '}
          <span style={{ fontWeight: 700, color: color.violet }}>Estimation</span> and is selectable in every future estimation.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 14 }}>
          <Field label="Custom feature name" value={solution.name} onChange={set('name')} placeholder="e.g. Blue-green deployment pipeline" />
          <Field label="First delivery h" type="number" min={0} mono value={solution.first} onChange={set('first')} placeholder="0" />
          <Field label="Repeat h" type="number" min={0} mono value={solution.repeat} onChange={set('repeat')} placeholder="same" />
        </div>
        <div style={{ marginTop: 10 }}>
          <Field label="What it does" value={solution.desc} onChange={set('desc')} placeholder="One line a salesperson can read to a client" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 10 }}>
          <Select
            label="Belongs to bundle"
            value={solution.bundleId || guessBundle(catalog, solution.category) || 'CX'}
            options={bundleOptions}
            onChange={(value) => setSolution((prev) => ({ ...prev, bundleId: value }))}
          />
          <Select
            label="Delivery form"
            value={solution.form}
            options={['Custom development', 'Plugin / extension', 'Theme / branding', 'MFE customization', 'Service integration', 'Configuration'].map((value) => ({ value, label: value }))}
            onChange={(value) => setSolution((prev) => ({ ...prev, form: value }))}
          />
          <Field label="Std deploy" value={solution.deploy} onChange={set('deploy')} placeholder="e.g. 2–3 days" />
          <Field label="Category" value={solution.category} onChange={set('category')} list="edly-categories" placeholder="e.g. Core Platform" />
          <Field label="Sub-category" value={solution.subCategory} onChange={set('subCategory')} list="edly-subcategories" placeholder="e.g. Custom" />
          <Field label="Integrations / vendors" value={solution.integrations} onChange={set('integrations')} placeholder="e.g. MS Graph API, Zoom" />
          <Field label="3rd-party account (client-held)" value={solution.account} onChange={set('account')} placeholder="e.g. Stripe, Zoom — or leave blank" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
          <Field label="Notes &amp; limits (goes to the catalog)" value={solution.limits} onChange={set('limits')} placeholder="Scope boundaries future clients must know" />
          <Field label="Note to sales (optional)" value={solution.note} onChange={set('note')} placeholder="Assumptions, exclusions, risks…" />
        </div>
        <Row gap={10} style={{ marginTop: 14 }}>
          <Button tone="primary" onClick={addSolution}>
            Add estimated solution
          </Button>
          {solutionError ? <span style={{ fontSize: 12, fontWeight: 600, color: color.redInk }}>{solutionError}</span> : null}
        </Row>
      </section>

      <section style={{ background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: radius.lg, padding: '18px 22px' }}>
        <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 600 }}>New bundle category</div>
        <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.6, marginTop: 3, maxWidth: 620 }}>
          For a class of work the master sheet has no bundle for yet — Deployment &amp; Infrastructure, Data Migration, and so
          on. It appears in the sales sidebar and in the bundle picker above.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 14 }}>
          <Field label="Bundle name" value={bundle.name} onChange={(value) => setBundle((prev) => ({ ...prev, name: value }))} placeholder="e.g. Deployment & Infrastructure" />
          <Field label="What it delivers" value={bundle.pitch} onChange={(value) => setBundle((prev) => ({ ...prev, pitch: value }))} placeholder="The pitch sales reads to a client" />
          <Field label="Offer when they ask about" value={bundle.offerWhen} onChange={(value) => setBundle((prev) => ({ ...prev, offerWhen: value }))} placeholder="e.g. zero-downtime releases" />
        </div>
        <Row gap={10} style={{ marginTop: 14 }}>
          <Button tone="brand" onClick={addBundle}>
            Add bundle
          </Button>
          {bundleError ? <span style={{ fontSize: 12, fontWeight: 600, color: color.redInk }}>{bundleError}</span> : null}
        </Row>
        {ownBundles.length === 0 ? (
          <div style={{ fontSize: 12, color: color.faint, borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 12, paddingTop: 10 }}>
            No extra bundles yet — the ones from the master sheet are all in play.
          </div>
        ) : (
          ownBundles.map((entry) => (
            <Row key={entry.id} gap={10} style={{ borderTop: `1px solid ${color.hairlineSoft}`, padding: '10px 0 8px', marginTop: 4 }}>
              <Mono size={10.5} tone={color.brandDeep}>
                {entry.id}
              </Mono>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{entry.name}</span>
              <span style={{ fontSize: 11, color: color.faint }}>
                {plural(catalog.bundles.find((candidate) => candidate.id === entry.id)?.items.length ?? 0, 'solution')} · added {entry.at || today()}
              </span>
              <Spacer />
              <Button
                size="sm"
                tone="danger"
                title="Remove this bundle"
                onClick={() => {
                  if (added.some((candidate) => candidate.bundleId === entry.id)) {
                    setBundleError('That bundle still holds estimated solutions — move or delete them first.');
                    return;
                  }
                  dispatch({ type: 'removeBundle', id: entry.id });
                }}
              >
                Remove
              </Button>
            </Row>
          ))
        )}
      </section>

      <section style={{ background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: radius.lg, padding: '18px 22px' }}>
        <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 600 }}>Estimated solutions in the catalog</div>
        {added.length === 0 ? (
          <div style={{ fontSize: 12.5, color: color.muted, marginTop: 8 }}>
            Nothing yet. Anything you estimate here or in the request queue shows up in this list.
          </div>
        ) : (
          added.map((entry) => (
            <Row key={entry.id} gap={10} style={{ borderTop: `1px solid ${color.hairlineSoft}`, padding: '10px 0 8px', marginTop: 4 }}>
              <Chip bg={color.violetWash} co={color.violet}>
                {entry.id}
              </Chip>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{entry.name}</span>
              <span style={{ fontSize: 11, color: color.faint }}>
                {catalog.bundles.find((candidate) => candidate.id === entry.bundleId)?.name ?? entry.bundleId} ·{' '}
                {entry.direct ? 'Added here' : `From request ${entry.from || '—'}`}
              </span>
              <Spacer />
              <Mono size={11}>
                {hours(entry.first)} h first · {hours(entry.repeat)} h repeat
              </Mono>
              <Button size="sm" tone="danger" title="Remove from the catalog" onClick={() => dispatch({ type: 'removeSolution', id: entry.id })}>
                Remove
              </Button>
            </Row>
          ))
        )}
      </section>
    </div>
  );
}
