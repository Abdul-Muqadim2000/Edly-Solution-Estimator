import { useState, type ReactNode } from 'react';
import type { Catalog, DeskDraftEdit, EstimationTag, Tender } from '@/types';
import type { Action, AppState } from '@/state/reducer';
import { sentRequirementIds } from '@/state/reducer';
import type { RouterApi } from '@/state/useRouting';
import { catalogHours, deskDrafts, heldDocs, SOMETHING_NEW, tenderCounts, tenderRequests, tenderSelection, type DeskDraft } from '@/domain/tender';
import { allSolutions } from '@/domain/catalog';
import { hours, plural, today } from '@/lib/format';
import { mailRequests } from '@/lib/mail';
import { tenderDiscard } from '@/api/client';
import { color, font, radius, shadow } from '@/theme';
import { Banner, Button, Field, Mono, Row, Select, Spacer } from '@/components/ui';
import { Check, DeferredField, KindChip, TextButton } from '@/components/tender/parts';

/**
 * Step 3: the two writes, each behind its own button. The estimation is created first with the
 * accepted catalog solutions picked; the desk requests go second, because they attach to it.
 */

const TAGS: EstimationTag[] = ['Active', 'Urgent', 'On hold', 'Closed'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function Section({ n, title, children, muted }: { n: number; title: string; children: ReactNode; muted?: boolean }): JSX.Element {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.hairline}`, borderRadius: radius.xl, padding: '20px 22px', boxShadow: shadow.card, opacity: muted ? 0.6 : 1 }}>
      <Row gap={10}>
        <span style={{ width: 26, height: 26, borderRadius: radius.pill, display: 'grid', placeItems: 'center', background: color.brandWash, color: color.brandDeep, fontFamily: font.display, fontWeight: 700, fontSize: 13 }}>
          {n}
        </span>
        <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 600 }}>{title}</span>
      </Row>
      <div style={{ marginTop: 14 }}>{children}</div>
    </div>
  );
}

function DraftRow({ draft, areas, onEdit, onSkip }: { draft: DeskDraft; areas: string[]; onEdit: (patch: DeskDraftEdit) => void; onSkip: (skip: boolean) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const off = draft.skip || draft.sent;
  return (
    <div style={{ border: `1px solid ${color.hairline}`, borderRadius: radius.md, padding: '12px 14px', background: off ? color.surfaceSoft : color.surface }}>
      <Row gap={10}>
        {draft.sent ? null : <Check checked={!draft.skip} onChange={(on) => onSkip(!on)} label={`Send ${draft.reqId} to the desk`} />}
        <Mono size={11} tone={color.brandDeep}>
          {draft.reqId}
        </Mono>
        <KindChip kind={draft.kind} />
        <span style={{ fontSize: 11.5, color: color.faint }}>{draft.source}</span>
        <Spacer />
        {draft.sent ? <span style={{ fontSize: 11, fontWeight: 700, color: color.brandInk }}>Already at the desk</span> : null}
        {draft.skip && !draft.sent ? <span style={{ fontSize: 11, fontWeight: 700, color: color.muted }}>Left out</span> : null}
      </Row>
      {draft.sent ? (
        <div style={{ fontSize: 13, color: color.body, marginTop: 6 }}>{draft.title}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, opacity: draft.skip ? 0.6 : 1 }}>
          <DeferredField label="Request title" value={draft.title} onCommit={(title) => onEdit({ title })} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            <Select label="Closest area" value={draft.area} options={areas.map((area) => ({ value: area, label: area }))} onChange={(area) => onEdit({ area })} />
            <DeferredField label="Systems / integrations" value={draft.integrations} onCommit={(integrations) => onEdit({ integrations })} placeholder="e.g. Salesforce, Azure AD" />
          </div>
          {open ? (
            <DeferredField multiline label="Details for the estimator" value={draft.details} onCommit={(details) => onEdit({ details })} />
          ) : (
            <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.5, whiteSpace: 'pre-line', maxHeight: 60, overflow: 'hidden' }}>{draft.details}</div>
          )}
          <div>
            <TextButton onClick={() => setOpen((value) => !value)}>{open ? 'Done editing details' : 'Edit the details'}</TextButton>
          </div>
        </div>
      )}
    </div>
  );
}

export function ApplyStep({
  tender,
  state,
  catalog,
  dispatch,
  router
}: {
  tender: Tender;
  state: AppState;
  catalog: Catalog;
  dispatch: (action: Action) => void;
  router: RouterApi;
}): JSX.Element {
  const estimation = state.estimations.find((one) => one.id === tender.estId) ?? null;
  const [name, setName] = useState(tender.name);
  const [client, setClient] = useState(tender.client);
  const [due, setDue] = useState(tender.due);
  const [tag, setTag] = useState<EstimationTag>('Active');
  const [who, setWho] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const catalogIds = new Set(allSolutions(catalog).map((item) => item.id));
  const selection = tenderSelection(tender, catalogIds);
  const selectedHours = catalogHours(selection, catalog);
  const counts = tenderCounts(tender);
  const unaccepted = counts.approved - counts.reviewed;
  const drafts = deskDrafts(tender, catalog, sentRequirementIds(state, tender.id));
  const toSend = drafts.filter((draft) => !draft.skip && !draft.sent);
  const areas = [...catalog.bundles.map((bundle) => bundle.name), SOMETHING_NEW];

  const editDraft = (reqId: string, patch: DeskDraftEdit): void => {
    const req = tender.reqs.find((one) => one.id === reqId);
    dispatch({ type: 'editMatch', id: tender.id, reqId, patch: { draft: { ...(req?.match?.draft ?? {}), ...patch } } });
  };

  const create = (): void => {
    if (!name.trim()) {
      setError('Give the estimation a name.');
      return;
    }
    setError('');
    dispatch({ type: 'applyTender', id: tender.id, input: { name: name.trim(), client: client.trim(), tag, due }, solutionIds: selection });
  };

  const send = async (): Promise<void> => {
    if (!estimation) return;
    if (!EMAIL.test(email.trim())) {
      setError('A work email is needed so the desk can reply with the estimates.');
      return;
    }
    setError('');
    const contact = { name: who, email, org };
    /* the same function the reducer runs, on the same state, so the email quotes the stored ids */
    const made = tenderRequests(state.requests, tender, toSend, contact, estimation, today());
    dispatch({ type: 'sendTenderRequests', id: tender.id, drafts, contact });

    const held = heldDocs(tender.docs, Date.now()).map((doc) => doc.fileId);
    /* parts not yet read can only be read from the files, so those stay until someone removes them */
    const unread = tender.ranges.some((range) => range.status !== 'done');
    let removed = '';
    if (held.length > 0 && unread) {
      removed = ' The tender files stay at Anthropic because some parts were not read; remove them at the top when you are done.';
    } else if (held.length > 0) {
      try {
        const gone = await tenderDiscard(held);
        dispatch({ type: 'forgetTenderFiles', id: tender.id, fileIds: gone });
        removed = gone.length === held.length ? ' The tender files were removed from Anthropic.' : ' Some tender files could not be removed from Anthropic; use Remove files at the top.';
      } catch {
        removed = ' The tender files could not be removed from Anthropic yet; use Remove files at the top.';
      }
    }
    const mail = await mailRequests(made, { name: estimation.name, client: estimation.client, selected: selection.length, hours: hours(selectedHours.first) });
    const mailNote = mail.opened ? ' An email draft to the desk was opened' + (mail.copied ? ' and copied to your clipboard.' : '.') : mail.copied ? ' The email text is on your clipboard.' : '';
    setNotice(`Sent ${plural(made.length, 'request')} to the desk.${mailNote}${removed}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Section n={1} title="Create the estimation">
        {estimation ? (
          <Row gap={12}>
            <span style={{ fontSize: 13.5, color: color.body }}>
              Created <strong>{estimation.name}</strong> with {plural(Object.keys(estimation.snap.sel ?? {}).length, 'catalog solution')}.
            </span>
            <Spacer />
            <Button tone="brand" onClick={() => router.navigate({ screen: 'builder', estimation: estimation.slug || estimation.id })}>
              Open it in the builder ›
            </Button>
          </Row>
        ) : (
          <>
            <p style={{ fontSize: 13, color: color.body, lineHeight: 1.6, margin: '0 0 12px' }}>
              {selection.length > 0 ? (
                <>
                  Picks <strong>{plural(selection.length, 'catalog solution')}</strong> from the accepted matches, <strong>{hours(selectedHours.first)} h</strong> of
                  first delivery from the catalog{selectedHours.unpriced > 0 ? `, plus ${selectedHours.unpriced} not yet priced` : ''}. Buffers, rates and the plan are
                  set in the builder as usual.
                </>
              ) : (
                'No accepted match picks a catalog solution, so the estimation starts empty and the desk requests below carry the work.'
              )}
            </p>
            {unaccepted > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <Banner tone="warn">{plural(unaccepted, 'approved requirement')} still has no accepted match and will be left out. Go back to step 2 to accept or change them.</Banner>
              </div>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Client" value={client} onChange={setClient} />
              <Select label="Status" value={tag} options={TAGS.map((value) => ({ value, label: value }))} onChange={setTag} />
              <Field label="Deadline" type="date" value={due} onChange={setDue} />
            </div>
            <Row gap={10} style={{ marginTop: 14 }}>
              <Button tone="primary" onClick={create}>
                Create the estimation
              </Button>
              {error && !estimation ? <span style={{ fontSize: 12, fontWeight: 600, color: color.redInk }}>{error}</span> : null}
            </Row>
          </>
        )}
      </Section>

      <Section n={2} title="Send custom work to the estimation desk" muted={!estimation}>
        {!estimation ? (
          <p style={{ fontSize: 13, color: color.muted, margin: 0 }}>Create the estimation first; the desk requests attach to it.</p>
        ) : drafts.length === 0 ? (
          <p style={{ fontSize: 13, color: color.muted, margin: 0 }}>Every accepted requirement is covered by the catalog. Nothing needs the desk.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 13, color: color.body, lineHeight: 1.6, margin: 0 }}>
              Each one reaches the desk queue with the tender&apos;s wording. Reword, leave out or keep them, then send. Nothing is sent until you press the button.
            </p>
            {drafts.map((draft) => (
              <DraftRow
                key={draft.reqId}
                draft={draft}
                areas={areas}
                onEdit={(patch) => editDraft(draft.reqId, patch)}
                onSkip={(skip) => dispatch({ type: 'editMatch', id: tender.id, reqId: draft.reqId, patch: { skip } })}
              />
            ))}
            {toSend.length > 0 ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 4 }}>
                  <Field label="Your name" value={who} onChange={setWho} placeholder="Full name" />
                  <Field label="Work email" value={email} onChange={setEmail} placeholder="you@company.com" />
                  <Field label="Organization" value={org} onChange={setOrg} placeholder="Optional" />
                </div>
                <Row gap={10}>
                  <Button tone="primary" onClick={() => void send()}>
                    Send {plural(toSend.length, 'request')} to the desk
                  </Button>
                  {error && estimation ? <span style={{ fontSize: 12, fontWeight: 600, color: color.redInk }}>{error}</span> : null}
                </Row>
              </>
            ) : null}
          </div>
        )}
        {notice ? (
          <div style={{ marginTop: 12 }}>
            <Banner tone="good">{notice}</Banner>
          </div>
        ) : tender.sentAt ? (
          <div style={{ marginTop: 12 }}>
            <Banner tone="good">Requests went to the desk on {tender.sentAt}.</Banner>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
