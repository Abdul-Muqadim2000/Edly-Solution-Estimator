import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Catalog } from '@/types';
import { useApp } from '@/state/AppProvider';
import { baseSourceOf, currentPlatform, sourceAfterImport } from '@/state/reducer';
import { allSolutions } from '@/domain/catalog';
import { planEstimateImport } from '@/domain/estimateImport';
import { planBundleImport } from '@/domain/bundleImport';
import { EMPTY_REVIEW, type ImportReview } from '@/domain/importReview';
import { ImportReviewPanel } from '@/components/ImportReview';
import { downloadTemplate, ESTIMATE_COLUMNS, hasErrors, readImport, type ImportIssue, type ImportKind, type ImportRead } from '@/lib/catalogImport';
import { plural, today } from '@/lib/format';
import { useHover } from '@/lib/useHover';
import { color, font, radius } from '@/theme';
import { Banner, Button, Modal, Row, useRowHover } from '@/components/ui';

/**
 * Importing a workbook into the catalog, in steps a person can see: pick which kind it is, pick
 * the file, review every group it brings, then import.
 *
 * Nothing is applied on reading. A file with an error cannot be applied at all, and nothing can be
 * imported while a group is still pending. The review is worked out by the same functions that
 * apply it (`planEstimateImport`, `planBundleImport`), so the numbers a person approves are the
 * numbers that land.
 */

const KINDS: { kind: ImportKind; title: string; body: string; tone: string; wash: string }[] = [
  {
    kind: 'bundles',
    title: 'Bundles',
    body: 'Features Edly built for a client before, delivered again for less. The master sheet’s format: Bundle Catalog, All Components, and a B01 sheet per bundle if you like.',
    tone: color.brandDeep,
    wash: color.brandWash
  },
  {
    kind: 'estimates',
    title: 'Estimates',
    body: 'Work priced for an earlier client and never built. One row each on a sheet named Estimates, with Feature and First-delivery hrs filled in.',
    tone: color.violet,
    wash: color.violetWash
  }
];

/** Issues listed before "Show all" is needed. */
const SHOWN = 6;

