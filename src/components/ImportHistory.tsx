import { useState, type ReactNode } from 'react';
import { useApp } from '@/state/AppProvider';
import { catalogWorkbooks, commitDraft, currentPlatform } from '@/state/reducer';
import { importedFiles, removeImported } from '@/domain/estimateImport';
import { confirmsName } from '@/domain/importHistory';
import { findPlatform, isLiveCatalog } from '@/data/practices';
import { plural } from '@/lib/format';
import { color, font, radius } from '@/theme';
import { Banner, Button, Field, Mono, Modal, Row, Spacer } from '@/components/ui';

/**
 * Every workbook imported into this platform's catalog, and a way to take each one out again.
 *
 * An estimates workbook comes out on its own: its rows carry the file's name, which is what
 * `removeImport` goes by. Bundles workbooks are merged into the catalog without that mark, so
 * they come out together, by reading the standard catalog again.
 *
 * Either delete asks for the file's name to be typed first (`confirmsName`). That stops a slip,
 * not a person who means it; the window says so rather than passing it off as a lock.
 */
export function ImportHistory({ onClose }: { onClose: () => void }): JSX.Element {
  const { state, dispatch, resetCatalog, reloadCatalog } = useApp();
  const platform = currentPlatform(state);
  const live = isLiveCatalog(platform);
  const platformName = findPlatform(platform)?.platform.name ?? 'this platform';
  /* the open deal's unsaved picks count too, or the warning would miss the deal on screen */
  const estimates = importedFiles(state.solutions, state.bundles, platform, commitDraft(state));
  const workbooks = catalogWorkbooks(state);
  const lastWorkbook = workbooks.files[workbooks.files.length - 1] ?? '';

  /* which delete is open: an estimates file by its name, or 'bundles' for the catalog's workbooks */
  const [confirming, setConfirming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const open = (which: string): void => {
    setConfirming(which);
    setError('');
    setDone('');
  };

  /* worked out by the function the reducer applies, so the warning and the result agree */
  const removalOf = (file: string): { estimates: number; bundles: number } => removeImported(state.solutions, state.bundles, platform, file).removed;

  const deleteEstimates = (file: string): void => {
    const removed = removalOf(file);
    dispatch({ type: 'removeImport', file });
    setConfirming('');
    setDone(`Deleted ${file}: ${plural(removed.estimates, 'estimate')}${removed.bundles > 0 ? ` and ${plural(removed.bundles, 'bundle')}` : ''} taken out of the catalog.`);
  };

  const restoreCatalog = async (): Promise<void> => {
    const removed = workbooks.files.join(', ');
    if (!live) {
      resetCatalog();
      setConfirming('');
      setDone(`Removed ${removed}. The catalog is the ${platformName} benchmark set again.`);
      return;
    }
    setBusy(true);
    try {
      /* the served sheet replaces the catalog only once it has been read, so a failure changes nothing */
      await reloadCatalog();
      setConfirming('');
      setDone(`Removed ${removed}. The catalog is the master sheet served beside the app again.`);
    } catch (problem) {
      setError(`The master sheet could not be read, so nothing was removed. ${(problem as Error).message || ''}`.trim());
    } finally {
      setBusy(false);
    }
  };

  const nothing = estimates.length === 0 && workbooks.files.length === 0;

  return (
    <Modal
      width={760}
      onClose={onClose}
      title={
        <>
          <div style={{ fontFamily: font.display, fontSize: 19, fontWeight: 700 }}>Import history</div>
          <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55, marginTop: 3, maxWidth: 600 }}>
            The workbooks imported into the {platformName} catalog. Deleting one asks you to type its name, so it cannot happen by a
            slip. It is a check, not a lock: anyone who can open this tool can still change its data.
          </div>
        </>
      }
    >
      {done ? (
        <div style={{ marginTop: 14 }}>
          <Banner tone="good">{done}</Banner>
        </div>
      ) : null}

      {nothing ? (
        <div style={{ marginTop: 16, fontSize: 13, color: color.muted, lineHeight: 1.6 }}>
          Nothing has been imported on this platform. Workbooks you import from the Catalog panel are listed here, with a way to take
          each one out again.
        </div>
      ) : (
        <>
          <Section title="Estimates workbooks" body="Each one comes out on its own, with the bundles its Area column made.">
            {estimates.length === 0 ? <Quiet>No estimates workbooks on this platform.</Quiet> : null}
            {estimates.map((entry) => (
              <Entry
                key={entry.file}
                name={entry.file}
                detail={[
                  plural(entry.estimates, 'estimate'),
                  entry.bundles > 0 ? `${plural(entry.bundles, 'bundle')} made from its Area column` : '',
                  entry.importedOn ? `imported ${entry.importedOn}` : ''
                ]
                  .filter(Boolean)
                  .join(', ')}
                warning={entry.used > 0 ? `Picked in ${plural(entry.used, 'estimation')}. Deleting takes those lines out of their totals.` : ''}
                action="Delete"
                open={confirming === entry.file}
                onOpen={() => open(entry.file)}
              >
                <ConfirmDelete
                  name={entry.file}
                  body={<RemovalWords estimates={entry.estimates} made={entry.bundles} removed={removalOf(entry.file).bundles} />}
                  action={`Delete ${plural(entry.estimates, 'estimate')}`}
                  busy={false}
                  onConfirm={() => deleteEstimates(entry.file)}
                  onCancel={() => setConfirming('')}
                />
              </Entry>
            ))}
          </Section>

          <Section
            title="Bundles workbooks"
            body="Merged into the catalog, so they come out together: going back to the standard catalog removes all of them."
          >
            {workbooks.files.length === 0 ? (
              <Quiet>{live ? 'None. The catalog is the master sheet served beside the app.' : `None. The catalog is the ${platformName} benchmark set.`}</Quiet>
            ) : (
              <Entry
                name={workbooks.files.join(', ')}
                detail={[plural(workbooks.files.length, 'workbook'), workbooks.at ? `last imported ${workbooks.at}` : ''].filter(Boolean).join(', ')}
                warning=""
                action="Remove all"
                open={confirming === 'bundles'}
                onOpen={() => open('bundles')}
              >
                <ConfirmDelete
                  name={lastWorkbook}
                  body={
                    <>
                      This removes {workbooks.files.length === 1 ? 'it' : `all ${workbooks.files.length}`} and puts back{' '}
                      {live ? 'the master sheet served beside the app' : `the ${platformName} benchmark set`}. Estimations that picked their solutions
                      lose those lines from their totals.
                    </>
                  }
                  action={busy ? 'Reading the master sheet…' : 'Go back to the standard catalog'}
                  busy={busy}
                  onConfirm={() => void restoreCatalog()}
                  onCancel={() => setConfirming('')}
                />
                {error ? (
                  <div style={{ marginTop: 8 }}>
                    <Banner tone="bad">{error}</Banner>
                  </div>
                ) : null}
              </Entry>
            )}
          </Section>
        </>
      )}
    </Modal>
  );
}

