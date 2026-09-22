import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PlanTask } from '@/types';
import { useApp } from '@/state/AppProvider';
import { peopleForDuration, reorder, SNAP } from '@/domain/planner';
import { color, font, radius, roleColor } from '@/theme';
import { hours, hours1, plural } from '@/lib/format';
import { Banner, Button, Modal, Mono, Row, Select, Spacer } from '@/components/ui';
import { downloadGanttPng } from '@/lib/ganttPng';
import { useFocus } from '@/lib/useHover';

/**
 * The delivery planner.
 *
 * Duration is derived from staffing, so the two ways to change a bar are moving it (drag the
 * body, which pins it to a week) and restaffing it (drag the right handle or use the steppers,
 * which changes how long it takes). Everything unpinned auto-packs inside the team cap.
 */
/** The planner header's controls sit on one line, label beside field, as in the source. */
function InlineField({
  label,
  hint,
  width,
  ...input
}: { label: string; hint: string; width: number | string } & React.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const focus = useFocus();
  return (
    <label
      title={hint}
      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: color.muted }}
    >
      {label}
      <input
        {...input}
        {...focus.bind}
        style={{
          width,
          border: `1px solid ${focus.on ? color.brand : color.rule}`,
          borderRadius: 8,
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: font.mono,
          fontWeight: 400,
          letterSpacing: 'normal',
          textTransform: 'none',
          color: color.ink,
          background: color.fieldBg,
          outline: 'none'
        }}
      />
    </label>
  );
}

