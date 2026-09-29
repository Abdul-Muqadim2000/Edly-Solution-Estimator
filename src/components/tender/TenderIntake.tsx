import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { TenderDocument, TenderSection, TenderTokens } from '@/types';
import { PRACTICES, findPlatform } from '@/data/practices';
import { useApp } from '@/state/AppProvider';
import { noteTenderRead } from '@/state/useTenderRunner';
import { tenderDiscard, tenderFit, tenderProbe, tenderUpload, tenderWarm, TenderApiError, type AiProbe } from '@/api/client';
import {
  addTokens,
  DEFAULT_AI_LIMIT,
  documentLength,
  KEEP_WARM_MAX,
  limitQuestion,
  nextKeepWarm,
  NO_TOKENS,
  platformDigest,
  readingSummary,
  sectionPages,
  skippedSections,
  spendSummary,
  tokenSummary,
  type FitResult
} from '@/domain/tender';
import { andList } from '@/lib/format';
import { checkTenderFiles, MAX_FILES, prepareTenderFile } from '@/lib/tenderFiles';
import { color, font, radius } from '@/theme';
import { useHover } from '@/lib/useHover';
import { Banner, Button, Field, Modal, Mono, Row, Select, Spacer } from '@/components/ui';
import { Check, ConfidenceChip, TextButton } from '@/components/tender/parts';

/**
 * Start from a tender: upload, let the AI read it and recommend a platform, then choose.
 *
 * Nothing is created until the person presses Continue. Leaving before that deletes whatever was
 * uploaded, so an abandoned tender does not sit at Anthropic until the 72-hour expiry.
 */

type Phase = 'choose' | 'working' | 'fit';

const ALL_PLATFORMS = PRACTICES.flatMap((practice) =>
  practice.platforms.map((platform) => ({ value: platform.id, label: `${practice.name} / ${platform.name}` }))
);

const platformName = (id: string): string => {
  const ref = findPlatform(id);
  return ref ? `${ref.platform.name}` : id;
};

const sizeLabel = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * The choice to have the key legal and commercial terms listed. Off by default: without it a tender
 * costs exactly what it did before, because the extraction leaves those terms out either way.
 */
function TermsChoice({ on, onChange, docs }: { on: boolean; onChange: (on: boolean) => void; docs: number }): JSX.Element {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, color: color.body, lineHeight: 1.55, cursor: 'pointer' }}>
      <span style={{ paddingTop: 2 }}>
        <Check checked={on} onChange={onChange} label="Also list the key legal and commercial terms for the legal team" />
      </span>
      <span>
        <strong style={{ color: color.ink }}>Also list the key legal and commercial terms for the legal team</strong> (about $0.10 more
        {docs > 1 ? ' for each document' : ''}). Insurance, liability, payment, IP, termination and the like are then read after the requirements and join the
        tender&apos;s Sales, account and legal tab. They are never priced.
      </span>
    </label>
  );
}

/** One platform the person can pick, recommended or not. */
function PlatformChoice({ id, picked, recommended, reasons, onPick }: { id: string; picked: boolean; recommended: boolean; reasons: string[]; onPick: () => void }): JSX.Element {
  const h = useHover();
  const ref = findPlatform(id);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={picked}
      onClick={onPick}
      {...h.bind}
      style={{
        textAlign: 'left',
        width: '100%',
        border: `1.5px solid ${picked ? color.brand : h.on ? color.ghost : color.hairline}`,
        background: picked ? color.brandWashSoft : color.surface,
        borderRadius: radius.lg,
        padding: '14px 16px',
        cursor: 'pointer',
        fontFamily: font.body,
        transition: 'border-color 120ms ease, background 120ms ease'
      }}
    >
      <Row gap={8}>
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            borderRadius: radius.pill,
            border: `2px solid ${picked ? color.brand : color.dashRule}`,
            background: picked ? color.brand : color.surface,
            boxShadow: picked ? `inset 0 0 0 2px ${color.surface}` : 'none'
          }}
        />
        <span style={{ fontFamily: font.display, fontSize: 15, fontWeight: 600, color: color.ink }}>{ref?.platform.name ?? id}</span>
        <span style={{ fontSize: 11.5, color: color.faint }}>{ref?.practice.name}</span>
        {recommended ? (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: color.brandDeep }}>Recommended</span>
        ) : null}
      </Row>
      {reasons.length > 0 ? (
        <ul style={{ margin: '8px 0 0', paddingLeft: 22, fontSize: 12.5, lineHeight: 1.55, color: color.body }}>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </button>
  );
}

