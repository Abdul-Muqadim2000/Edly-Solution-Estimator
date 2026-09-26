import type { Tender, TenderStage } from '@/types';
import { useApp } from '@/state/AppProvider';
import { platformTenders } from '@/state/reducer';
import { tenderCounts } from '@/domain/tender';
import { plural } from '@/lib/format';
import { color, dueInfo, font, radius, shadow } from '@/theme';
import { useHover } from '@/lib/useHover';
import { Label, Row, Spacer } from '@/components/ui';

/** Where tenders show up outside their own screen: a strip on the hub, and the way in. */

const STAGE_LABEL: Record<TenderStage, { label: string; bg: string; co: string }> = {
  requirements: { label: 'Reviewing requirements', bg: color.amberWash, co: color.amberInk },
  match: { label: 'Matching to the catalog', bg: color.violetWash, co: color.violet },
  apply: { label: 'Ready to apply', bg: color.brandWash, co: color.brandInk },
  done: { label: 'Sent to the desk', bg: color.surfaceMuted, co: color.muted }
};

function TenderCard({ tender, onOpen }: { tender: Tender; onOpen: () => void }): JSX.Element {
  const h = useHover();
  const counts = tenderCounts(tender);
  const stage = STAGE_LABEL[tender.stage];
  const due = dueInfo(tender.due);
  return (
    <button
      type="button"
      onClick={onOpen}
      {...h.bind}
      style={{
        textAlign: 'left',
        width: '100%',
        background: color.surface,
        border: `1px solid ${h.on ? color.brand : color.hairline}`,
        borderRadius: radius.xl,
        padding: '16px 18px',
        cursor: 'pointer',
        fontFamily: font.body,
        boxShadow: h.on ? shadow.lift : 'none',
        transition: 'border-color 140ms ease, box-shadow 140ms ease'
      }}
    >
      <Row gap={8} align="flex-start" wrap={false}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: font.display, fontSize: 15.5, fontWeight: 600, lineHeight: 1.3, color: color.ink }}>{tender.name}</div>
          <div style={{ fontSize: 12, color: color.faint, marginTop: 2 }}>{tender.client || 'No client set'}</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', borderRadius: radius.pill, padding: '4px 9px', background: stage.bg, color: stage.co, whiteSpace: 'nowrap' }}>
          {stage.label}
        </span>
      </Row>
      <Row gap={8} style={{ marginTop: 12, fontSize: 12, color: color.body }}>
        <span>{plural(counts.total, 'requirement')}</span>
        <span style={{ color: color.faint }}>/</span>
        <span>{counts.reviewed} accepted</span>
        {counts.toDesk > 0 ? (
          <>
            <span style={{ color: color.faint }}>/</span>
            <span>{counts.toDesk} for the desk</span>
          </>
        ) : null}
        <Spacer />
        {due ? <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: radius.pill, padding: '3px 9px', background: due.bg, color: due.co }}>{due.label}</span> : null}
      </Row>
    </button>
  );
}

/** The platform's tenders, newest first. Nothing at all when there are none. */
export function TenderStrip(): JSX.Element | null {
  const { state, router } = useApp();
  const tenders = platformTenders(state);
  if (tenders.length === 0) return null;
  return (
    <section style={{ marginTop: 24 }} aria-label="Tenders">
      <Label>Tenders</Label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginTop: 10 }}>
        {tenders.map((tender) => (
          <TenderCard key={tender.id} tender={tender} onOpen={() => router.navigate({ screen: 'tender', tender: tender.slug || tender.id })} />
        ))}
      </div>
    </section>
  );
}

/** The way in from the practice picker, where no platform is chosen yet. */
export function TenderStartCard({ onStart }: { onStart: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onStart}
      {...h.bind}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px 14px',
        width: '100%',
        textAlign: 'left',
        marginTop: 20,
        background: h.on ? color.brandWashSoft : color.surface,
        border: `1.5px dashed ${h.on ? color.brand : color.brandEdge}`,
        borderRadius: radius.lg,
        padding: '16px 20px',
        cursor: 'pointer',
        fontFamily: font.body,
        transition: 'border-color 140ms ease, background 140ms ease'
      }}
    >
      <span style={{ fontFamily: font.display, fontSize: 15, fontWeight: 600, color: color.ink }}>Start from a tender</span>
      <span style={{ fontSize: 13, color: color.muted, flex: '1 1 320px' }}>
        Upload an RFP. The AI reads it, suggests the platform it belongs on and drafts the requirements for you to review.
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: color.brandDeep }}>Upload ›</span>
    </button>
  );
}
