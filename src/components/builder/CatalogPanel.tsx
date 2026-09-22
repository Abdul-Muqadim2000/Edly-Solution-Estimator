import { useRef, useState } from 'react';
import { useApp } from '@/state/AppProvider';
import { allSolutions, diffCatalogs } from '@/domain/catalog';
import { benchmarkCatalog, isLiveCatalog } from '@/data/practices';
import { color, font, radius } from '@/theme';
import { Button, Mono, Popover, Row, useRowHover } from '@/components/ui';

/** Where the catalog came from, and how to replace it with your own sheet. */
export function CatalogPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { state, catalog, importCatalog, resetCatalog } = useApp();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changes, setChanges] = useState<string[]>([]);
  const dropHover = useRowHover({ background: color.brandWash, borderColor: color.brand });

  const live = isLiveCatalog(state.platform);
  const loaded = state.loadedCatalogs[state.platform];
  const source = state.catalogSource;

  const sourceLine = (): string => {
    if (!live && !loaded) return `industry benchmark set for this platform`;
    if (source?.source === 'file') return `loaded from ${source.name ?? 'your sheet'}`;
    if (source?.source === 'builtin') return 'built-in copy of the master sheet';
    if (source?.source === 'auto') return `live from ${source.name ?? '/catalog-source.xlsx'}`;
    return 'from the master sales sheet';
  };

  const pick = async (file: File): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const before = loaded ?? benchmarkCatalog(state.platform) ?? null;
      const result = await importCatalog(file);
      const after = state.loadedCatalogs[state.platform];
      const lines: string[] = [];
      if (before && after) {
        const diff = diffCatalogs(before, after);
        if (diff.added.length > 0) lines.push(`+ ${diff.added.length} new — ${diff.added.slice(0, 5).map((entry) => entry.id).join(', ')}`);
        if (diff.changed.length > 0) lines.push(`~ ${diff.changed.length} updated — ${diff.changed.slice(0, 4).map((entry) => `${entry.id} (${entry.fields.join('/')})`).join(', ')}`);
        if (diff.removed.length > 0) lines.push(`− ${diff.removed.length} no longer in the sheet`);
        if (diff.bundlesAdded.length > 0) lines.push(`+ new bundle — ${diff.bundlesAdded.join(', ')}`);
      }
      for (const warning of result?.warnings ?? []) lines.push(`⚠ ${warning}`);
      setChanges(lines.length > 0 ? lines : ['Loaded. No differences from what was already in play.']);
    } catch (problem) {
      setError((problem as Error).message || 'That workbook could not be read.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover>
      <Row gap={10} wrap={false}>
        <span style={{ flex: 1, fontFamily: font.display, fontSize: 14, fontWeight: 600 }}>Solution catalog</span>
        <Button size="sm" tone="ghost" onClick={onClose} style={{ background: color.surfaceMuted, width: 24, height: 24, padding: 0 }}>
          ×
        </Button>
      </Row>
      <div style={{ fontSize: 12.5, color: color.ink, fontWeight: 600, marginTop: 8 }}>
        {sourceLine()}
        {source?.at ? ` · ${source.at}` : ''}
      </div>
      <div style={{ marginTop: 3 }}>
        <Mono size={11}>
          {allSolutions(catalog).length} solutions · {catalog.bundles.length} bundles · sheet compiled {catalog.meta.compiled || '—'}
        </Mono>
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

      <div
        onClick={() => fileInput.current?.click()}
        {...dropHover.bind}
        style={{
          marginTop: 12,
          border: `1.5px dashed ${color.brandEdge}`,
          background: color.brandWashTint,
          borderRadius: radius.md + 1,
          padding: 12,
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'background 120ms ease, border-color 120ms ease',
          ...dropHover.style
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, color: color.brandDeep }}>
          {busy ? 'Reading sheet…' : live ? 'Load an updated sheet (.xlsx)' : 'Load this platform’s sheet (.xlsx)'}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: color.muted, lineHeight: 1.5, marginTop: 3 }}>
          Solutions, hours, bundles, search and every export update immediately.
        </span>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void pick(file);
          }}
        />
      </div>

      {error ? (
        <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: color.redInk, background: color.redWash, borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
          {error}
        </div>
      ) : null}

      {loaded ? (
        <Row gap={6} style={{ marginTop: 10 }}>
          <Button
            size="sm"
            onClick={() => {
              resetCatalog();
              setChanges([]);
            }}
          >
            {live ? 'Use built-in copy' : 'Back to the benchmark set'}
          </Button>
        </Row>
      ) : null}

      <div style={{ fontSize: 11, color: color.faint, lineHeight: 1.55, borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 10, paddingTop: 9 }}>
        Saved estimations keep their selections. A solution dropped from the sheet leaves the totals; new rows appear straight
        away in search and in their bundle.
      </div>
    </Popover>
  );
}