/**
 * Which sections the AI will read for requirements. It proposes leaving out the ones with nothing
 * to deliver in them; the person sees which, and can change any section either way.
 */
function ReadingPlan({ docs, outline, onRead }: { docs: TenderDocument[]; outline: TenderSection[]; onRead: (index: number, read: boolean) => void }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (outline.length === 0) return null;
  const skipped = skippedSections({ outline });
  return (
    <div style={{ border: `1px solid ${color.hairline}`, borderRadius: radius.lg, padding: '12px 16px' }}>
      <Row gap={8}>
        <span style={{ fontFamily: font.display, fontSize: 15, fontWeight: 600 }}>What the AI will read</span>
        <Spacer />
        <TextButton onClick={() => setOpen((value) => !value)} title="Choose which sections are read for requirements">
          {open ? 'Done' : 'Change'}
        </TextButton>
      </Row>
      <div style={{ fontSize: 12.5, color: color.body, lineHeight: 1.6, marginTop: 6 }}>
        {docs.map((doc) => (
          <div key={doc.n}>
            {doc.name}: {readingSummary(doc, outline)}
          </div>
        ))}
        <div style={{ marginTop: 4 }}>
          {skipped.length > 0
            ? `Leaves out ${andList(skipped.map(({ section }) => `${section.title} (${sectionPages(section, docs)})`))}, which hold nothing to build, host, support or provide.`
            : 'Every section is read.'}
        </div>
        {skipped.length > 0 ? (
          <div style={{ fontSize: 11.5, color: color.faint, marginTop: 2 }}>
            The page either side of a left-out section is still read, in case a requirement starts or ends there.
          </div>
        ) : null}
      </div>
      {open ? (
        <div role="group" aria-label="Sections to read" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {outline.map((section, index) => (
            <label key={`${section.doc}-${section.from}-${section.title}`} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5, color: color.ink, cursor: 'pointer' }}>
              <Check checked={!section.skip} onChange={(read) => onRead(index, read)} label={`Read ${section.title}`} />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: section.skip ? color.muted : color.ink }}>{section.title}</span>
              <Mono size={11} tone={color.faint}>
                {docs.length > 1 ? `${docs.find((doc) => doc.n === section.doc)?.name ?? ''}, ` : ''}
                {sectionPages(section, docs)}
              </Mono>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TenderIntake({ onClose }: { onClose: () => void }): JSX.Element {
  const { state, dispatch, router } = useApp();
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>('choose');
  const [progress, setProgress] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [clock, setClock] = useState(0);
  const [error, setError] = useState('');
  const [probe, setProbe] = useState<AiProbe | null>(null);
  const [docs, setDocs] = useState<TenderDocument[]>([]);
  const [fit, setFit] = useState<FitResult | null>(null);
  /* the fit's outline, with the person's choice of what to read */
  const [outline, setOutline] = useState<TenderSection[]>([]);
  const [tokens, setTokens] = useState<TenderTokens>(NO_TOKENS);
  /* dollars agreed beyond the server's limit before the tender exists, handed to it on creation */
  const [aiApproved, setAiApproved] = useState(0);
  const [askMore, setAskMore] = useState(false);
  /* when the last request that read the documents started, and how many keep-warms have gone out */
  const [lastReadAt, setLastReadAt] = useState(0);
  const [warmSent, setWarmSent] = useState(0);
  const [platform, setPlatform] = useState('');
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [due, setDue] = useState('');
  const [dragging, setDragging] = useState(false);
  const [readTerms, setReadTerms] = useState(false);

  const uploaded = useRef<string[]>([]);
  const handedOver = useRef(false);
  /* set once the modal is gone, so an upload still in flight is deleted when it lands */
  const closed = useRef(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    tenderProbe()
      .then((answer) => live && setProbe(answer))
      .catch(() => live && setProbe({ ok: false, configured: false, model: '' }));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'working') return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  /* The tender is cached for five minutes from the start of the last read, and the person may take
     longer than that to choose. Keep it warm while they do (see `nextKeepWarm`), so the first
     extraction reads it rather than paying for all of it again. A failed keep-warm stops them: the
     worst that follows is one fresh write, not a loop of failing requests. */
  const aiLimit = probe?.limit && probe.limit > 0 ? probe.limit : DEFAULT_AI_LIMIT;
  const allowance = aiLimit + aiApproved;
  const overLimit = tokens.usd >= allowance;

  useEffect(() => {
    /* a keep-warm is spending too, so it stops at the limit like everything else */
    if (phase !== 'fit' || docs.length === 0 || overLimit) return;
    const at = nextKeepWarm(lastReadAt, warmSent);
    if (at === null) return;
    let live = true;
    const timer = window.setTimeout(() => {
      const started = Date.now();
      tenderWarm(docs.map(({ n, name, kind, fileId, pages }) => ({ n, name, kind, fileId, pages })))
        .then(({ tokens: spent }) => {
          if (!live) return;
          setTokens((total) => addTokens(total, spent));
          setLastReadAt(started);
          setWarmSent((count) => count + 1);
        })
        .catch(() => {
          if (live) setWarmSent(KEEP_WARM_MAX);
        });
    }, Math.max(0, at - Date.now()));
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [phase, docs, lastReadAt, warmSent, overLimit]);

  /* Navigating away mid-way still deletes the uploads. `closed` is reset on mount because
     StrictMode runs this cleanup once straight after the first mount in development. */
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      if (!handedOver.current && uploaded.current.length > 0) void tenderDiscard(uploaded.current).catch(() => undefined);
    };
  }, []);

  const forgetUploads = (): void => {
    if (uploaded.current.length > 0) void tenderDiscard(uploaded.current).catch(() => undefined);
    uploaded.current = [];
    setDocs([]);
    setFit(null);
    setOutline([]);
  };

  const close = (): void => {
    closed.current = true;
    if (!handedOver.current) forgetUploads();
    onClose();
  };

  const addFiles = (chosen: FileList | null): void => {
    if (!chosen || chosen.length === 0) return;
    const next = [...files];
    for (const file of Array.from(chosen)) {
      if (!next.some((one) => one.name === file.name && one.size === file.size)) next.push(file);
    }
    /* a different set of files is a different tender: what was uploaded for the old set goes */
    forgetUploads();
    setFiles(next);
    setError(checkTenderFiles(next) ?? '');
  };

  const removeFile = (file: File): void => {
    forgetUploads();
    const next = files.filter((one) => one !== file);
    setFiles(next);
    setError(next.length > 0 ? checkTenderFiles(next) ?? '' : '');
  };

  /* `approved` is passed by Continue, which has only just set it, so this call cannot see it in state yet */
  const read = async (approved = aiApproved): Promise<void> => {
    const problem = checkTenderFiles(files);
    if (problem) {
      setError(problem);
      return;
    }
    if (tokens.usd >= aiLimit + approved) {
      setAskMore(true);
      return;
    }
    setAskMore(false);
    setError('');
    setPhase('working');
    setStartedAt(Date.now());
    setClock(Date.now());

    let current = docs;
    try {
      if (current.length !== files.length) {
        current = [];
        for (const [index, file] of files.entries()) {
          setProgress(`Preparing ${file.name}`);
          const prepared = await prepareTenderFile(file.name, new Uint8Array(await file.arrayBuffer()));
          setProgress(`Uploading ${file.name} (${index + 1} of ${files.length})`);
          const stored = await tenderUpload(prepared.name, prepared.kind, prepared.body);
          if (closed.current) {
            void tenderDiscard([stored.fileId]).catch(() => undefined);
            return;
          }
          uploaded.current.push(stored.fileId);
          current.push({
            n: index + 1,
            name: file.name,
            kind: prepared.kind,
            bytes: prepared.body.length,
            pages: prepared.pages,
            ...(prepared.span ? { span: prepared.span } : {}),
            fileId: stored.fileId,
            expiresAt: stored.expiresAt
          });
        }
        setDocs(current);
      }

      setProgress('Reading the tender and weighing the platforms');
      const fitStarted = Date.now();
      const answer = await tenderFit(
        current.map(({ n, name: docName, kind, fileId, pages }) => ({ n, name: docName, kind, fileId, pages })),
        platformDigest(PRACTICES, state.loadedCatalogs)
      );
      if (closed.current) return;
      setDocs(current.map((doc) => ({ ...doc, pages: answer.result.pages[doc.n] || doc.pages })));
      setTokens((total) => addTokens(total, answer.tokens));
      setFit(answer.result);
      setOutline(answer.result.outline);
      setLastReadAt(fitStarted);
      setWarmSent(0);
      setPlatform(answer.result.fit.platform || state.platform || state.lastPlatform || '');
      setName(answer.result.header.title);
      setClient(answer.result.header.client);
      setDue(answer.result.header.deadline);
      setPhase('fit');
    } catch (failure) {
      if (failure instanceof TenderApiError && failure.tokens) {
        const spent = failure.tokens;
        setTokens((total) => addTokens(total, spent));
      }
      /* an upload that stopped half way leaves nothing worth keeping */
      if (current.length !== files.length) forgetUploads();
      setError(failure instanceof Error ? failure.message : String(failure));
      setPhase('choose');
    }
  };

  const proceed = (): void => {
    if (!fit || !platform) {
      setError('Choose the platform this tender belongs on.');
      return;
    }
    if (!name.trim()) {
      setError('Give the tender a name.');
      return;
    }
    const id = `TND-${Date.now().toString(36)}`;
    dispatch({
      type: 'createTender',
      id,
      input: { plat: platform, name: name.trim(), client: client.trim(), due, summary: fit.header.summary, docs, fit: fit.fit, outline, tokens, aiLimit, aiApproved, readTerms }
    });
    /* the fit call or the last keep-warm left the tender cached, so extraction can start at full width */
    noteTenderRead(id, lastReadAt);
    handedOver.current = true;
    router.navigate({ screen: 'tender', platform, tender: id });
    onClose();
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const notConfigured = probe !== null && !probe.configured;
  const choices = fit ? [fit.fit.platform, ...fit.fit.alternatives.map((alternative) => alternative.platform)].filter(Boolean) : [];
  const elapsed = Math.max(0, Math.round((clock - startedAt) / 1000));

  const header = (
    <>
      <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700 }}>Start from a tender</div>
      <div style={{ fontSize: 13, color: color.muted, lineHeight: 1.55, marginTop: 4, maxWidth: 620 }}>
        Upload the tender and its annexes. The AI reads them, recommends the platform they belong on and pulls out the requirements for
        you to review. Nothing is added to an estimation or sent to the desk until you approve it.
      </div>
    </>
  );

  return (
    <Modal title={header} onClose={close} width={760} padding="26px 28px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
        {notConfigured ? (
          <Banner tone="bad">
            The AI is not set up on this deployment: <Mono>ANTHROPIC_API_KEY</Mono> is not set on the server. Add it in the Vercel project
            settings (or <Mono>.env</Mono> locally) and reload.
          </Banner>
        ) : null}

        {phase === 'choose' ? (
          <>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              style={{
                border: `1.5px dashed ${dragging ? color.brand : color.dashRule}`,
                background: dragging ? color.brandWashSoft : color.surfaceSoft,
                borderRadius: radius.lg,
                padding: '26px 20px',
                textAlign: 'center',
                transition: 'border-color 120ms ease, background 120ms ease'
              }}
            >
              <input
                ref={picker}
                type="file"
                multiple
                accept=".pdf,.docx,.xlsx,.txt,.md,.csv"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = '';
                }}
                style={{ display: 'none' }}
              />
              <Button tone="brand" onClick={() => picker.current?.click()}>
                Choose files
              </Button>
              <div style={{ fontSize: 12.5, color: color.muted, marginTop: 10 }}>
                or drop them here. PDF, Word (.docx), Excel (.xlsx) or text, up to {MAX_FILES} files. PDFs up to 4 MB each for now.
              </div>
            </div>

            {files.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {files.map((file) => (
                  <Row key={`${file.name}-${file.size}`} gap={10} style={{ border: `1px solid ${color.hairline}`, borderRadius: radius.md, padding: '8px 12px' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: color.ink, overflowWrap: 'anywhere' }}>{file.name}</span>
                    <Mono size={11} tone={color.faint}>
                      {sizeLabel(file.size)}
                    </Mono>
                    <Spacer />
                    <TextButton onClick={() => removeFile(file)} title={`Remove ${file.name}`}>
                      Remove
                    </TextButton>
                  </Row>
                ))}
              </div>
            ) : null}

            <TermsChoice on={readTerms} onChange={setReadTerms} docs={files.length} />

            <div style={{ fontSize: 11.5, color: color.faint, lineHeight: 1.55 }}>
              The files go to Anthropic&apos;s API for this analysis and nowhere else. They are deleted there when you finish with the tender,
              or automatically after 72 hours.
            </div>
            <div style={{ fontSize: 11.5, color: color.faint, lineHeight: 1.55 }}>
              If the tender comes as both a PDF and a Word or Excel file, the Word or Excel copy costs much less to read: the AI reads each
              PDF page as text and as an image. Keep the PDF when its scans or diagrams matter.
            </div>

            {error ? <Banner tone="bad">{error}</Banner> : null}

            {askMore && overLimit ? (
              <Banner tone="warn">
                <div role="status" style={{ fontWeight: 600 }}>
                  {limitQuestion(tokens.usd, allowance, aiLimit, 'reading it again is another call')}
                </div>
                <Row gap={10} style={{ marginTop: 8 }}>
                  <Button
                    size="sm"
                    tone="primary"
                    onClick={() => {
                      const approved = Math.max(allowance, tokens.usd);
                      setAiApproved(approved);
                      void read(approved);
                    }}
                  >
                    Continue
                  </Button>
                  <Button size="sm" onClick={() => setAskMore(false)}>
                    Not now
                  </Button>
                </Row>
              </Banner>
            ) : null}

            <Row gap={10}>
              <Button tone="primary" onClick={() => void read()} disabled={files.length === 0 || notConfigured}>
                {docs.length === files.length && docs.length > 0 ? 'Try reading it again' : 'Read the tender'}
              </Button>
              <Button onClick={close}>Cancel</Button>
            </Row>
          </>
        ) : null}

        {phase === 'working' ? (
          <div role="status" style={{ border: `1px solid ${color.brandEdge}`, background: color.brandWashTint, borderRadius: radius.lg, padding: '18px 20px' }}>
            <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 600 }}>{progress}</div>
            <div style={{ fontSize: 12.5, color: color.muted, marginTop: 6, lineHeight: 1.55 }}>
              {elapsed}s so far. A long tender takes a minute or two to read; keep this window open.
            </div>
          </div>
        ) : null}

        {phase === 'fit' && fit ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Field label="Tender name" value={name} onChange={setName} placeholder="What the deal is called" />
              <Field label="Client" value={client} onChange={setClient} placeholder="Issuing organisation" />
              <Field label="Submission deadline" type="date" value={due} onChange={setDue} />
            </div>
            {fit.header.summary ? <p style={{ fontSize: 13, color: color.body, lineHeight: 1.6, margin: 0 }}>{fit.header.summary}</p> : null}
            <Mono block size={11} tone={color.faint}>
              {docs.map((doc) => `${doc.name}, ${documentLength(doc)}`).join(' / ')}
            </Mono>

            <div>
              <Row gap={8}>
                <span style={{ fontFamily: font.display, fontSize: 15, fontWeight: 600 }}>Which platform does it belong on?</span>
                {fit.fit.platform ? <ConfidenceChip value={fit.fit.confidence} /> : null}
              </Row>
              <div role="radiogroup" aria-label="Platform" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {choices.map((id, index) => (
                  <PlatformChoice
                    key={id}
                    id={id}
                    picked={platform === id}
                    recommended={index === 0}
                    reasons={index === 0 ? fit.fit.reasons : fit.fit.alternatives.filter((one) => one.platform === id).map((one) => one.reason)}
                    onPick={() => setPlatform(id)}
                  />
                ))}
              </div>
              <div style={{ marginTop: 10, maxWidth: 360 }}>
                <Select
                  label="Or another platform"
                  value={choices.includes(platform) ? '' : platform}
                  options={[{ value: '', label: 'Choose any platform…' }, ...ALL_PLATFORMS]}
                  onChange={(value) => value && setPlatform(value)}
                />
              </div>
            </div>

            <ReadingPlan
              docs={docs}
              outline={outline}
              onRead={(index, read) =>
                setOutline((current) =>
                  current.map((section, at) => (at === index ? { doc: section.doc, title: section.title, from: section.from, to: section.to, ...(read ? {} : { skip: true }) } : section))
                )
              }
            />

            {fit.fit.elsewhere.length > 0 ? (
              <Banner tone="warn">
                Parts of this tender belong on another platform. They will come up as custom or out of scope here; you can estimate them on
                that platform separately.
                <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {fit.fit.elsewhere.map((part) => (
                    <li key={`${part.platform}-${part.what}`}>
                      <strong>{platformName(part.platform)}</strong>: {part.what}
                    </li>
                  ))}
                </ul>
              </Banner>
            ) : null}

            {/* still open to change here: it is fixed once the tender exists */}
            <TermsChoice on={readTerms} onChange={setReadTerms} docs={docs.length} />

            {error ? <Banner tone="bad">{error}</Banner> : null}

            <Row gap={10}>
              <Button tone="primary" onClick={proceed} disabled={!platform}>
                {platform ? `Continue with ${platformName(platform)}` : 'Choose a platform'}
              </Button>
              <Button onClick={() => setPhase('choose')}>Back</Button>
              <Button tone="ghost" onClick={close}>
                Cancel
              </Button>
              <Spacer />
              <Mono size={10.5} tone={color.faint}>
                {tokenSummary(tokens)}. {spendSummary(tokens.usd, allowance)}
              </Mono>
            </Row>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
