import { useMemo, useRef, useState } from 'react';
import { useApp } from '@/state/AppProvider';
import { catalogSourceLabel, openEstimationRecord } from '@/state/reducer';
import { allSolutions } from '@/domain/catalog';
import { color, dueInfo, font, radius, tagStyle } from '@/theme';
import { hours } from '@/lib/format';
import { findPlatform } from '@/data/practices';
import { useLayout } from '@/lib/useViewport';
import { EDLY_LINKS } from '@/data/nav';
import { Button, Link, SearchInput } from '@/components/ui';
import { HeaderPill, UserChip } from '@/components/AppHeader';
import { useHover } from '@/lib/useHover';
import { BundleHeader, BundleRail, railEntries } from '@/components/builder/BundleRail';
import { CatalogTable, type CatalogRow } from '@/components/builder/CatalogTable';
import { CatalogPanel } from '@/components/builder/CatalogPanel';
import { DisplayPanel } from '@/components/builder/DisplayPanel';
import { Hero } from '@/components/builder/Hero';
import { Planner } from '@/components/builder/Planner';
import { RatesPanel } from '@/components/builder/RatesPanel';
import { RequestModal } from '@/components/builder/RequestModal';
import { SummaryPanel } from '@/components/builder/SummaryPanel';

/**
 * The bundle builder: a three-column app shell under the hero.
 *
 *   rail (bundles) | catalog table | dark estimate panel
 *
 * Each column scrolls independently at desktop width, so the rail and the running total stay put
 * while the catalog scrolls. Below ~1020px the whole thing becomes one stacked column and the
 * rail turns into a wrapping row of chips.
 */

const ALL = 'ALL';
/** Matches shown before the list is truncated, as in the source design. */
const SEARCH_LIMIT = 60;
const HEADER_H = 62;

