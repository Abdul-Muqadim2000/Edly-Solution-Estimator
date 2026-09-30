import type { Estimation } from '@/types';
import { useApp } from '@/state/AppProvider';
import { requestsFor } from '@/state/reducer';
import { isDemoEstimation } from '@/domain/demo';
import { calcEstimate } from '@/domain/estimate';
import { deskCounts, ESTIMATION_STAGES, FINISHED_SHOWN, hubOrder, showsRoleGap, stageOf, stageTally } from '@/domain/stages';
import { color, dueInfo, font, shadow, tagStyle } from '@/theme';
import { hours, money, plural } from '@/lib/format';
import { pressable } from '@/lib/pressable';
import { Chip, DemoTag, Mono, Row, Spacer, useRowHover } from '@/components/ui';
import { Board } from '@/components/Board';
import { StagePicker } from '@/components/stages';
import { AssignControl, DEMO_ASSIGN } from '@/components/people';

/** The hub as a board: a column per stage, the deals in it, and their hours at the top. */
export function EstimationBoard({ rows }: { rows: Estimation[] }): JSX.Element {
  const { dispatch } = useApp();
  return (
    <div style={{ marginTop: 14 }}>
      <Board
        label="Estimations by stage"
        columns={ESTIMATION_STAGES}
        items={rows}
        idOf={idOf}
        nameOf={nameOf}
        columnOf={stageOf}
        order={hubOrder}
        collapse={{ done: FINISHED_SHOWN }}
        onMove={(estimation, stage) => dispatch({ type: 'patchEstimation', id: estimation.id, patch: { stage } })}
        tally={(items) => {
          if (items.length === 0) return '';
          const tally = stageTally(items);
          return `${hours(tally.hours)} h${tally.demo ? ' + demo' : ''}`;
        }}
        renderCard={(estimation) => <DealCard estimation={estimation} />}
        emptyText="No deals at this stage"
      />
    </div>
  );
}

const idOf = (estimation: Estimation): string => estimation.id;
const nameOf = (estimation: Estimation): string => estimation.name;

function DealCard({ estimation }: { estimation: Estimation }): JSX.Element {
  const { state, dispatch, router, catalog } = useApp();
  const hover = useRowHover({ borderColor: color.brand, boxShadow: shadow.lift });
  const requests = requestsFor(state, estimation.id);
  const numbers = calcEstimate(catalog, estimation.snap, requests);
  const counts = deskCounts(requests);
  const stage = stageOf(estimation);
  const due = dueInfo(estimation.due);
  const tag = estimation.tag || 'Active';
  const roleGap = showsRoleGap(stage) && numbers.unassignedH > 0;

  return (
    <div
      {...hover.bind}
      style={{
        background: color.surface,
        /* longhands, because the hover changes the colour */
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: counts.needsInfo > 0 ? color.roseEdge : counts.waiting > 0 ? color.amberEdge : color.hairline,
        borderRadius: 12,
        boxShadow: '0 1px 2px rgba(20, 20, 20, 0.05)',
        transition: 'border-color 140ms ease, box-shadow 140ms ease',
        ...hover.style
      }}
    >
      <div
        {...pressable(() => router.navigate({ screen: 'builder', estimation: estimation.slug || estimation.id }))}
        style={{ padding: '12px 13px 10px', cursor: 'pointer', borderRadius: 12 }}
      >
        <Row gap={8} align="flex-start" wrap={false}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: font.display,
                fontSize: 14,
                fontWeight: 600,
                lineHeight: 1.3,
                color: color.ink,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}
            >
              {estimation.name}
            </div>
            <div style={{ fontSize: 11.5, color: color.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {estimation.client || 'No client set'}
            </div>
          </div>
          {isDemoEstimation(estimation) ? <DemoTag size="sm" /> : null}
        </Row>

        <Row gap={5} align="baseline" wrap={false} style={{ marginTop: 10 }}>
          <span style={{ fontFamily: font.display, fontSize: 19, fontWeight: 700, lineHeight: 1, letterSpacing: -0.3, color: color.ink }}>{hours(numbers.grand)}</span>
          <span style={{ fontSize: 11, color: color.faint }}>h</span>
          <Spacer />
          {numbers.usd > 0 ? (
            <Mono size={11.5} tone={color.brandDeep}>
              {money(numbers.usd, estimation.snap.cur ?? 'USD')}
            </Mono>
          ) : null}
        </Row>

        {tag !== 'Active' || due || counts.waiting > 0 || counts.needsInfo > 0 || roleGap ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
            {tag !== 'Active' ? (
              <Chip bg={tagStyle(tag).bg} co={tagStyle(tag).co}>
                {tag}
              </Chip>
            ) : null}
            {due ? (
              <Chip bg={due.bg} co={due.co}>
                {due.label}
              </Chip>
            ) : null}
            {counts.needsInfo > 0 ? (
              <Chip bg={color.roseWash} co={color.roseInk} title="The desk has asked for more detail. Open the deal to see which request.">
                {`${counts.needsInfo} ${counts.needsInfo === 1 ? 'needs' : 'need'} info`}
              </Chip>
            ) : null}
            {counts.waiting - counts.needsInfo > 0 ? (
              <Chip bg={color.amberWash} co={color.amberInk}>
                {`${counts.waiting - counts.needsInfo} awaiting estimate`}
              </Chip>
            ) : null}
            {roleGap ? (
              <Chip bg={color.surfaceMuted} co={color.inkSoft} title="Hours with no rate-card role are priced at the blended rate">
                {`${hours(numbers.unassignedH)} h without a role`}
              </Chip>
            ) : null}
          </div>
        ) : null}
      </div>

      <Row gap={6} wrap={false} style={{ padding: '6px 8px 7px 8px', borderTop: `1px solid ${color.hairlineSoft}` }}>
        <StagePicker
          stages={ESTIMATION_STAGES}
          value={stage}
          onChange={(next) => dispatch({ type: 'patchEstimation', id: estimation.id, patch: { stage: next } })}
          variant="move"
          stepper
        />
        <AssignControl ticket="deal" id={estimation.id} assigned={estimation.assigned} size={20} disabledReason={isDemoEstimation(estimation) ? DEMO_ASSIGN : undefined} />
        <Spacer />
        <span style={{ fontSize: 10.5, color: color.quiet, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, paddingRight: 5 }} title={`${plural(numbers.selIds.length, 'solution')}, ${plural(requests.length, 'custom item')}`}>
          {estimation.up || estimation.at ? `Updated ${estimation.up || estimation.at}` : ''}
        </span>
      </Row>
    </div>
  );
}
