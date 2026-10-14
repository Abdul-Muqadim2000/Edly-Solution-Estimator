import { useState } from 'react';
import type { TenderDocument, TenderRequirement } from '@/types';
import type { Action } from '@/state/reducer';
import { idList, sourceLabel, type RepeatSet } from '@/domain/tender';
import { color, font, radius } from '@/theme';
import { useHover } from '@/lib/useHover';
import { Button, Modal, Mono, Row, Spacer } from '@/components/ui';
import { PriorityToggle, RequirementBody, TopicChip, useDialogKeys } from '@/components/tender/parts';

/** One requirement of the set, ticked to keep by clicking anywhere on it: the checkbox's label is the whole card. */
function KeepCard({
  req,
  docs,
  kept,
  suggested,
  onToggle
}: {
  req: TenderRequirement;
  docs: TenderDocument[];
  kept: boolean;
  suggested: boolean;
  onToggle: () => void;
}): JSX.Element {
  const hover = useHover();
  return (
    <label
      {...hover.bind}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '14px 16px',
        borderRadius: radius.md,
        borderStyle: 'solid',
        borderWidth: 1,
        borderColor: kept ? color.brand : hover.on ? color.ghost : color.hairline,
        boxShadow: kept ? `inset 0 0 0 1px ${color.brand}` : 'none',
        background: kept ? color.brandWashPale : color.surfaceSoft,
        cursor: 'pointer',
        minWidth: 0,
        transition: 'border-color 120ms ease'
      }}
    >
      <Row gap={8}>
        <input type="checkbox" checked={kept} onChange={onToggle} style={{ margin: 0, accentColor: color.brand, width: 16, height: 16 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: kept ? color.brandInk : color.muted }}>{kept ? 'Keep' : 'Remove'}</span>
        <Mono size={11} tone={color.brandDeep}>
          {req.id}
        </Mono>
        <PriorityToggle value={req.priority} />
        {req.topic ? <TopicChip topic={req.topic} /> : null}
        <Spacer />
        {suggested ? <span style={{ fontSize: 11, fontWeight: 700, color: color.brandInk }}>AI suggests keeping</span> : null}
      </Row>
      <RequirementBody req={req} struck={!kept} />
      <div style={{ fontSize: 11.5, color: color.faint, marginTop: 2 }}>
        {sourceLabel(req, docs)}
        {req.section ? `, ${req.section}` : ''}
      </div>
      {req.quote ? (
        <blockquote
          style={{
            margin: '2px 0 0',
            padding: '7px 11px',
            borderLeft: `3px solid ${color.brandEdge}`,
            background: color.brandWashTint,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: color.inkSoft,
            fontStyle: 'italic'
          }}
        >
          “{req.quote}”
        </blockquote>
      ) : null}
    </label>
  );
}

/**
 * A set of requirements that ask for the same work, side by side, so a person keeps what states it
 * best: usually one of them, or the parts when a broad item lists things the tender also states one by
 * one. The AI proposed the set and what to keep; nothing changes until a button here is pressed, and
 * what is removed stays under Removed, marked as a repeat, until someone restores it.
 */
export function RepeatCompare({
  tenderId,
  entry,
  docs,
  dispatch,
  onClose
}: {
  tenderId: string;
  entry: RepeatSet;
  docs: TenderDocument[];
  dispatch: (action: Action) => void;
  onClose: () => void;
}): JSX.Element {
  const [keep, setKeep] = useState<Set<string>>(() => new Set(entry.keep));
  const box = useDialogKeys(onClose);
  const kept = entry.reqs.filter((req) => keep.has(req.id)).map((req) => req.id);
  const removed = entry.reqs.filter((req) => !keep.has(req.id)).map((req) => req.id);
  const toggle = (id: string): void =>
    setKeep((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const title = (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: color.amberInk }}>Asked for more than once</div>
      <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, marginTop: 4, lineHeight: 1.3 }}>{entry.reqs.length} requirements ask for the same work</div>
      {entry.note ? <div style={{ fontSize: 13, color: color.body, lineHeight: 1.55, marginTop: 6, maxWidth: 820 }}>{entry.note}</div> : null}
    </div>
  );

  return (
    <Modal title={title} onClose={onClose} width={1120} padding="24px 28px">
      <div ref={box} tabIndex={-1} role="dialog" aria-label="Requirements that ask for the same work" style={{ outline: 'none' }}>
        <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55, marginTop: 10, maxWidth: 860 }}>
          Estimating each of them would count the same work twice. Tick what to keep: the one that states it best, or, when one of them only lists
          things the others state in full, those others. What you keep takes Must if any of them is a must, and notes where else the tender asks for
          it, since the bid still answers each place. The rest move to Removed, marked as repeats, and can be restored.
        </div>

        <div role="group" aria-label="Which requirements to keep" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 16 }}>
          {entry.reqs.map((req) => (
            <KeepCard key={req.id} req={req} docs={docs} kept={keep.has(req.id)} suggested={entry.keep.includes(req.id)} onToggle={() => toggle(req.id)} />
          ))}
        </div>

        <Row gap={10} style={{ marginTop: 18, justifyContent: 'flex-end' }}>
          {kept.length === 0 ? <span style={{ fontSize: 12, color: color.redInk }}>Tick at least one to keep.</span> : null}
          {removed.length === 0 ? <span style={{ fontSize: 12, color: color.muted }}>Every one is ticked, which is the same as saying they are different.</span> : null}
          <Button
            onClick={() => {
              dispatch({ type: 'dismissRepeat', id: tenderId, set: entry.set });
              onClose();
            }}
            title="Keep all of them: they ask for different work"
          >
            They are different
          </Button>
          <Button
            tone="primary"
            disabled={kept.length === 0 || removed.length === 0}
            onClick={() => {
              dispatch({ type: 'keepRepeat', id: tenderId, set: entry.set, keep: kept });
              onClose();
            }}
          >
            {kept.length === 0 || removed.length === 0 ? 'Keep and remove' : `Keep ${idList(kept)}, remove ${idList(removed)}`}
          </Button>
        </Row>
      </div>
    </Modal>
  );
}
