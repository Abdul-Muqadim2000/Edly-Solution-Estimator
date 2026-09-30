import type { EstimateRequest, RequestStage } from '@/types';
import { useApp } from '@/state/AppProvider';
import { isDemoRequest } from '@/domain/demo';
import { FINISHED_SHOWN, pricedTally, TICKET_STAGES, ticketOrder, ticketStage } from '@/domain/stages';
import { color, dueInfo, font, radius, shadow } from '@/theme';
import { hours } from '@/lib/format';
import { pressable } from '@/lib/pressable';
import { Chip, DemoTag, Row, Spacer, useRowHover } from '@/components/ui';
import { Board } from '@/components/Board';
import { StagePicker } from '@/components/stages';

/**
 * The desk's queue as a board: a column per stage, a card per request.
 *
 * Estimated is the one column a card cannot simply be moved into, because hours are what put a
 * request there. Dropping one on it, or opening a card, hands the request to `onOpen`, which shows
 * the pricing form; a priced request stays where its hours put it.
 */
export function RequestBoard({ rows, onOpen }: { rows: EstimateRequest[]; onOpen: (request: EstimateRequest) => void }): JSX.Element {
  const { dispatch } = useApp();
  return (
    <div style={{ marginTop: 14 }}>
      <Board
        label="Requests by stage"
        columns={TICKET_STAGES}
        items={rows}
        idOf={idOf}
        nameOf={nameOf}
        columnOf={ticketStage}
        order={ticketOrder}
        collapse={{ estimated: FINISHED_SHOWN }}
        movable={(request) => ticketStage(request) !== 'estimated'}
        onMove={(request, to) => {
          if (to === 'estimated') onOpen(request);
          else dispatch({ type: 'setRequestStage', id: request.id, stage: to });
        }}
        tally={(items, column) => {
          if (column !== 'estimated' || items.length === 0) return '';
          const tally = pricedTally(items);
          return `${hours(tally.hours)} h${tally.demo ? ' + demo' : ''}`;
        }}
        renderCard={(request) => <TicketCard request={request} onOpen={() => onOpen(request)} />}
        emptyText="No requests here"
      />
    </div>
  );
}

const idOf = (request: EstimateRequest): string => request.id;
const nameOf = (request: EstimateRequest): string => `${request.id} ${request.title}`;

function TicketCard({ request, onOpen }: { request: EstimateRequest; onOpen: () => void }): JSX.Element {
  const { state, dispatch } = useApp();
  const hover = useRowHover({ borderColor: color.brand, boxShadow: shadow.lift });
  const stage = ticketStage(request);
  const priced = stage === 'estimated';
  const deal = state.estimations.find((one) => one.id === request.estId);
  const due = priced ? null : dueInfo(deal?.due);
  const chips = [request.area, request.urgency].filter(Boolean);

  return (
    <div
      {...hover.bind}
      style={{
        background: color.surface,
        /* longhands, because the hover changes the colour */
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: stage === 'info' ? color.roseEdge : color.hairline,
        borderRadius: 12,
        boxShadow: '0 1px 2px rgba(20, 20, 20, 0.05)',
        transition: 'border-color 140ms ease, box-shadow 140ms ease',
        ...hover.style
      }}
    >
      <div {...pressable(onOpen)} title={priced ? 'Open to see or update the estimate' : 'Open to price it'} style={{ padding: '11px 13px 10px', cursor: 'pointer', borderRadius: 12 }}>
        <Row gap={6} wrap={false}>
          <span style={{ fontFamily: font.mono, fontSize: 10.5, fontWeight: 600, color: color.brandDeep, background: color.brandWash, borderRadius: radius.sm, padding: '2px 7px' }}>
            {request.id}
          </span>
          {isDemoRequest(request) ? <DemoTag size="sm" /> : null}
          <Spacer />
          <span style={{ fontSize: 10.5, color: color.quiet, whiteSpace: 'nowrap' }}>{request.at}</span>
        </Row>
        <div
          style={{
            fontFamily: font.display,
            fontSize: 13.5,
            fontWeight: 600,
            lineHeight: 1.32,
            color: color.ink,
            marginTop: 8,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {request.title}
        </div>
        <div style={{ fontSize: 11.5, color: color.brandInk, fontWeight: 600, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {(request.estName || 'Unnamed estimation') + (request.client ? ` · ${request.client}` : '')}
        </div>
        {chips.length > 0 || due || request.tender ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 9 }}>
            {due ? (
              <Chip bg={due.bg} co={due.co}>
                {due.label}
              </Chip>
            ) : null}
            {request.tender ? (
              <Chip bg={color.violetWash} co={color.violet}>
                {`Tender ${request.tenderReq ?? ''}`.trim()}
              </Chip>
            ) : null}
            {chips.map((chip) => (
              <Chip key={chip} bg={color.surfaceMuted} co={color.inkSoft}>
                {chip}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      <Row gap={6} wrap={false} style={{ padding: '6px 8px 7px 8px', borderTop: `1px solid ${color.hairlineSoft}` }}>
        {priced ? (
          <span style={{ fontFamily: font.mono, fontSize: 11.5, fontWeight: 600, color: color.brandInk, padding: '3px 5px' }}>
            {hours(Number(request.est))} h
          </span>
        ) : (
          <StagePicker
            stages={TICKET_STAGES}
            value={stage}
            label="Desk status"
            /* Estimated opens the pricing form, like a drop on its column: hours are what put it there */
            onChange={(next) => (next === 'estimated' ? onOpen() : dispatch({ type: 'setRequestStage', id: request.id, stage: next as RequestStage }))}
            variant="move"
          />
        )}
        <Spacer />
        <span style={{ fontSize: 10.5, color: color.quiet, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 5 }}>
          {priced ? `by ${request.estBy || 'estimator'}${request.estAt ? ` · ${request.estAt}` : ''}` : request.name || request.org || 'Sales workspace'}
        </span>
      </Row>
    </div>
  );
}