export function Planner({ onClose }: { onClose: () => void }): JSX.Element {
  const { state, dispatch, plan, estimate, display } = useApp();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState('');
  const [downloaded, setDownloaded] = useState(false);

  const step = plan.weeks > 20 ? Math.ceil(plan.weeks / 12) : 1;
  const ticks: number[] = [];
  for (let week = 0; week < plan.weeks; week += step) ticks.push(week);
  const percent = (value: number): string => `${((value / plan.weeks) * 100).toFixed(3)}%`;

  /* Memoised so the `dateAt` callback below is not rebuilt on every render. */
  const start = useMemo(() => (state.draft.planStart ? new Date(`${state.draft.planStart}T00:00:00`) : null), [state.draft.planStart]);
  const dateAt = useCallback(
    (week: number): string => {
      if (!start) return '';
      return new Date(start.getTime() + Math.round(week * 7) * 86_400_000).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    },
    [start]
  );

  const barColor = (task: PlanTask): string => {
    if (task.span) return color.overhead;
    if (task.role) {
      const index = estimate.roles.findIndex((role) => role.id === task.role?.id);
      return index >= 0 ? roleColor(index) : color.brand;
    }
    if (task.kind === 'custom') return color.custom;
    if (task.kind === 'buffer') return color.buffer;
    /* unassigned must not share a colour with any role, or assigning one looks like a no-op */
    return color.unassigned;
  };

  const beginDrag = (event: ReactPointerEvent, task: PlanTask, mode: 'move' | 'size'): void => {
    if (event.button !== 0 || task.span || !display.controls) return;
    event.preventDefault();
    const track = (event.currentTarget as HTMLElement).closest('[data-track]') as HTMLElement | null;
    const width = track?.getBoundingClientRect().width ?? 600;
    const pxPerWeek = width / plan.weeks;
    const startX = event.clientX;
    const originStart = task.start;
    const originDuration = task.dur;

    const move = (native: PointerEvent): void => {
      const deltaWeeks = (native.clientX - startX) / pxPerWeek;
      if (mode === 'move') {
        const week = Math.max(0, Math.round((originStart + deltaWeeks) / SNAP) * SNAP);
        dispatch({ type: 'setPlanEntry', key: task.key, entry: { start: week } });
      } else {
        const people = peopleForDuration(task.hrs, plan.hpw, originDuration + deltaWeeks);
        dispatch({ type: 'setPlanEntry', key: task.key, entry: { people } });
      }
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging('');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    setDragging(task.key);
  };

  const title = (
    <>
      <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700 }}>Delivery timeline</div>
      <div style={{ fontSize: 12.5, color: color.muted, marginTop: 2 }}>
        {hours1(plan.end)} weeks end to end · {hours(estimate.grand)} h · {plan.hpw} h per person per week · peak{' '}
        {plural(plan.peak, 'person')} at once{start ? ` · finishes ${dateAt(plan.end)}` : ''}
      </div>
    </>
  );

  return (
    <Modal title={title} onClose={onClose}>
      <Row gap={12} style={{ marginTop: 16 }}>
        <InlineField
          label="h / person / wk"
          hint="Productive hours one person contributes in a week"
          width={66}
          type="number"
          min={4}
          max={60}
          value={String(plan.hpw)}
          onChange={(event) => dispatch({ type: 'patchDraft', patch: { hpw: Math.max(4, Math.min(60, Number(event.target.value) || 40)) } })}
        />
        <InlineField
          label="Team cap"
          hint="How many people can work in parallel — auto-sequencing never exceeds this"
          width={58}
          type="number"
          min={1}
          max={20}
          value={String(plan.cap)}
          onChange={(event) => dispatch({ type: 'patchDraft', patch: { maxPar: Math.max(1, Math.min(20, Number(event.target.value) || 4)) } })}
        />
        <InlineField
          label="Kick-off"
          hint="Kick-off date — the week columns then show real dates"
          width="auto"
          type="date"
          value={state.draft.planStart ?? ''}
          onChange={(event) => dispatch({ type: 'patchDraft', patch: { planStart: event.target.value } })}
        />
        <Spacer />
        <Button
          title="Unpin every bar and pack the work back-to-back within the team cap"
          onClick={() => dispatch({ type: 'patchPlan', patch: Object.fromEntries(plan.tasks.map((task) => [task.key, { start: undefined }])) })}
          style={{ borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 600 }}
        >
          Auto-sequence
        </Button>
        <Button
          tone="primary"
          onClick={() => {
            downloadGanttPng(
              plan.bars.map((task) => ({ name: task.name, start: task.start, dur: task.dur, hrs: task.hrs, color: barColor(task), span: task.span })),
              plan.weeks,
              plan.cap
            );
            setDownloaded(true);
            window.setTimeout(() => setDownloaded(false), 2200);
          }}
          style={{ borderRadius: 8, padding: '10px 16px', fontSize: 12.5 }}
        >
          {downloaded ? '✓ PNG downloaded' : '⤓ Download PNG'}
        </Button>
      </Row>

      {plan.over ? (
        <div style={{ marginTop: 14 }}>
          <Banner tone="bad">
            Peak {plan.peak} people exceeds the {plan.cap}-person cap — pinned bars overlap.
          </Banner>
        </div>
      ) : null}

      {plan.tasks.length === 0 ? (
        <div style={{ marginTop: 20, border: `1px dashed ${color.rule}`, borderRadius: radius.lg, padding: 34, textAlign: 'center', fontSize: 13.5, color: color.muted }}>
          Nothing to schedule yet — select solutions or add custom items first.
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '424px minmax(0, 1fr)', gap: '0 10px', alignItems: 'end' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.9, textTransform: 'uppercase', color: color.ghost, paddingBottom: 4 }}>
              Work item · who · people
            </div>
            <div>
              <div style={{ position: 'relative', height: 26 }} title={`People on the work each half-week — cap ${plan.cap}`}>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'flex-end', height: 24 }}>
                  {plan.lane.map((people, index) => (
                    <span
                      key={index}
                      style={{
                        width: `${(100 / Math.max(1, plan.lane.length)).toFixed(3)}%`,
                        height: Math.max(2, Math.round((people / Math.max(1, Math.max(plan.peak, plan.cap))) * 22)),
                        background: people > plan.cap ? color.red : people === 0 ? color.gridLine : color.brandBar,
                        borderRight: `1px solid ${color.onSolid}`
                      }}
                    />
                  ))}
                </div>
              </div>
              <div ref={trackRef} style={{ position: 'relative', height: 16, borderBottom: `1px solid ${color.hairlineSoft}` }}>
                {ticks.map((week) => (
                  <span
                    key={week}
                    style={{
                      position: 'absolute',
                      left: percent(week),
                      width: percent(Math.min(step, plan.weeks - week)),
                      textAlign: 'center',
                      fontFamily: font.mono,
                      fontSize: 9.5,
                      color: color.ghost
                    }}
                  >
                    W{week + 1}
                  </span>
                ))}
              </div>
              {start ? (
                <div style={{ position: 'relative', height: 15 }}>
                  {ticks.map((week) => (
                    <span
                      key={week}
                      style={{
                        position: 'absolute',
                        left: percent(week),
                        width: percent(Math.min(step, plan.weeks - week)),
                        textAlign: 'center',
                        fontFamily: font.mono,
                        fontSize: 9,
                        color: color.onDarkDim
                      }}
                    >
                      {dateAt(week)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {plan.bars.map((task, index) => {
            const editable = !task.span && display.controls;
            const tone = barColor(task);
            const when = start ? `${dateAt(task.start)} → ${dateAt(task.start + task.dur)}` : `W${Math.floor(task.start) + 1} → W${Math.ceil(task.start + task.dur)}`;

            return (
              <div
                key={task.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '424px minmax(0, 1fr)',
                  gap: '0 10px',
                  alignItems: 'center',
                  padding: '3px 0',
                  borderTop: `1px solid ${color.surfaceMuted}`,
                  background: dragging === task.key ? color.brandWashSoft : 'transparent'
                }}
              >
                <Row gap={6} wrap={false}>
                  {editable ? (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: '0 0 auto' }}>
                      <Button
                        size="sm"
                        tone="ghost"
                        title="Move earlier in the order"
                        onClick={() => dispatch({ type: 'patchPlan', patch: reorder(plan.tasks, task.key, -1) })}
                        style={{ background: color.surfaceMuted, width: 16, height: 11, padding: 0, fontSize: 7, borderRadius: 3 }}
                      >
                        ▲
                      </Button>
                      <Button
                        size="sm"
                        tone="ghost"
                        title="Move later in the order"
                        onClick={() => dispatch({ type: 'patchPlan', patch: reorder(plan.tasks, task.key, 1) })}
                        style={{ background: color.surfaceMuted, width: 16, height: 11, padding: 0, fontSize: 7, borderRadius: 3 }}
                      >
                        ▼
                      </Button>
                    </span>
                  ) : null}
                  <span
                    title={`${task.name} — ${when} · ${Math.round(task.hrs)} h`}
                    style={{ flex: 1, minWidth: 0, fontSize: 12, color: color.inkSoft, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {task.name}
                  </span>
                  {editable ? (
                    <>
                      <span style={{ flex: '0 0 96px' }}>
                        <Select
                          value={task.role?.id ?? ''}
                          hint={`Who does this work — billed at ${task.role ? task.role.rate : estimate.rate} USD/h. Shared with the rate card.`}
                          options={[{ value: '', label: 'Unassigned' }, ...estimate.roles.map((role) => ({ value: role.id, label: role.name }))]}
                          onChange={(value) => dispatch({ type: 'assignRole', ids: [task.key], roleId: value || null })}
                        />
                      </span>
                      <Row gap={2} wrap={false}>
                        <Button
                          size="sm"
                          title="One fewer person — longer bar"
                          onClick={() => dispatch({ type: 'setPlanEntry', key: task.key, entry: { people: Math.max(1, task.people - 1) } })}
                          style={{ width: 17, height: 17, padding: 0, fontSize: 11, borderRadius: 4 }}
                        >
                          −
                        </Button>
                        <Mono size={10} tone={color.ink}>
                          {task.people}
                        </Mono>
                        <Button
                          size="sm"
                          title="Add a person — shorter bar"
                          onClick={() => dispatch({ type: 'setPlanEntry', key: task.key, entry: { people: Math.min(8, task.people + 1) } })}
                          style={{ width: 17, height: 17, padding: 0, fontSize: 11, borderRadius: 4 }}
                        >
                          +
                        </Button>
                      </Row>
                      <Button
                        size="sm"
                        tone="ghost"
                        title={task.pinned ? `Pinned to week ${task.start + 1} — click to hand it back to auto-sequencing` : 'Auto-sequenced — drag the bar to pin it to a week'}
                        onClick={() => dispatch({ type: 'setPlanEntry', key: task.key, entry: { start: undefined } })}
                        style={{ color: task.pinned ? color.brandDeep : color.dashRule, padding: 2, fontSize: 10 }}
                      >
                        ●
                      </Button>
                    </>
                  ) : null}
                </Row>

                <div data-track="1" style={{ position: 'relative', height: 24, background: task.span ? color.surfaceSoft : color.trackSoft, borderRadius: radius.sm }}>
                  <div
                    onPointerDown={(event) => beginDrag(event, task, 'move')}
                    title={`${when} · ${Math.round(task.hrs)}h · ${hours1(task.dur)}w — drag to move`}
                    style={{
                      position: 'absolute',
                      top: 3,
                      bottom: 3,
                      left: percent(task.start),
                      width: percent(task.dur),
                      background: tone,
                      opacity: task.span ? 0.38 : 1,
                      borderRadius: 5,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 6px',
                      cursor: editable ? 'grab' : 'default',
                      touchAction: 'none',
                      overflow: 'hidden',
                      zIndex: plan.bars.length - index
                    }}
                  >
                    <Mono size={9.5} tone={color.onSolid}>
                      {Math.round(task.hrs)}h · {hours1(task.dur)}w
                    </Mono>
                    <Spacer />
                    {editable ? (
                      <span
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginDrag(event, task, 'size');
                        }}
                        title="Drag to trade people for calendar time"
                        style={{ width: 9, height: 13, borderRadius: 3, background: 'rgba(255,255,255,0.55)', cursor: 'ew-resize', flex: '0 0 auto', touchAction: 'none' }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}

          <Row gap={10} style={{ marginTop: 14 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.9, textTransform: 'uppercase', color: color.ghost }}>Level staffing</span>
            {[1, 2, 3].map((people) => (
              <Button
                key={people}
                size="sm"
                pill
                onClick={() => dispatch({ type: 'levelPeople', keys: plan.tasks.map((task) => task.key), people })}
              >
                {people === 1 ? 'Everyone solo' : `${people} per task`}
              </Button>
            ))}
            <Button size="sm" pill tone="danger" onClick={() => dispatch({ type: 'resetPlan' })}>
              Reset plan
            </Button>
            <Spacer />
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>≈ {hours1(plan.end)} weeks end-to-end</span>
          </Row>

          <Row gap={14} style={{ marginTop: 12, borderTop: `1px solid ${color.surfaceMuted}`, paddingTop: 12, fontSize: 11.5, color: color.muted }}>
            {estimate.roles.map((role, index) => (
              <span key={role.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: roleColor(index) }} />
                {role.name}
              </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: color.unassigned }} />
              Unassigned
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: color.custom }} />
              Custom
            </span>
          </Row>

          <div style={{ fontSize: 11, color: color.faint, lineHeight: 1.55, marginTop: 8 }}>
            Drag a bar to move it, drag its right handle to trade people for calendar time. A bar you move is pinned (green dot)
            and holds its week; everything else auto-packs within the team cap. Duration = hours ÷ (people × h per person per
            week), rounded to half-weeks.
          </div>
        </div>
      )}
    </Modal>
  );
}