/** What deleting an estimates import takes, counting only the bundles that would really go. */
function RemovalWords({ estimates, made, removed }: { estimates: number; made: number; removed: number }): JSX.Element {
  const stays = made - removed;
  const bundles = removed === 1 ? ' and the bundle its Area column made' : removed > 1 ? ` and the ${removed} bundles its Area column made` : '';
  const kept = stays === 1 ? ' One bundle it made stays, as the desk has filed other work there.' : stays > 1 ? ` ${stays} bundles it made stay, as the desk has filed other work there.` : '';
  return (
    <>
      This deletes {plural(estimates, 'estimate')}
      {bundles}.{kept} Importing the file again brings them back.
    </>
  );
}

function Section({ title, body, children }: { title: string; body: string; children: ReactNode }): JSX.Element {
  return (
    <section style={{ marginTop: 18 }}>
      <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.5, marginTop: 2 }}>{body}</div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }): JSX.Element => (
  <div style={{ fontSize: 12.5, color: color.faint, borderTop: `1px solid ${color.hairlineSoft}`, padding: '10px 0' }}>{children}</div>
);

function Entry({
  name,
  detail,
  warning,
  action,
  open,
  onOpen,
  children
}: {
  name: string;
  detail: string;
  warning: string;
  action: string;
  open: boolean;
  onOpen: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div style={{ borderTop: `1px solid ${color.hairlineSoft}`, padding: '10px 0' }}>
      <Row gap={10} wrap={false} align="flex-start">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, wordBreak: 'break-all' }}>{name}</div>
          <div style={{ fontSize: 11.5, color: color.faint, marginTop: 2 }}>{detail}</div>
          {warning ? <div style={{ fontSize: 11.5, fontWeight: 600, color: color.amberInk, marginTop: 4 }}>{warning}</div> : null}
        </div>
        <Spacer />
        {!open ? (
          <Button size="sm" tone="danger" onClick={onOpen}>
            {action}
          </Button>
        ) : null}
      </Row>
      {open ? children : null}
    </div>
  );
}

function ConfirmDelete({
  name,
  body,
  action,
  busy,
  onConfirm,
  onCancel
}: {
  name: string;
  body: ReactNode;
  action: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [typed, setTyped] = useState('');
  const ready = confirmsName(typed, name) && !busy;
  return (
    <div style={{ marginTop: 10, background: color.redWash, border: `1px solid ${color.redEdge}`, borderRadius: radius.md, padding: '12px 14px', display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12.5, color: color.redInk, lineHeight: 1.55 }}>
        {body} Type <Mono size={12}>{name}</Mono> to confirm.
      </div>
      <Field label="File name" value={typed} onChange={setTyped} mono onEnter={() => (ready ? onConfirm() : undefined)} />
      <Row gap={8}>
        <Button size="sm" tone="danger" disabled={!ready} onClick={onConfirm}>
          {action}
        </Button>
        <Button size="sm" tone="ghost" onClick={onCancel}>
          Keep it
        </Button>
      </Row>
    </div>
  );
}
