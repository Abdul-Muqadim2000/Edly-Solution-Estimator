import { useState, type ReactNode } from 'react';
import type { Catalog, DeskDraftEdit, EstimationTag, Tender } from '@/types';
import type { Action, AppState } from '@/state/reducer';
import { sentRequirementIds } from '@/state/reducer';
import type { RouterApi } from '@/state/useRouting';
import { catalogHours, deskDrafts, heldDocs, SOMETHING_NEW, tenderCounts, tenderRequests, tenderSelection, type DeskDraft } from '@/domain/tender';
import { categoryLabel, copiedItems, goesWithEstimation, salesLegalDrafts, topicLabel, type SalesLegalDraft } from '@/domain/salesLegal';
import { allSolutions } from '@/domain/catalog';
import { hours, plural, today } from '@/lib/format';
import { mailRequests } from '@/lib/mail';
import { tenderDiscard } from '@/api/client';
import { color, font, radius, shadow } from '@/theme';
import { Banner, Button, Field, Mono, Row, Select, Spacer } from '@/components/ui';
import { Check, DeferredField, KindChip, TextButton } from '@/components/tender/parts';
import { keepAction } from '@/components/salesLegal/parts';

/**
 * Step 3: the two writes, each behind its own button. The estimation is created first with the
 * accepted catalog solutions picked, and the sales, account and legal items go with it; the desk
 * requests go second, because they attach to it.
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
            /* whole lines and an ellipsis: a 60px cap on 18px lines sliced the fourth through, and the
               tops of its letters read as a dotted rule under every card */
            <div
              style={{
                fontSize: 12,
                color: color.muted,
                lineHeight: 1.5,
                whiteSpace: 'pre-line',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}
            >
              {draft.details}
            </div>
          )}
          <div>
            <TextButton onClick={() => setOpen((value) => !value)}>{open ? 'Done editing details' : 'Edit the details'}</TextButton>
          </div>
        </div>
      )}
    </div>
  );
}

/** One sales, account or legal item as the apply step lists it: kept or left out, and what it is. */
function LegalRow({ draft, onKeep }: { draft: SalesLegalDraft; onKeep?: (keep: boolean) => void }): JSX.Element {
  const off = draft.skip && !draft.copied;
  return (
    <Row gap={10} align="flex-start" wrap={false} style={{ padding: '8px 12px', border: `1px solid ${color.hairline}`, borderRadius: radius.md, background: off ? color.surfaceSoft : color.surface }}>
      {onKeep ? (
        <div style={{ paddingTop: 1 }}>
          <Check checked={!draft.skip} onChange={onKeep} label={`Keep ${draft.key} for the estimation`} />
        </div>
      ) : null}
      <Mono size={11} tone={color.brandDeep} style={{ paddingTop: 2 }}>
        {draft.key}
      </Mono>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: off ? color.muted : color.ink }}>{draft.text}</div>
        {draft.reason ? <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.45, marginTop: 2 }}>{draft.reason}</div> : null}
        <div style={{ fontSize: 11.5, color: color.faint, marginTop: 2 }}>
          {[categoryLabel(draft.category), draft.topic ? topicLabel(draft.topic) : '', draft.source].filter(Boolean).join(', ')}
        </div>
      </div>
      {off ? <span style={{ fontSize: 11, fontWeight: 700, color: color.muted, whiteSpace: 'nowrap' }}>Left out</span> : null}
    </Row>
  );
}

export function ApplyStep({
  tender,
  state,
  catalog,
  dispatch,
  router,
  onShowLegal
}: {
  tender: Tender;
  state: AppState;
  catalog: Catalog;
  dispatch: (action: Action) => void;
  router: RouterApi;
  /** Opens the Sales, account and legal tab, where items are accepted and put in teams. */
  onShowLegal: () => void;
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
  const copied = copiedItems(state.salesLegal, tender.id);
  const legal = salesLegalDrafts(tender, copied);
  const legalGoing = legal.filter(goesWithEstimation);
  /* before the estimation exists, the rows a person can still tick in or out; after, only what is new */
  const legalOffered = legal.filter((draft) => draft.accepted && !draft.copied);
  const legalWaiting = legal.filter((draft) => !draft.accepted && !draft.copied).length;
  const keepLegal = (draft: SalesLegalDraft, keep: boolean): void => dispatch(keepAction(tender.id, draft, keep));

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
    /* parts not yet read, and key terms asked for and not read, can only be read from the files, so
       those stay until someone removes them */
    const unread = tender.ranges.some((range) => range.status !== 'done') || (tender.readTerms === true && (tender.termReads ?? []).some((read) => read.status !== 'done'));
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
              {legalGoing.length > 0 ? ` It also takes ${plural(legalGoing.length, 'sales, account and legal item')}, listed in step 3 below.` : ''}
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

      <Section n={3} title={estimation ? 'Sales, account and legal' : `Sales, account and legal: ${plural(legalGoing.length, 'item')} go${legalGoing.length === 1 ? 'es' : ''} with the estimation`}>
        {legal.length === 0 ? (
          <p style={{ fontSize: 13, color: color.muted, margin: 0 }}>Nothing accepted in this tender is out of scope, and no key terms were read, so there is nothing for these teams.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {estimation ? (
              <Row gap={10}>
                <span style={{ fontSize: 13, color: color.body, lineHeight: 1.6 }}>
                  {copied.size > 0 ? (
                    <>
                      {plural(copied.size, 'item')} went with <strong>{estimation.name}</strong>. Owners, status and due dates are set there, under Sales &amp; legal in
                      the builder.
                    </>
                  ) : (
                    <>
                      None went with <strong>{estimation.name}</strong>.
                    </>
                  )}
                </span>
                <Spacer />
                <Button tone="brand" onClick={() => router.navigate({ screen: 'builder', estimation: estimation.slug || estimation.id })}>
                  Open them in the builder ›
                </Button>
              </Row>
            ) : (
              <p style={{ fontSize: 13, color: color.body, lineHeight: 1.6, margin: 0 }}>
                What the tender commits Edly to that is not software, for the sales, account and legal teams to own. None of it is priced or shown to the client.
                Untick any the teams do not need to see.
              </p>
            )}
            {legalOffered.length > 0 ? (
              <>
                {estimation ? <p style={{ fontSize: 12.5, color: color.body, margin: '4px 0 0' }}>Accepted since the estimation was created:</p> : null}
                {legalOffered.map((draft) => (
                  <LegalRow key={draft.key} draft={draft} onKeep={(keep) => keepLegal(draft, keep)} />
                ))}
                {estimation && legalGoing.length > 0 ? (
                  <div>
                    <Button tone="primary" onClick={() => dispatch({ type: 'addTenderItems', id: tender.id })}>
                      Add {plural(legalGoing.length, 'item')} to the estimation
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
            <Row gap={10}>
              <span style={{ fontSize: 12, color: color.muted }}>
                {legalWaiting > 0 ? `${plural(legalWaiting, 'more item')} ${legalWaiting === 1 ? 'is' : 'are'} not accepted yet and stay${legalWaiting === 1 ? 's' : ''} behind. ` : ''}
                Teams are chosen, and more accepted, on the Sales, account and legal tab.
              </span>
              <TextButton onClick={onShowLegal}>Open the tab</TextButton>
            </Row>
          </div>
        )}
      </Section>
    </div>
  );
}
