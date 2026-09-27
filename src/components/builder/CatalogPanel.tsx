import { useState } from 'react';
import { useApp } from '@/state/AppProvider';
import { catalogSourceLabel } from '@/state/reducer';
import { allSolutions, kindCounts } from '@/domain/catalog';
import { isLiveCatalog } from '@/data/practices';
import { plural } from '@/lib/format';
import { color, font, radius } from '@/theme';
import { Button, Mono, Popover, Row, useRowHover } from '@/components/ui';

/** Where the catalog came from, and the way in for workbooks of bundles or of estimates. */
export function CatalogPanel({ onClose, onImport }: { onClose: () => void; onImport: () => void }): JSX.Element {
  const { state, catalog, resetCatalog, reloadCatalog } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changes, setChanges] = useState<string[]>([]);
  const importHover = useRowHover({ background: color.brandWash, borderColor: color.brand });

  const live = isLiveCatalog(state.platform);
  const loaded = state.loadedCatalogs[state.platform];
  const source = state.catalogSource;
  /* offered whenever the copy in play did not come from the served sheet, or a newer one is out */
  const canReadLive = live && (source?.source === 'builtin' || source?.source === 'file' || Boolean(loaded?.meta.loaded) || state.autoAvail);
  const counts = kindCounts(catalog);

  return (
    <Popover>
      <Row gap={10} wrap={false}>
        <span style={{ flex: 1, fontFamily: font.display, fontSize: 14, fontWeight: 600 }}>Solution catalog</span>
        <Button size="sm" tone="ghost" onClick={onClose} style={{ background: color.surfaceMuted, width: 24, height: 24, padding: 0 }}>
          ×
        </Button>
      </Row>
      <div style={{ fontSize: 12.5, color: color.ink, fontWeight: 600, marginTop: 8 }}>
        {catalogSourceLabel(state)}
        {source?.at ? ` · ${source.at}` : ''}
      </div>
      <Mono block size={11} style={{ marginTop: 3 }}>
        {allSolutions(catalog).length} solutions · {catalog.bundles.length} bundles · sheet compiled {catalog.meta.compiled || '—'}
      </Mono>
      <div style={{ fontSize: 11.5, color: color.muted, marginTop: 6, lineHeight: 1.5 }}>
        <span style={{ fontWeight: 700, color: color.brandDeep }}>{counts.bundles} in bundles</span>, built before.{' '}
        <span style={{ fontWeight: 700, color: color.violet }}>{plural(counts.estimates, 'estimate')}</span>, priced but not built.
      </div>

      {changes.length > 0 ? (
        <div style={{ marginTop: 10, background: color.brandWashPale, border: `1px solid ${color.brandEdgePale}`, borderRadius: radius.md, padding: '9px 11px', display: 'grid', gap: 4 }}>
          {changes.map((line) => (
            <div key={line} style={{ fontSize: 11.5, color: color.brandInk, lineHeight: 1.5 }}>
              {line}
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onImport}
        {...importHover.bind}
        style={{
          display: 'block',
          width: '100%',
          marginTop: 12,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: color.brandEdge,
          background: color.brandWashTint,
          borderRadius: radius.md + 1,
          padding: 12,
          textAlign: 'center',
          cursor: 'pointer',
          fontFamily: font.body,
          transition: 'background 120ms ease, border-color 120ms ease',
          ...importHover.style
        }}
      >
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: color.brandDeep }}>Import from Excel</span>
        <span style={{ display: 'block', fontSize: 11, color: color.muted, lineHeight: 1.5, marginTop: 3 }}>
          A bundles workbook of built features, or an estimates sheet of priced work. You see what it would change first.
        </span>
      </button>

      {error ? (
        <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: color.redInk, background: color.redWash, borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
          {error}
        </div>
      ) : null}

      <Row gap={6} style={{ marginTop: 10 }}>
        {canReadLive ? (
          <Button
            size="sm"
            hover={{ borderColor: color.brand, background: color.brandWash }}
            onClick={() => {
              setBusy(true);
              setError('');
              void reloadCatalog()
                .then(() => setChanges(['Re-read the sheet served beside the app.']))
                .catch((problem: Error) => setError(problem.message || 'That sheet could not be read.'))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Reading the sheet…' : state.autoAvail ? 'A newer sheet sits beside the app: use it' : 'Re-read the sheet beside the app'}
          </Button>
        ) : null}
        {loaded ? (
          <Button
            size="sm"
            hover={{ borderColor: color.ghost, color: color.ink }}
            onClick={() => {
              resetCatalog();
              setChanges([]);
            }}
          >
            {live ? 'Use built-in copy' : 'Back to the benchmark set'}
          </Button>
        ) : null}
      </Row>

      <div style={{ fontSize: 11, color: color.faint, lineHeight: 1.55, borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 10, paddingTop: 9 }}>
        Saved estimations keep their selections. A solution dropped from the sheet leaves the totals; new rows appear straight
        away in search and in their bundle.
      </div>
    </Popover>
  );
}

