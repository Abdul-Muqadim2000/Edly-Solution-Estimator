import type { EstimateResult, EstimationSnapshot, Schedule, SeniorityLevel } from '@/types';
import { SNAP } from '@/domain/planner';

/**
 * Who the delivery needs: one row per rate-card role, with its seniority, its hours and cost, and
 * how many people in that role the delivery plan has working at once.
 *
 * Two sources, on purpose. The rate card says who does each line and at what rate, so hours and
 * cost come from the estimate's cost by role and add up to the grand total. The delivery plan says
 * how many people are on each bar and when, so headcount and weeks come from the schedule.
 */

export interface TeamRow {
  /** Rate-card role id; blank for work left on the blended rate. */
  roleId: string;
  role: string;
  level: SeniorityLevel | '';
  /** USD per hour. */
  rate: number;
  /** Everything the role bills, overhead included. */
  hours: number;
  /** USD. */
  cost: number;
  /** Most people in this role working at the same time in the delivery plan. */
  people: number;
  /** Weeks from its first bar to its last, from 1 and inclusive. Null when nothing is scheduled. */
  weeks: { from: number; to: number } | null;
  /** The overhead this role carries, which runs across the whole delivery. */
  carries: ('pm' | 'qa')[];
}

export interface Team {
  rows: TeamRow[];
  /** People needed across every role: one person does not fill two rows. */
  size: number;
  hours: number;
  cost: number;
  /** Weeks end to end. */
  weeks: number;
}

const UNASSIGNED = '';

export function teamComposition(estimate: EstimateResult, snap: Pick<EstimationSnapshot, 'lineRole'>, plan: Schedule): Team {
  const lineRole = snap.lineRole ?? {};
  const known = new Set(estimate.roles.map((role) => role.id));
  /* the same rule as billing: a line whose role is not on the card bills at the blended rate */
  const roleOf = (key: string): string => {
    const id = lineRole[key];
    return id && known.has(id) ? id : UNASSIGNED;
  };

  const hours = new Map<string, { hours: number; cost: number; carries: TeamRow['carries'] }>();
  for (const row of estimate.roleRows) {
    const id = row.overhead ? (row.roleId ?? UNASSIGNED) : row.id === '_' ? UNASSIGNED : row.id;
    const entry = hours.get(id) ?? { hours: 0, cost: 0, carries: [] };
    entry.hours += row.hrs;
    entry.cost += row.cost;
    if (row.id === 'ov-pm') entry.carries.push('pm');
    if (row.id === 'ov-qa') entry.carries.push('qa');
    hours.set(id, entry);
  }

  /* People per half-week slot, per role. The buffer bar is contingency time, not a person. */
  const slots = Math.max(1, Math.ceil(plan.end / SNAP));
  const load = new Map<string, number[]>();
  const span = new Map<string, { start: number; end: number }>();
  for (const task of plan.tasks) {
    if (task.kind === 'buffer' || task.span) continue;
    const id = roleOf(task.key);
    const lane = load.get(id) ?? new Array<number>(slots).fill(0);
    const first = Math.round(task.start / SNAP);
    const last = Math.min(slots, Math.round((task.start + task.dur) / SNAP));
    for (let s = first; s < last; s++) lane[s] = (lane[s] ?? 0) + task.people;
    load.set(id, lane);
    const seen = span.get(id);
    span.set(id, { start: Math.min(seen?.start ?? task.start, task.start), end: Math.max(seen?.end ?? 0, task.start + task.dur) });
  }
  const end = Math.max(1, Math.ceil(plan.end));

  const rowFor = (id: string, name: string, level: SeniorityLevel | '', rate: number): TeamRow | null => {
    const billed = hours.get(id);
    if (!billed || !(billed.hours > 0)) return null;
    const peak = (load.get(id) ?? []).reduce((most, n) => Math.max(most, n), 0);
    const seen = span.get(id);
    /* overhead is somebody's job for the whole delivery, even with no bar of their own */
    const overhead = billed.carries.length > 0;
    const weeks = overhead
      ? { from: 1, to: end }
      : seen
        ? { from: Math.floor(seen.start) + 1, to: Math.max(Math.floor(seen.start) + 1, Math.ceil(seen.end)) }
        : null;
    return {
      roleId: id,
      role: name,
      level,
      rate,
      hours: billed.hours,
      cost: billed.cost,
      people: overhead ? Math.max(1, peak) : peak,
      weeks,
      carries: [...billed.carries].sort()
    };
  };

  /* rate-card order, which is the order sales set the card out in; the blended rate last */
  const rows = [
    ...estimate.roles.map((role) => rowFor(role.id, role.name, role.level ?? '', Number(role.rate))),
    rowFor(UNASSIGNED, 'Unassigned', '', estimate.rate)
  ].filter((row): row is TeamRow => row !== null);

  return {
    rows,
    size: rows.reduce((sum, row) => sum + row.people, 0),
    hours: rows.reduce((sum, row) => sum + row.hours, 0),
    cost: rows.reduce((sum, row) => sum + row.cost, 0),
    weeks: plan.tasks.length > 0 ? end : 0
  };
}