export function ImportModal({
  initialKind = 'bundles',
  onClose,
  onShowEstimates
}: {
  initialKind?: ImportKind;
  onClose: () => void;
  /** Offered after estimates land, where there is a catalog to show them in. */
  onShowEstimates?: () => void;
}): JSX.Element {
  const { state, dispatch, catalog, baseCatalog } = useApp();
  const [kind, setKind] = useState<ImportKind>(initialKind);
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState<ImportRead | null>(null);
  const [done, setDone] = useState('');
  const [showFormat, setShowFormat] = useState(false);
  /* a new file, or a new kind, starts its review from nothing decided */
  const [review, setReview] = useState<ImportReview>(EMPTY_REVIEW);
  const input = useRef<HTMLInputElement | null>(null);
  const platform = currentPlatform(state);

  const choose = (next: ImportKind): void => {
    if (next === kind) return;
    setKind(next);
    setRead(null);
    setFile('');
    setDone('');
    setReview(EMPTY_REVIEW);
  };

  const pick = async (picked: File): Promise<void> => {
    setBusy(true);
    setDone('');
    setFile(picked.name);
    setReview(EMPTY_REVIEW);
    try {
      setRead(await readImport(await picked.arrayBuffer(), kind));
    } finally {
      setBusy(false);
    }
  };

  const bundlesPlan = useMemo(() => {
    if (read?.kind !== 'bundles' || !read.catalog) return null;
    return planBundleImport({ current: baseCatalog, incoming: read.catalog, review });
  }, [read, baseCatalog, review]);

  const catalogBundles = useMemo(() => catalog.bundles.map((bundle) => ({ id: bundle.id, name: bundle.name })), [catalog.bundles]);
  const estimatesPlan = useMemo(() => {
    if (read?.kind !== 'estimates' || read.rows.length === 0) return null;
    return planEstimateImport({
      rows: read.rows,
      file,
      platform,
      catalogBundles,
      solutions: state.solutions,
      bundles: state.bundles,
      today: today(),
      review
    });
  }, [read, file, platform, catalogBundles, state.solutions, state.bundles, review]);

  const issues: ImportIssue[] = [...(read?.issues ?? []), ...(estimatesPlan?.warnings ?? []).map((text) => ({ level: 'warning' as const, text }))];
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  const notes = issues.filter((issue) => issue.level === 'note');

  const applyBundles = (mode: 'add' | 'replace'): void => {
    if (read?.kind !== 'bundles' || !bundlesPlan || bundlesPlan.review.pending > 0) return;
    const built = mode === 'add' ? bundlesPlan.merge.catalog : bundlesPlan.reviewed;
    const source = sourceAfterImport(baseSourceOf(state), { name: file, hash: read.hash }, mode, today());
    /* the record on the catalog is what keeps it pinned over the served sheet after a reload */
    const next: Catalog = {
      ...built,
      meta: { ...built.meta, loaded: { name: source.name ?? file, added: source.added, hash: source.hash, at: source.at } }
    };
    dispatch({ type: 'setLoadedCatalog', platform, catalog: next, source: { ...source, warnings: warnings.map((issue) => issue.text) } });
    const count = allSolutions(next).length;
    setDone(
      mode === 'add'
        ? `Added. The catalog now has ${plural(count, 'solution')} in ${plural(next.bundles.length, 'bundle')}.`
        : `Replaced. The catalog is now this workbook: ${plural(count, 'solution')} in ${plural(next.bundles.length, 'bundle')}.`
    );
    setRead(null);
  };

  const applyEstimates = (): void => {
    if (read?.kind !== 'estimates' || !estimatesPlan || estimatesPlan.review.pending > 0) return;
    dispatch({ type: 'importEstimates', rows: read.rows, file, catalogBundles, review });
    const total = estimatesPlan.added.length + estimatesPlan.updated.length;
    setDone(`Imported ${plural(total, 'estimate')} from ${file}. They are listed under Estimates, marked in violet.`);
    setRead(null);
  };

  const active = KINDS.find((entry) => entry.kind === kind)!;

  return (
    <Modal
      width={880}
      onClose={onClose}
      title={
        <>
          <div style={{ fontFamily: font.display, fontSize: 19, fontWeight: 700 }}>Import from Excel</div>
          <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55, marginTop: 3, maxWidth: 600 }}>
            Two kinds of workbook come in here, and the catalog keeps them apart. Nothing changes until you have read what the file
            would do and chosen to apply it.
          </div>
        </>
      }
    >
      <div role="radiogroup" aria-label="Kind of workbook" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10, marginTop: 16 }}>
        {KINDS.map((entry) => (
          <KindCard key={entry.kind} entry={entry} on={entry.kind === kind} onPick={() => choose(entry.kind)} />
        ))}
      </div>

      <Row gap={8} style={{ marginTop: 10 }}>
        <Button size="sm" onClick={() => downloadTemplate(kind)} hover={{ borderColor: active.tone, color: active.tone }}>
          Download the {kind} template
        </Button>
        {kind === 'estimates' ? (
          <Button size="sm" tone="ghost" onClick={() => setShowFormat((value) => !value)}>
            {showFormat ? 'Hide the columns' : 'Which columns it takes'}
          </Button>
        ) : null}
      </Row>

      {showFormat && kind === 'estimates' ? <EstimateFormat /> : null}

      <DropZone
        label={busy ? 'Reading the workbook…' : file && read ? `Choose another ${kind} workbook` : `Choose a ${kind} workbook (.xlsx)`}
        sub={file ? file : 'Or drop it here.'}
        tone={active.tone}
        onClick={() => input.current?.click()}
        onDropFile={(dropped) => void pick(dropped)}
      />
      <input
        ref={input}
        type="file"
        accept=".xlsx"
        style={{ display: 'none' }}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (picked) void pick(picked);
        }}
      />

      {done ? (
        <div style={{ marginTop: 14 }}>
          <Banner tone="good">
            {done}
            {kind === 'estimates' && onShowEstimates ? (
              <span>
                {' '}
                <InlineAction onClick={onShowEstimates}>Show the estimates</InlineAction>
              </span>
            ) : null}
          </Banner>
        </div>
      ) : null}

      {read ? (
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          {errors.length > 0 ? (
            <IssueList tone="bad" heading={`This file cannot be imported. ${errors.length === 1 ? 'One thing' : `${errors.length} things`} to fix first:`} issues={errors} />
          ) : null}
          {warnings.length > 0 ? (
            <IssueList
              tone="warn"
              heading={`${warnings.length === 1 ? 'One thing' : `${warnings.length} things`} to check. The rest imports as it reads.`}
              issues={warnings}
            />
          ) : null}

          {!hasErrors(issues) && notes.length > 0 ? (
            <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.5 }}>{notes.map((issue) => issue.text).join(' ')}</div>
          ) : null}
          {!hasErrors(issues) && bundlesPlan ? (
            <>
              <ImportReviewPanel summary={bundlesPlan.review} review={review} onChange={setReview} noun="solution" />
              <BundlesPreview plan={bundlesPlan} onApply={applyBundles} />
            </>
          ) : null}
          {!hasErrors(issues) && estimatesPlan ? (
            <>
              <ImportReviewPanel summary={estimatesPlan.review} review={review} onChange={setReview} noun="estimate" />
              <Preview>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: color.ink }}>
                  {estimatesPlan.review.pending > 0
                    ? `${plural(estimatesPlan.review.pending, 'group')} still to review before anything can be imported.`
                    : `${plural(estimatesPlan.review.included, 'estimate')} to import: ${estimatesPlan.added.length.toLocaleString('en-US')} new${
                        estimatesPlan.updated.length > 0 ? `, ${estimatesPlan.updated.length.toLocaleString('en-US')} updating an earlier import` : ''
                      }.`}
                </div>
                <PreviewLines
                  lines={[
                    estimatesPlan.review.pending === 0 && estimatesPlan.newBundles.length > 0
                      ? `New ${estimatesPlan.newBundles.length === 1 ? 'bundle' : 'bundles'}: ${estimatesPlan.newBundles.map((bundle) => `${bundle.name} (${bundle.count.toLocaleString('en-US')})`).join(', ')}.`
                      : '',
                    estimatesPlan.review.pending === 0 && estimatesPlan.unassigned > 0
                      ? `${plural(estimatesPlan.unassigned, 'estimate')} ${estimatesPlan.unassigned === 1 ? 'goes' : 'go'} to Unassigned, for the estimation desk to file.`
                      : '',
                    estimatesPlan.review.leftOut > 0 ? `${plural(estimatesPlan.review.leftOut, 'estimate')} left out.` : ''
                  ]}
                />
                <Row gap={8} style={{ marginTop: 12 }}>
                  <Button
                    tone="primary"
                    disabled={estimatesPlan.review.pending > 0 || estimatesPlan.review.included === 0}
                    onClick={applyEstimates}
                    style={{ background: color.violet }}
                    hover={{ background: color.ink }}
                  >
                    Import {plural(estimatesPlan.review.included, 'estimate')}
                  </Button>
                  <Button tone="ghost" onClick={() => setRead(null)}>
                    Cancel
                  </Button>
                </Row>
              </Preview>
            </>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function BundlesPreview({ plan, onApply }: { plan: ReturnType<typeof planBundleImport>; onApply: (mode: 'add' | 'replace') => void }): JSX.Element {
  const { merge, replace, reviewed, review } = plan;
  const items = allSolutions(reviewed);
  const unpriced = items.filter((item) => item.first === null).length;
  const building = items.filter((item) => item.status === 'In Development').length;
  const waiting = review.pending > 0 ? [`${plural(review.pending, 'group')} still to review.`] : review.included === 0 ? ['Nothing approved to import.'] : [];

  return (
    <Preview>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: color.ink }}>
        {review.pending > 0
          ? `${plural(review.pending, 'group')} still to review before anything can be imported.`
          : `${plural(items.length, 'solution')} in ${plural(reviewed.bundles.length, 'bundle')}${unpriced > 0 ? `, ${unpriced} not priced yet` : ''}${
              building > 0 ? `, ${building} in development` : ''
            }${review.leftOut > 0 ? `, ${review.leftOut} left out` : ''}.`}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginTop: 12 }}>
        <Choice
          title="Add to the catalog"
          lines={
            review.pending > 0
              ? []
              : [
                  `${merge.added.length.toLocaleString('en-US')} new, ${merge.updated.length.toLocaleString('en-US')} updated from this file.`,
                  `The other ${plural(merge.kept, 'solution')} stay as they are.`,
                  merge.bundlesAdded.length > 0 ? `New ${merge.bundlesAdded.length === 1 ? 'bundle' : 'bundles'}: ${merge.bundlesAdded.join(', ')}.` : ''
                ]
          }
          blocked={[...waiting, ...merge.conflicts]}
          action="Add to the catalog"
          primary
          onClick={() => onApply('add')}
        />
        <Choice
          title="Replace the catalog"
          lines={
            review.pending > 0
              ? []
              : [
                  'The catalog becomes this workbook, as reviewed.',
                  replace.removed.length > 0 ? `${plural(replace.removed.length, 'solution')} not in it will leave the catalog.` : 'Nothing in the catalog is missing from it.',
                  'Estimates stay: they are kept apart from the workbook.'
                ]
          }
          blocked={waiting}
          action="Replace the catalog"
          onClick={() => onApply('replace')}
        />
      </div>
    </Preview>
  );
}

