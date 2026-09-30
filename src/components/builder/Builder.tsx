import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/state/AppProvider';
import { catalogSourceLabel, openEstimationRecord, salesLegalFor, showsSiteChrome } from '@/state/reducer';
import { ALL_BUNDLES } from '@/lib/router';
import { allSolutions, bundlesOfKind, kindCounts, solutionKind, type CatalogKind } from '@/domain/catalog';
import { isDemoEstimation } from '@/domain/demo';
import { ESTIMATION_STAGES, stageOf } from '@/domain/stages';
import { color, dueInfo, font, radius, tagStyle } from '@/theme';
import { hours } from '@/lib/format';
import { findPlatform } from '@/data/practices';
import { useLayout } from '@/lib/useViewport';
import { EDLY_LINKS } from '@/data/nav';
import { Button, DemoTag, Link, SearchInput } from '@/components/ui';
import { HeaderPill, UserChip } from '@/components/AppHeader';
import { AppLink, HomeLogo } from '@/components/Nav';
import { homeOf } from '@/lib/router';
import { useHover } from '@/lib/useHover';
import { BundleHeader, BundleRail, railEntries } from '@/components/builder/BundleRail';
import { CatalogTable, type CatalogRow } from '@/components/builder/CatalogTable';
import { CatalogPanel } from '@/components/builder/CatalogPanel';
import { DisplayPanel } from '@/components/builder/DisplayPanel';
import { Hero } from '@/components/builder/Hero';
import { KindFilter } from '@/components/builder/KindFilter';
import { ImportModal } from '@/components/ImportModal';
import { ImportHistory } from '@/components/ImportHistory';
import { Planner } from '@/components/builder/Planner';
import { RatesPanel } from '@/components/builder/RatesPanel';
import { RequestModal } from '@/components/builder/RequestModal';
import { SalesLegalPanel } from '@/components/builder/SalesLegalPanel';
import { SheetPanel } from '@/components/builder/SheetPanel';
import { SummaryPanel } from '@/components/builder/SummaryPanel';
import { StagePicker } from '@/components/stages';

