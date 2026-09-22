import type {
  EstimateRequest,
  EstimateResult,
  EstimationSnapshot,
  PlanEntry,
  PlanTask,
  RateRole,
  Schedule
} from '@/types';
import { roleColor } from '@/theme';

/**
 * The delivery planner.
 *
 * Duration is derived, never typed: hours ÷ (people × hours per person per week). Putting a
 * second engineer on a task genuinely halves its bar. A task the user dragged is pinned and
 * holds its week; everything else is packed into the earliest slot where headcount stays
 * within the parallel-work cap.
 */

export const SNAP = 0.5;
export const DEFAULT_HPW = 40;
export const DEFAULT_MAX_PARALLEL = 4;
const MAX_PEOPLE = 8;

export const hoursPerWeek = (snap: EstimationSnapshot): number =>
  Math.max(4, Math.min(60, Number(snap.hpw) || DEFAULT_HPW));

export const maxParallel = (snap: EstimationSnapshot): number =>
  Math.max(1, Math.min(20, Number(snap.maxPar) || DEFAULT_MAX_PARALLEL));

export interface TaskSeed {
  key: string;
  name: string;
  group: string;
  kind: 'sol' | 'custom' | 'buffer';
  hrs: number;
}

/** The work items to schedule, before staffing and placement are applied. */
export function planSeeds(
  estimate: EstimateResult,
  requests: readonly EstimateRequest[],
  snap: EstimationSnapshot,
  opts: { blendBuffer?: boolean } = {}
): TaskSeed[] {
  const factor = opts.blendBuffer ? 1 + estimate.bufPct / 100 : 1;
  const buf = snap.buf ?? {};
  const seeds: TaskSeed[] = [];

  for (const group of estimate.groups) {
    for (const item of group.items) {
      const lineBuf = Number(buf[item.id]) > 0 ? Number(buf[item.id]) : 0;
      const hrs = ((item.first ?? 0) + lineBuf) * factor;
      if (hrs > 0) seeds.push({ key: item.id, name: item.name, group: group.id, kind: 'sol', hrs });
    }
  }
  for (const r of requests) {
    if (Number(r.est) > 0) {
      seeds.push({ key: r.id, name: r.title, group: 'Custom', kind: 'custom', hrs: Number(r.est) * factor });
    }
  }
  if (!opts.blendBuffer && estimate.pctH > 0) {
    seeds.push({ key: 'BUF', name: `Risk buffer (${estimate.bufPct}%)`, group: 'Risk', kind: 'buffer', hrs: estimate.pctH });
  }
  return seeds;
}

export function schedule(
  estimate: EstimateResult,
  requests: readonly EstimateRequest[],
  snap: EstimationSnapshot,
  opts: { blendBuffer?: boolean } = {}
): Schedule {
  const plan = snap.plan ?? {};
  const hpw = hoursPerWeek(snap);
  const cap = maxParallel(snap);
  const lineRole = snap.lineRole ?? {};

  const byRoleId = new Map<string, RateRole & { color: string }>();
  estimate.roles.forEach((r, i) => byRoleId.set(r.id, { ...r, color: roleColor(i) }));

  const tasks: PlanTask[] = planSeeds(estimate, requests, snap, opts)
    .map((seed, index): PlanTask => {
      const entry: PlanEntry = plan[seed.key] ?? {};
      const people = Math.max(1, Math.min(MAX_PEOPLE, Number(entry.people) || 1));
      /* the rate card is the single source for who does the work; entry.role is legacy */
      const roleId = lineRole[seed.key] ?? entry.role ?? '';
      return {
        ...seed,
        people,
        role: byRoleId.get(roleId) ?? null,
        roleId,
        dur: Math.max(SNAP, Math.ceil(seed.hrs / (people * hpw) / SNAP) * SNAP),
        order: entry.order ?? index,
        pinned: entry.start !== undefined && entry.start !== null,
        start: entry.start !== undefined && entry.start !== null ? Math.max(0, Number(entry.start)) : 0
      };
    })
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

  /* pinned rows hold their week; the rest take the first slot with headroom */
  const load: number[] = [];
  const slot = (week: number): number => Math.round(week / SNAP);
  const commit = (start: number, dur: number, people: number): void => {
    for (let w = slot(start); w < slot(start + dur); w++) load[w] = (load[w] ?? 0) + people;
  };
  const fits = (start: number, dur: number, people: number): boolean => {
    for (let w = slot(start); w < slot(start + dur); w++) if ((load[w] ?? 0) + people > cap) return false;
    return true;
  };

  for (const task of tasks) if (task.pinned) commit(task.start, task.dur, task.people);
  for (const task of tasks) {
    if (task.pinned) continue;
    let start = 0;
    let guard = 0;
    while (!fits(start, task.dur, task.people) && guard < 800) {
      start += SNAP;
      guard += 1;
    }
    task.start = start;
    commit(start, task.dur, task.people);
  }

  let end = 0;
  for (const task of tasks) end = Math.max(end, task.start + task.dur);
  end = Math.max(end, SNAP);
  const weeks = Math.max(1, Math.ceil(end));

  const bars: PlanTask[] = [...tasks];
  const spanBar = (key: string, name: string, hrs: number): PlanTask => ({
    key,
    name,
    group: 'Overhead',
    kind: 'span',
    hrs,
    start: 0,
    dur: end,
    people: 0,
    role: null,
    roleId: '',
    order: 999,
    pinned: false,
    span: true
  });
  if (estimate.pm > 0) bars.push(spanBar('PM', `PM overhead (${estimate.pm}%)`, estimate.pmH));
  if (estimate.qa > 0) bars.push(spanBar('QA', `QA overhead (${estimate.qa}%)`, estimate.qaH));

  const lane: number[] = [];
  for (let w = 0; w < weeks / SNAP; w++) lane.push(load[w] ?? 0);
  const peak = lane.reduce((max, n) => Math.max(max, n), 0);

  return {
    tasks,
    bars,
    weeks,
    end,
    peak,
    lane,
    cap,
    hpw,
    over: peak > cap,
    people: tasks.reduce((max, t) => Math.max(max, t.people), 0)
  };
}

/** Reorder in the auto-sequencing order, returning the plan patch to apply. */
export function reorder(tasks: readonly PlanTask[], key: string, direction: -1 | 1): Record<string, PlanEntry> {
  const from = tasks.findIndex((t) => t.key === key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= tasks.length) return {};
  const next = [...tasks];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  const patch: Record<string, PlanEntry> = {};
  next.forEach((task, index) => {
    patch[task.key] = { order: index };
  });
  return patch;
}

/** People needed to bring a task down to a target duration — the resize-handle maths. */
export function peopleForDuration(hrs: number, hpw: number, targetWeeks: number): number {
  const target = Math.max(SNAP, targetWeeks);
  return Math.max(1, Math.min(MAX_PEOPLE, Math.round(hrs / (hpw * target)) || 1));
}