function Choice({
  title,
  lines,
  blocked,
  action,
  primary,
  onClick
}: {
  title: string;
  lines: string[];
  blocked: string[];
  action: string;
  primary?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <div style={{ border: `1px solid ${color.hairline}`, borderRadius: radius.md, padding: '12px 14px', background: color.surface, display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      <PreviewLines lines={lines} />
      {blocked.length > 0 ? (
        <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
          {blocked.map((reason) => (
            <div key={reason} style={{ fontSize: 11.5, lineHeight: 1.5, color: color.redInk }}>
              {reason}
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ marginTop: 'auto', paddingTop: 12 }}>
        <Button tone={primary ? 'primary' : 'secondary'} disabled={blocked.length > 0} onClick={onClick}>
          {action}
        </Button>
      </div>
    </div>
  );
}

function Preview({ children }: { children: ReactNode }): JSX.Element {
  return <div style={{ background: color.surfaceSoft, border: `1px solid ${color.hairline}`, borderRadius: radius.lg, padding: '14px 16px' }}>{children}</div>;
}

function PreviewLines({ lines }: { lines: string[] }): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
      {lines.filter(Boolean).map((line) => (
        <div key={line} style={{ fontSize: 12.5, color: color.body, lineHeight: 1.5 }}>
          {line}
        </div>
      ))}
    </div>
  );
}

function IssueList({ tone, heading, issues }: { tone: 'bad' | 'warn'; heading: string; issues: ImportIssue[] }): JSX.Element {
  const [all, setAll] = useState(false);
  const shown = all ? issues : issues.slice(0, SHOWN);
  return (
    <Banner tone={tone}>
      <div style={{ fontWeight: 700 }}>{heading}</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 3 }}>
        {shown.map((issue, index) => (
          <li key={`${index}-${issue.text}`}>{issue.text}</li>
        ))}
      </ul>
      {issues.length > SHOWN ? (
        <div style={{ marginTop: 6 }}>
          <InlineAction onClick={() => setAll((value) => !value)}>{all ? 'Show fewer' : `Show all ${issues.length}`}</InlineAction>
        </div>
      ) : null}
    </Banner>
  );
}

function InlineAction({ children, onClick }: { children: ReactNode; onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...h.bind}
      style={{
        border: 'none',
        background: 'none',
        padding: 0,
        font: 'inherit',
        fontWeight: 700,
        color: 'inherit',
        textDecoration: h.on ? 'underline' : 'none',
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  );
}

function KindCard({ entry, on, onPick }: { entry: (typeof KINDS)[number]; on: boolean; onPick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      {...h.bind}
      style={{
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: font.body,
        borderRadius: radius.lg,
        padding: '12px 14px',
        borderWidth: 1.5,
        borderStyle: 'solid',
        borderColor: on || h.on ? entry.tone : color.rule,
        background: on ? entry.wash : color.surface,
        transition: 'background 120ms ease, border-color 120ms ease'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: `1.5px solid ${on ? entry.tone : color.dashRule}`,
            background: on ? entry.tone : color.surface,
            boxShadow: on ? `inset 0 0 0 2.5px ${color.surface}` : 'none'
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 700, color: on ? entry.tone : color.ink }}>{entry.title}</span>
      </div>
      <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.55, marginTop: 5 }}>{entry.body}</div>
    </button>
  );
}