/**
 * The bundle builder: a three-column app shell. While a deal is presented, the edly.io header
 * and the hero sit above it, because that is what the client sees; while sales works, it is the
 * tool alone and fills the window.
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
  const { state, dispatch, router, catalog, estimate, display } = useApp();
  const estimation = openEstimationRecord(state);
  const layout = useLayout();
  const { narrow } = layout;

  /* Which bundle, what is typed in the box and whether the planner is up all live in the URL, so
     a pasted link opens on the same screen the sender was looking at. Empty means "the first
     bundle": the builder opens on one, and the catalogue is not parsed yet on the first render. */
  const active = router.route.bundle ? (router.route.bundle.toLowerCase() === ALL_BUNDLES ? ALL : router.route.bundle) : '';
  const plannerOpen = Boolean(router.route.plan);
  const kind: CatalogKind | null = router.route.kind ?? null;

  /* The box is local so it stays instant, and the URL catches up a beat later — pushing a route
     per keystroke would bury the Back button and trip the browser's history-call throttle. */
  const [search, setSearch] = useState(router.route.q ?? '');
  const [panel, setPanel] = useState<'' | 'rates' | 'catalog' | 'display' | 'sheet' | 'legal'>('');
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [requestFlash, setRequestFlash] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const toolRef = useRef<HTMLDivElement | null>(null);

  /* Presenting opens on the hero, which is the pitch, and "Build your bundle" takes the client down
     to the tool. Stopping needs no scroll: the chrome above goes, and the tool is what is left. */
  const chrome = showsSiteChrome(state);
  useEffect(() => {
    if (chrome) window.scrollTo({ top: 0 });
  }, [chrome]);

  const routeSearch = router.route.q ?? '';
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (routeSearch !== search) router.navigate({ q: search || undefined });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [search, routeSearch, router]);

  /* Back and Forward move the search too, so the box has to follow the URL as well as lead it. */
  useEffect(() => {
    setSearch(routeSearch);
  }, [routeSearch]);

  const everySolution = useMemo(() => allSolutions(catalog), [catalog]);
  const counts = useMemo(() => kindCounts(catalog), [catalog]);
  const shownBundles = useMemo(() => bundlesOfKind(catalog.bundles, kind), [catalog.bundles, kind]);
  const shownSolutions = useMemo(() => shownBundles.flatMap((bundle) => bundle.items), [shownBundles]);
  const searching = search.trim().length > 0;

  const rows = useMemo<CatalogRow[]>(() => {
    const flat: CatalogRow[] = [];
    for (const bundle of catalog.bundles) {
      for (const item of bundle.items) {
        if (!kind || solutionKind(item) === kind) flat.push({ item, bundleId: bundle.id, bundleName: bundle.name });
      }
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
  }, [catalog, active, search, searching, kind]);

  const activeBundle = active === ALL ? null : (catalog.bundles.find((bundle) => bundle.id === active) ?? catalog.bundles[0] ?? null);
  const platformRef = findPlatform(state.platform);
  const platformLabel = platformRef?.platform.name ?? '';

  const estChipLabel = estimation ? estimation.name + (estimation.client ? ` · ${estimation.client}` : '') : '';
  const demo = estimation ? isDemoEstimation(estimation) : false;
  const openLegal = estimation ? salesLegalFor(state, estimation.id).filter((item) => item.status === 'open').length : 0;
  const due = dueInfo(estimation?.due);

  const entries = railEntries(shownBundles, shownSolutions, state.draft.sel);
  /* the bundle header lists what the table lists, so "Select all" never picks what the filter hides */
  const shownBundle = activeBundle ? { ...activeBundle, items: activeBundle.items.filter((item) => !kind || solutionKind(item) === kind) } : null;
  const hiddenInBundle = activeBundle && shownBundle ? activeBundle.items.length - shownBundle.items.length : 0;
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
    router.navigate({ bundle: id === ALL ? ALL_BUNDLES : id, q: undefined });
  };

  /* Switching to a kind the open bundle has none of shows every bundle of that kind instead of an
     empty table, since the bundle would also vanish from the rail. */
  const pickKind = (next: CatalogKind | null): void => {
    const empty = next && activeBundle && !activeBundle.items.some((item) => solutionKind(item) === next);
    router.navigate({ kind: next ?? undefined, ...(empty ? { bundle: ALL_BUNDLES } : {}) });
  };


  return (
    <div style={{ background: color.page }}>
      {chrome ? <Hero onBuild={() => window.scrollTo({ top: toolRef.current?.offsetTop ?? 0, behavior: 'smooth' })} /> : null}

      {/* The bar and the shell share one frame the height of the window, so the shell takes what the
          bar leaves. The bar wraps to a second row whenever its pills do not fit, as at 1440px, and
          the old fixed guess of 62px ran the shell, and the foot of the running total, past the bottom
          of the window. Narrow screens scroll as one page instead, with the bar pinned. */}
      <div ref={toolRef} style={{ display: 'flex', flexDirection: 'column', height: narrow ? undefined : '100vh' }}>
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 50,
            flex: '0 0 auto',
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
            <HomeLogo />
            <div style={{ width: 1, height: 24, background: color.hairline }} />
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: color.muted }}>Bundle Builder</div>
            <BackToHub onClick={() => router.navigate({ screen: 'hub', estimation: undefined })} />
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
            {demo ? <DemoTag /> : null}
            {estimation?.tag ? (
              <span style={{ fontSize: 11, fontWeight: 700, borderRadius: radius.pill, padding: '5px 11px', background: tagStyle(estimation.tag).bg, color: tagStyle(estimation.tag).co }}>
                {estimation.tag}
              </span>
            ) : null}
            {due ? (
              <span style={{ fontSize: 11, fontWeight: 700, borderRadius: radius.pill, padding: '5px 11px', background: due.bg, color: due.co }}>{due.label}</span>
            ) : null}
            {/* internal, like Rates: "Pending rates" is not something to screen-share to a client */}
            {estimation && !state.presenting ? (
              <StagePicker
                stages={ESTIMATION_STAGES}
                value={stageOf(estimation)}
                onChange={(stage) => dispatch({ type: 'patchEstimation', id: estimation.id, patch: { stage } })}
                variant="header"
                stepper
              />
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
            <HeaderPill onClick={() => router.navigate({ screen: 'desk', estimation: undefined })}>⇄ Estimation desk</HeaderPill>
            <HeaderPill danger onClick={() => dispatch({ type: 'signOut' })}>
              Logout
            </HeaderPill>
            {/* the practice and platform in play, each a way out: the practice to its platforms, the
                platform to its estimations */}
            {platformRef ? (
              <span style={{ fontSize: 11, color: color.brandDeep, background: color.brandWash, borderRadius: radius.pill, padding: '6px 12px', whiteSpace: 'nowrap' }}>
                <AppLink to={{ screen: 'practices', practice: platformRef.practice.id }} title="This practice’s platforms" hover={{ color: color.ink }}>
                  {platformRef.practice.name}
                </AppLink>
                <span aria-hidden="true" style={{ color: color.ghost, margin: '0 5px' }}>
                  /
                </span>
                <AppLink to={homeOf('sales', platformRef.platform.id)} title="All estimations on this platform" hover={{ color: color.ink }}>
                  {platformRef.platform.name}
                </AppLink>
              </span>
            ) : null}
            <HeaderPill
              title="Catalog source — the master .xlsx this tool reads its solutions and hours from"
              on={panel === 'catalog'}
              onClick={() => setPanel(panel === 'catalog' ? '' : 'catalog')}
            >
              {state.autoAvail ? '📚 Catalog •' : '📚 Catalog'}
            </HeaderPill>
            {panel === 'catalog' ? (
              <CatalogPanel
                onClose={() => setPanel('')}
                onImport={() => {
                  setPanel('');
                  setImportOpen(true);
                }}
                onHistory={() => {
                  setPanel('');
                  setHistoryOpen(true);
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
            {/* hidden while presenting, like Rates: it names the rate the sheet prices at */}
            {!state.presenting ? (
              <HeaderPill
                title="What goes in the downloaded Excel sheet: columns, sheets, notes"
                on={panel === 'sheet'}
                onClick={() => setPanel(panel === 'sheet' ? '' : 'sheet')}
              >
                Excel sheet
              </HeaderPill>
            ) : null}
            {panel === 'sheet' && !state.presenting ? <SheetPanel onClose={() => setPanel('')} /> : null}
            {/* hidden while presenting too: "must hold a state security certification" is not for the client */}
            {!state.presenting ? (
              <HeaderPill
                title="What this deal commits Edly to that is not software, for the sales, account and legal teams"
                on={panel === 'legal'}
                onClick={() => setPanel(panel === 'legal' ? '' : 'legal')}
              >
                Sales &amp; legal{openLegal > 0 ? ` · ${openLegal} open` : ''}
              </HeaderPill>
            ) : null}
          </div>
        </header>

        <div
          style={{
            flex: narrow ? undefined : '1 1 0',
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
            onPick={goBundle}
            onBack={() => router.navigate({ screen: 'hub', estimation: undefined })}
          />

          <main style={{ overflowY: layout.paneOverflow, minWidth: 0, padding: layout.mainPad }}>
            {/* internal, like Rates: the client being shown the demo does not need the tool explained */}
            {demo && !state.presenting ? <DemoBanner onReset={() => dispatch({ type: 'resetDemo' })} /> : null}
            <KindFilter kind={kind} counts={counts} onPick={pickKind} />

            {searching ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: font.display, fontSize: 21, fontWeight: 600 }}>Search results</div>
                <div style={{ fontSize: 13, color: color.muted, marginTop: 2 }}>
                  {rows.length}
                  {rows.length === SEARCH_LIMIT ? '+' : ''} matches across all bundles{kind ? `, ${kind} only` : ''}
                </div>
              </div>
            ) : null}

            {!searching && active === ALL ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: font.display, fontSize: 21, fontWeight: 600 }}>
                  {kind === 'estimates' ? 'All estimates' : kind === 'bundles' ? 'All bundle features' : 'All solutions'}
                </div>
                <div style={{ fontSize: 13, color: color.muted, marginTop: 2 }}>
                  {kind === 'estimates' ? 'Everything the desk has priced, à la carte. Tick any to add it.' : 'Every solution à la carte. Tick any to add it to your bundle.'}
                </div>
              </div>
            ) : null}

            {!searching && shownBundle ? (
              <BundleHeader
                bundle={shownBundle}
                selectedCount={shownBundle.items.filter((item) => state.draft.sel[item.id]).length}
                stat={bundleStat}
                onSelectAll={() => dispatch({ type: 'selectMany', ids: shownBundle.items.map((item) => item.id), selected: true })}
                onClear={() => dispatch({ type: 'selectMany', ids: shownBundle.items.map((item) => item.id), selected: false })}
                onGoBundle={goBundle}
              />
            ) : null}

            <CatalogTable rows={rows} narrow={narrow} showBundleTag={searching || active === ALL} onGoBundle={goBundle}>
              {rows.length === 0 && !searching && kind ? (
                <div style={{ padding: 40, textAlign: 'center', fontSize: 13.5, color: color.muted, borderTop: `1px solid ${color.hairlineSoft}`, lineHeight: 1.6 }}>
                  {activeBundle && hiddenInBundle > 0
                    ? `No ${kind} in ${activeBundle.name}. Show All to see its ${hiddenInBundle} ${kind === 'estimates' ? 'bundle features' : 'estimates'}.`
                    : kind === 'estimates'
                      ? 'No estimates in this catalog yet. They arrive when the estimation desk prices a request, or from an estimates workbook.'
                      : 'No bundle features in this catalog yet. They come from a bundles workbook.'}
                  <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <Button onClick={() => pickKind(null)}>Show all</Button>
                    {!state.presenting ? <Button onClick={() => setImportOpen(true)}>Import from Excel</Button> : null}
                  </div>
                </div>
              ) : null}
              {rows.length === 0 && (searching || !kind) ? (
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
              onOpenPlanner={() => router.navigate({ plan: true })}
              onOpenRequest={() => setRequestOpen(true)}
              requestAdded={requestFlash}
            />
          </aside>
        </div>
      </div>

      {/* breathing room above the edly.io footer, whose dark band would otherwise run into the estimate column */}
      {chrome ? <div style={{ height: 48, background: color.page }} /> : null}

      {plannerOpen ? <Planner onClose={() => router.navigate({ plan: undefined })} /> : null}
      {/* a window over the page rather than a dropdown: each item needs room for what the tender says */}
      {panel === 'legal' && !state.presenting ? <SalesLegalPanel onClose={() => setPanel('')} /> : null}
      {importOpen ? (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onShowEstimates={() => {
            setImportOpen(false);
            setSearch('');
            router.navigate({ kind: 'estimates', bundle: ALL_BUNDLES, q: undefined });
          }}
        />
      ) : null}
      {historyOpen && !state.presenting ? <ImportHistory onClose={() => setHistoryOpen(false)} /> : null}
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

/** What the demo estimation is, above its catalog, with the way to put it back. */
function DemoBanner({ onReset }: { onReset: () => void }): JSX.Element {
  return (
    <div
      style={{
        maxWidth: 1000,
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px 16px',
        background: color.surface,
        border: `1px dashed ${color.rule}`,
        borderRadius: radius.lg,
        padding: '14px 18px'
      }}
    >
      <DemoTag />
      <div style={{ flex: '1 1 340px', minWidth: 0 }}>
        <div style={{ fontFamily: font.display, fontSize: 14, fontWeight: 600, color: color.ink }}>This is the demo estimation</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: color.muted, marginTop: 2 }}>
          A finished deal to learn from. Every line has a role on the rate card, the estimation desk has priced the custom requests,
          and the timeline, the Excel sheet and Sales &amp; legal are filled in. Change anything you like: nothing here is saved, and
          Reset or a reload puts it back.
        </div>
      </div>
      <Button size="sm" onClick={onReset} title="Put the demo back as it was prepared">
        Reset demo
      </Button>
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
      title="One click before screen-sharing: shows the edly.io header and hero, and hides savings, buffers, internal notes and estimation controls"
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
