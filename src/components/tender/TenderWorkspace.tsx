import { useState } from 'react';
import type { TenderStage } from '@/types';
import { useApp } from '@/state/AppProvider';
import { openTenderRecord } from '@/state/reducer';
import { useTenderRunner } from '@/state/useTenderRunner';
import { aiAllowance, aiSpent, aiStep, documentLength, heldDocs, limitQuestion, spendSummary, stageOpen, tenderCounts, tokenSummary } from '@/domain/tender';
import { findPlatform } from '@/data/practices';
import { tenderDiscard } from '@/api/client';
import { plural } from '@/lib/format';
import { color, dueInfo, font, radius } from '@/theme';
import { AppHeader } from '@/components/AppHeader';
import { Banner, Button, Empty, Field, Mono, Row, Spacer } from '@/components/ui';
import { DeferredField, StepPill, TextButton } from '@/components/tender/parts';
import { RequirementsStep } from '@/components/tender/RequirementsStep';
import { MatchStep } from '@/components/tender/MatchStep';
import { ApplyStep } from '@/components/tender/ApplyStep';

/**
 * One tender, from requirements to desk requests, in three steps a person moves through.
 *
 * Internal material: it quotes the client's documents and says what is and is not in the
 * catalog, so it stays out of "Present to client" mode.
 */

const expiryLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export function TenderWorkspace(): JSX.Element {
  const { state, dispatch, router, catalog } = useApp();
  const tender = openTenderRecord(state);
  const runner = useTenderRunner(tender, catalog, dispatch);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [filesNote, setFilesNote] = useState('');

  if (!tender) {
    return (
      <div style={{ minHeight: 'calc(100vh - 74px)', background: color.page }}>
        <AppHeader sticky />
        <main style={{ maxWidth: 880, margin: '0 auto', padding: '40px 24px' }}>
          <Empty title="That tender is not here" body="It may have been deleted, or it belongs to another platform." />
        </main>
      </div>
    );
  }

  const counts = tenderCounts(tender);
  const ref = findPlatform(tender.plat);
  const due = dueInfo(tender.due);
  const held = heldDocs(tender.docs, Date.now());
  const goTo = (stage: TenderStage): void => {
    dispatch({ type: 'patchTender', id: tender.id, patch: { stage } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeFiles = async (): Promise<void> => {
    try {
      const gone = await tenderDiscard(held.map((doc) => doc.fileId));
      dispatch({ type: 'forgetTenderFiles', id: tender.id, fileIds: gone });
      setFilesNote(gone.length === held.length ? 'Removed from Anthropic.' : 'Some files could not be removed. Try again.');
    } catch (error) {
      setFilesNote(`Could not remove them: ${(error as Error).message}`);
    }
  };

  const remove = async (): Promise<void> => {
    if (held.length > 0) await tenderDiscard(held.map((doc) => doc.fileId)).catch(() => []);
    dispatch({ type: 'deleteTender', id: tender.id });
    router.navigate({ screen: 'hub' });
  };

  const steps: { stage: TenderStage; label: string; meta: string }[] = [
    {
      stage: 'requirements',
      label: 'Requirements',
      meta: counts.pendingRanges > 0 ? (runner.held ? 'Paused at the AI limit' : 'Reading the tender…') : `${counts.approved} approved, ${counts.proposed} to review`
    },
    { stage: 'match', label: 'Match to the catalog', meta: counts.matched > 0 ? `${counts.reviewed} of ${counts.approved} accepted` : 'After requirements' },
    { stage: 'apply', label: 'Estimation and desk', meta: tender.sentAt ? `Sent ${tender.sentAt}` : tender.estId ? 'Estimation created' : 'Last step' }
  ];
  const order: TenderStage[] = ['requirements', 'match', 'apply'];
  const current = tender.stage === 'done' ? 'apply' : tender.stage;

  return (
    <div style={{ minHeight: 'calc(100vh - 74px)', background: color.page }}>
      <AppHeader sticky />
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 24px 40px' }}>
        {state.presenting ? (
          <Banner tone="warn">
            <Row gap={10}>
              <span>Tender analysis is internal, so it is hidden while presenting to a client.</span>
              <Button size="sm" onClick={() => dispatch({ type: 'togglePresenting' })}>
                Stop presenting
              </Button>
            </Row>
          </Banner>
        ) : (
          <>
            <TextButton onClick={() => router.navigate({ screen: 'hub' })}>← Estimations</TextButton>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: color.brandDeep, marginTop: 14 }}>
              {ref ? `${ref.practice.name} / ${ref.platform.name}` : tender.plat} / Tender
            </div>

            {editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10, alignItems: 'end' }}>
                <DeferredField label="Name" value={tender.name} onCommit={(name) => name.trim() && dispatch({ type: 'patchTender', id: tender.id, patch: { name: name.trim() } })} />
                <DeferredField label="Client" value={tender.client} onCommit={(client) => dispatch({ type: 'patchTender', id: tender.id, patch: { client: client.trim() } })} />
                <Field label="Submission deadline" type="date" value={tender.due} onChange={(value) => dispatch({ type: 'patchTender', id: tender.id, patch: { due: value } })} />
                <div>
                  <Button onClick={() => setEditing(false)}>Done</Button>
                </div>
              </div>
            ) : (
              <Row gap={12} align="baseline" style={{ marginTop: 6 }}>
                <h1 style={{ fontFamily: font.display, fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>{tender.name}</h1>
                <span style={{ fontSize: 13, color: color.faint }}>{tender.client || 'No client set'}</span>
                {due ? <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: radius.pill, padding: '4px 10px', background: due.bg, color: due.co }}>{due.label}</span> : null}
                <TextButton onClick={() => setEditing(true)}>Edit details</TextButton>
              </Row>
            )}

            {tender.summary ? <p style={{ fontSize: 13.5, color: color.body, lineHeight: 1.6, margin: '8px 0 0', maxWidth: 820 }}>{tender.summary}</p> : null}

            <Row gap={12} style={{ marginTop: 12, fontSize: 12 }}>
              <Mono size={11} tone={color.faint}>
                {tender.docs.map((doc) => `${doc.name} (${documentLength(doc)})`).join(', ')}
              </Mono>
              <Spacer />
              {held.length > 0 ? (
                <>
                  <span style={{ color: color.muted }}>
                    {plural(held.length, 'file')} at Anthropic until {expiryLabel(held[0]?.expiresAt ?? '')}
                  </span>
                  <TextButton onClick={() => void removeFiles()} tone={color.redInk} title="Delete the tender files at Anthropic now">
                    Remove files
                  </TextButton>
                </>
              ) : (
                <span style={{ color: color.muted }}>Files no longer at Anthropic (removed or expired)</span>
              )}
              {filesNote ? <span style={{ color: color.brandInk }}>{filesNote}</span> : null}
            </Row>
            <Row gap={12} style={{ marginTop: 4 }}>
              <Mono size={10.5} tone={color.ghost}>
                {tokenSummary(tender.tokens)}. {spendSummary(aiSpent(tender), aiAllowance(tender))}
              </Mono>
              <Spacer />
              <TextButton
                tone={confirmDelete ? color.redInk : color.muted}
                title="Delete this tender and its files at Anthropic. Estimations and requests made from it stay."
                onClick={() => {
                  if (confirmDelete) void remove();
                  else {
                    setConfirmDelete(true);
                    window.setTimeout(() => setConfirmDelete(false), 4000);
                  }
                }}
              >
                {confirmDelete ? 'Click again to delete the tender' : 'Delete tender'}
              </TextButton>
            </Row>

            {runner.held ? (
              <div style={{ marginTop: 16 }}>
                <Banner tone="warn">
                  <div role="status" style={{ fontWeight: 600 }}>
                    {limitQuestion(aiSpent(tender), aiAllowance(tender), aiStep(tender), runner.held)}
                  </div>
                  <Row gap={10} style={{ marginTop: 8 }}>
                    <Button size="sm" tone="primary" onClick={runner.goOn}>
                      Continue
                    </Button>
                    <span>Or leave it here: what has been read stays, and you can add the rest by hand.</span>
                  </Row>
                </Banner>
              </div>
            ) : null}

            <nav aria-label="Tender steps" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '20px 0 18px' }}>
              {steps.map((step, index) => (
                <StepPill
                  key={step.stage}
                  n={index + 1}
                  label={step.label}
                  meta={step.meta}
                  on={current === step.stage}
                  done={order.indexOf(current) > index || (step.stage === 'apply' && Boolean(tender.sentAt))}
                  disabled={!stageOpen(tender, step.stage)}
                  onClick={() => goTo(step.stage)}
                />
              ))}
            </nav>

            {current === 'requirements' ? <RequirementsStep tender={tender} runner={runner} dispatch={dispatch} onContinue={() => goTo('match')} /> : null}
            {current === 'match' ? <MatchStep tender={tender} runner={runner} catalog={catalog} dispatch={dispatch} onContinue={() => goTo('apply')} /> : null}
            {current === 'apply' ? <ApplyStep tender={tender} state={state} catalog={catalog} dispatch={dispatch} router={router} /> : null}
          </>
        )}
      </main>
    </div>
  );
}