export function Builder(): JSX.Element {
  const { state, dispatch, catalog, estimate, display } = useApp();
  const estimation = openEstimationRecord(state);
  const layout = useLayout();
  const { narrow } = layout;

  /* Empty means "the first bundle": the builder opens on a bundle, not on the whole catalogue,
     and the catalogue is not loaded yet on the first render. */
  const [active, setActive] = useState<string>('');
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<'' | 'rates' | 'catalog' | 'display'>('');
  const [catalogFlash, setCatalogFlash] = useState(false);
  const [requestFlash, setRequestFlash] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const everySolution = useMemo(() => allSolutions(catalog), [catalog]);
  const searching = search.trim().length > 0;

  const rows = useMemo<CatalogRow[]>(() => {
    const flat: CatalogRow[] = [];
    for (const bundle of catalog.bundles) {
      for (const item of bundle.items) flat.push({ item, bundleId: bundle.id, bundleName: bundle.name });
    }
    if (searching) {
      const needle = search.trim().toLowerCase();
      /* The haystack is deliberately wide — people search by bundle, by the phrase a client used
         ("offer when they ask about…"), or by an integration name, not just the solution title.
         Capped at 60 so a one-letter query cannot render the whole catalogue. */
      const byId = new Map(catalog.bundles.map((bundle) => [bundle.id, bundle]));
      const out: CatalogRow[] = [];
      for (const row of flat) {
        if (out.length >= SEARCH_LIMIT) break;
        const bundle = byId.get(row.bundleId);
        const hay = [
          row.item.name,
          row.item.id,
          row.item.desc,
          row.item.category ?? '',
          row.item.subCategory ?? '',
          bundle?.name ?? '',
          bundle?.offerWhen ?? '',
          row.item.integrations ?? ''
        ]
          .join(' ')
          .toLowerCase();
        if (hay.includes(needle)) out.push(row);
      }
      return out;
    }
    if (active === ALL) return flat;
    const bundle = catalog.bundles.find((entry) => entry.id === active) ?? catalog.bundles[0];
    return bundle ? flat.filter((row) => row.bundleId === bundle.id) : flat;
  }, [catalog, active, search, searching]);

  const activeBundle = active === ALL ? null : (catalog.bundles.find((bundle) => bundle.id === active) ?? catalog.bundles[0] ?? null);
  const platformRef = findPlatform(state.platform);
  const platformLabel = platformRef?.platform.name ?? '';
  const crumb = platformRef ? `${platformRef.practice.name} / ${platformRef.platform.name}` : '';

  const estChipLabel = estimation ? estimation.name + (estimation.client ? ` · ${estimation.client}` : '') : '';
  const due = dueInfo(estimation?.due);

  const entries = railEntries(catalog.bundles, everySolution, state.draft.sel);
  const bundleStat = activeBundle
    ? [
        display.savings && activeBundle.buildHrs !== null ? `Engineered ${hours(activeBundle.buildHrs)} h` : null,
        `Est. delivery ${hours(activeBundle.firstHrs)} h`,
        display.savings && activeBundle.saved !== null ? `Saves ${Math.round(activeBundle.saved * 100)}%` : null
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const goBundle = (id: string): void => {
    setSearch('');
    setActive(id);
  };


  return (
    <div style={{ background: color.page }}>
      <Hero onBuild={() => window.scrollTo({ top: shellRef.current?.offsetTop ?? 0, behavior: 'smooth' })} />

      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          minHeight: HEADER_H,
          background: color.surface,
          borderBottom: `1px solid ${color.hairline}`,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '10px 18px',
          padding: '10px 20px'
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 27, letterSpacing: -0.5, color: color.ink, lineHeight: 1 }}>edly</div>
          <div style={{ width: 1, height: 24, background: color.hairline }} />
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: color.muted }}>Bundle Builder</div>
          <BackToHub onClick={() => dispatch({ type: 'closeEstimation' })} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: color.brandDeep,
              background: color.brandWash,
              borderRadius: radius.pill,
              padding: '7px 13px',
              maxWidth: 230,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {estChipLabel}
          </span>
          {estimation?.tag ? (
            <span style={{ fontSize: 11, fontWeight: 700, borderRadius: radius.pill, padding: '5px 11px', background: tagStyle(estimation.tag).bg, color: tagStyle(estimation.tag).co }}>
              {estimation.tag}
            </span>
          ) : null}
          {due ? (
            <span style={{ fontSize: 11, fontWeight: 700, borderRadius: radius.pill, padding: '5px 11px', background: due.bg, color: due.co }}>{due.label}</span>
          ) : null}
        </div>

        <div style={{ flex: '1 1 240px', display: 'flex', justifyContent: 'center' }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Search ${everySolution.length} ${platformLabel} solutions…`}
            style={{ width: '100%', maxWidth: 460, height: 38, padding: '0 18px', fontSize: 13.5, background: color.fieldBg }}
          />
        </div>

        <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <UserChip>
            {state.auth?.user ?? ''} · {state.auth?.role === 'estimator' ? 'Estimator' : 'Sales'}
          </UserChip>
          <HeaderPill onClick={() => dispatch({ type: 'switchRole' })}>⇄ Estimation desk</HeaderPill>
          <HeaderPill danger onClick={() => dispatch({ type: 'signOut' })}>
            Logout
          </HeaderPill>
          <span
            title="Practice and platform in play — switch from the estimations hub"
            style={{ fontSize: 11, color: color.brandDeep, background: color.brandWash, borderRadius: radius.pill, padding: '6px 12px', whiteSpace: 'nowrap' }}
          >
            {crumb}
          </span>
          <HeaderPill
            title="Catalog source — the master .xlsx this tool reads its solutions and hours from"
            on={panel === 'catalog'}
            onClick={() => setPanel(panel === 'catalog' ? '' : 'catalog')}
          >
            {catalogFlash ? '✓ Catalog updated' : state.autoAvail ? '📚 Catalog •' : '📚 Catalog'}
          </HeaderPill>
          {panel === 'catalog' ? (
            <CatalogPanel
              onClose={() => setPanel('')}
              onLoaded={() => {
                setCatalogFlash(true);
                window.setTimeout(() => setCatalogFlash(false), 2200);
              }}
            />
          ) : null}
          {!state.presenting ? (
            <HeaderPill
              title="Rate card — price senior, DevOps and QA hours separately instead of one blended rate"
              on={panel === 'rates'}
              onClick={() => setPanel(panel === 'rates' ? '' : 'rates')}
            >
              💲 Rates{estimate.assignedH > 0 ? ` · ${hours(estimate.assignedH)} h priced` : ''}
            </HeaderPill>
          ) : null}
          {panel === 'rates' ? <RatesPanel onClose={() => setPanel('')} /> : null}
          <PresentButton on={state.presenting} onClick={() => dispatch({ type: 'togglePresenting' })} />
          <HeaderPill on={panel === 'display'} onClick={() => setPanel(panel === 'display' ? '' : 'display')}>
            ⚙ Display
          </HeaderPill>
          {panel === 'display' ? <DisplayPanel onClose={() => setPanel('')} /> : null}
        </div>
      </header>

      <div
        ref={shellRef}
        style={{
          height: layout.shellHeight,
          display: 'grid',
          gridTemplateColumns: layout.shellCols,
          minHeight: 0
        }}
      >
        <BundleRail
          entries={entries}
          active={searching ? '' : active || catalog.bundles[0]?.id || ALL}
          narrow={narrow}
          metaLine={`${everySolution.length} solutions · ${catalog.bundles.length} bundles · ${hours(catalog.meta.totals.buildHrs ?? 0)} h engineered`}
          metaFoot={
            state.presenting
              ? `Catalog compiled ${catalog.meta.compiled || '—'}`
              : `Compiled ${catalog.meta.compiled || '—'} · ${catalogSourceLabel(state)}`
          }
          estimationLabel={estimation?.name ?? ''}
          onPick={(key) => {
            setSearch('');
            setActive(key);
          }}
          onBack={() => dispatch({ type: 'closeEstimation' })}
        />

        <main style={{ overflowY: layout.paneOverflow, minWidth: 0, padding: layout.mainPad }}>
          {searching ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: font.display, fontSize: 21, fontWeight: 600 }}>Search results</div>
              <div style={{ fontSize: 13, color: color.muted, marginTop: 2 }}>
                {rows.length}
                {rows.length === SEARCH_LIMIT ? '+' : ''} matches across all bundles
              </div>
            </div>
          ) : null}

          {!searching && active === ALL ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: font.display, fontSize: 21, fontWeight: 600 }}>All solutions</div>
              <div style={{ fontSize: 13, color: color.muted, marginTop: 2 }}>Every solution à la carte — tick any to add it to your bundle.</div>
            </div>
          ) : null}

          {!searching && activeBundle ? (
            <BundleHeader
              bundle={activeBundle}
              selectedCount={activeBundle.items.filter((item) => state.draft.sel[item.id]).length}
              stat={bundleStat}
              onSelectAll={() => dispatch({ type: 'selectMany', ids: activeBundle.items.map((item) => item.id), selected: true })}
              onClear={() => dispatch({ type: 'selectMany', ids: activeBundle.items.map((item) => item.id), selected: false })}
              onGoBundle={goBundle}
            />
          ) : null}

          <CatalogTable rows={rows} narrow={narrow} showBundleTag={searching || active === ALL} onGoBundle={goBundle}>
            {rows.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', fontSize: 13.5, color: color.muted, borderTop: `1px solid ${color.hairlineSoft}` }}>
                No matches in our pre-built catalog — try a broader term like payments, SSO or analytics.
                <br />
                Or go custom: Edly builds bespoke Open edX solutions for exactly this.{' '}
                <Link href={EDLY_LINKS.contact} style={{ color: color.brandDeep, fontWeight: 700 }} hover={{ color: color.red, textDecoration: 'underline' }}>
                  Contact us
                </Link>
                <div style={{ marginTop: 14 }}>
                  <Button tone="primary" onClick={() => setRequestOpen(true)} style={{ borderRadius: 9, padding: '11px 20px', fontSize: 12.5 }}>
                    Request an estimate for “{search.trim()}”
                  </Button>
                </div>
              </div>
            ) : null}
          </CatalogTable>

          <div
            style={{
              maxWidth: 1000,
              marginTop: 18,
              background: color.brandWash,
              border: `1px solid ${color.brandEdgePale}`,
              borderRadius: radius.lg,
              padding: '18px 22px',
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              flexWrap: 'wrap'
            }}
          >
            <div style={{ flex: 1, minWidth: 300 }}>
              <div style={{ fontFamily: font.display, fontSize: 15.5, fontWeight: 600, color: color.brandInk }}>
                Don’t see what you need? These are only our pre-built solutions.
              </div>
              <div style={{ fontSize: 13, color: color.brandInkSoft, lineHeight: 1.55, marginTop: 3 }}>
                Edly designs and builds fully custom Open edX features, integrations and platforms — anything not in this catalog, we
                scope and deliver for you.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link
                href={EDLY_LINKS.customSolutions}
                hover={{ background: color.redDeep, color: color.onSolid }}
                style={{ background: color.red, color: color.onSolid, borderRadius: 8, padding: '10px 16px', fontSize: 12.5, fontWeight: 700 }}
              >
                Custom development
              </Link>
              <Link
                href={EDLY_LINKS.contact}
                hover={{ background: color.redWash, color: color.redInk }}
                style={{ border: `1.5px solid ${color.red}`, color: color.redInk, borderRadius: 8, padding: '9px 16px', fontSize: 12.5, fontWeight: 700 }}
              >
                Contact us
              </Link>
              <Button
                onClick={() => setRequestOpen(true)}
                hover={{ background: color.black }}
                style={{ background: color.ink, color: color.onSolid, border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 12.5, fontWeight: 700 }}
              >
                Request an estimate
              </Button>
            </div>
          </div>

          {display.notes && !searching && catalog.meta.notes.length > 0 ? (
            <div style={{ maxWidth: 1000, marginTop: 18, padding: '14px 18px', background: color.surfaceSoft, border: `1px dashed ${color.hairline}`, borderRadius: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: color.ghostCool, marginBottom: 6 }}>
                How to read these numbers — internal
              </div>
              {catalog.meta.notes.map((note) => (
                <p key={note} style={{ fontSize: 11.5, color: color.muted, lineHeight: 1.6, margin: '4px 0', textWrap: 'pretty' }}>
                  {note}
                </p>
              ))}
            </div>
          ) : null}
        </main>

        <aside
          style={{
            background: color.dark,
            color: color.onSolid,
            overflowY: layout.paneOverflow,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0
          }}
        >
          <SummaryPanel
            onOpenPlanner={() => setPlannerOpen(true)}
            onOpenRequest={() => setRequestOpen(true)}
            requestAdded={requestFlash}
          />
        </aside>
      </div>

      <div style={{ height: 48, background: color.page }} />

      {plannerOpen ? <Planner onClose={() => setPlannerOpen(false)} /> : null}
      {requestOpen ? (
        <RequestModal
          onClose={() => setRequestOpen(false)}
          onSubmitted={() => {
            setRequestFlash(true);
            window.setTimeout(() => setRequestFlash(false), 2200);
          }}
        />
      ) : null}
    </div>
  );
}

/** The red outline pill that leaves the builder for the estimations hub. */
function BackToHub({ onClick }: { onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      title="Saved automatically — switch to another estimation"
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
        whiteSpace: 'nowrap',
        transition: 'background 120ms ease'
      }}
    >
      ← All estimations
    </button>
  );
}

/** Presenting mode: quiet until it is on, then solid red. */
function PresentButton({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title="One click before screen-sharing — hides savings, buffers, internal notes and estimation controls"
      style={{
        border: `1.5px solid ${on ? color.red : color.rule}`,
        cursor: 'pointer',
        borderRadius: radius.pill,
        padding: '7px 16px',
        fontSize: 12,
        fontWeight: 700,
        fontFamily: font.body,
        background: on ? color.red : 'transparent',
        color: on ? color.onSolid : color.muted,
        whiteSpace: 'nowrap',
        transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease'
      }}
    >
      {on ? '● Presenting' : 'Present to client'}
    </button>
  );
}