function DropZone({
  label,
  sub,
  tone,
  onClick,
  onDropFile
}: {
  label: string;
  sub: string;
  tone: string;
  onClick: () => void;
  onDropFile: (file: File) => void;
}): JSX.Element {
  const [over, setOver] = useState(false);
  const hover = useRowHover({ background: color.surfaceMuted, borderColor: tone });
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const dropped = event.dataTransfer.files?.[0];
        if (dropped) onDropFile(dropped);
      }}
      {...hover.bind}
      style={{
        display: 'block',
        width: '100%',
        marginTop: 14,
        padding: 16,
        textAlign: 'center',
        cursor: 'pointer',
        fontFamily: font.body,
        borderRadius: radius.md + 1,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: over ? tone : color.dashRule,
        background: over ? color.surfaceMuted : color.surfaceSoft,
        transition: 'background 120ms ease, border-color 120ms ease',
        ...hover.style
      }}
    >
      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: tone }}>{label}</span>
      <span style={{ display: 'block', fontSize: 11.5, color: color.muted, marginTop: 3, wordBreak: 'break-all' }}>{sub}</span>
    </button>
  );
}

/** The estimates sheet, column by column, in the app, so nobody has to open the template to check. */
function EstimateFormat(): JSX.Element {
  return (
    <div style={{ marginTop: 10, border: `1px solid ${color.hairline}`, borderRadius: radius.md, overflow: 'hidden' }}>
      <div style={{ padding: '9px 12px', fontSize: 12, color: color.body, background: color.surfaceSoft, lineHeight: 1.55 }}>
        One sheet named <b>Estimates</b>, headers in one row, one estimate per row. Hours are plain numbers of hours. The
        template&rsquo;s grey rows are examples: their Estimate IDs start EXAMPLE, and the import always leaves them out.
      </div>
      {ESTIMATE_COLUMNS.map((column) => (
        <div key={column.field} style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 150px) 88px minmax(0, 1fr)', gap: 10, padding: '7px 12px', borderTop: `1px solid ${color.hairlineSoft}`, fontSize: 12, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 700, color: color.ink }}>{column.label}</span>
          <span style={{ color: column.need === 'required' ? color.redInk : column.need === 'recommended' ? color.amberInk : color.muted, fontWeight: 600 }}>
            {column.need === 'required' ? 'Required' : column.need === 'recommended' ? 'Recommended' : 'Optional'}
          </span>
          <span style={{ color: color.body }}>{column.help}</span>
        </div>
      ))}
    </div>
  );
}
