import type {
  Catalog,
  EstimateGroup,
  EstimateRequest,
  EstimateResult,
  EstimationSnapshot,
  RateRole,
  RoleCostRow,
  Solution
} from '@/types';
import { roleColor } from '@/theme';

/**
 * The estimate, computed from a snapshot. Pure: same inputs, same numbers — which is what
 * lets the estimation desk price a deal it does not have open, and lets this be unit-tested.
 *
 * Cost is worked out line by line against the rate card, because a senior hour and a DevOps
 * hour are not the same money. Lines with no role fall back to the blended rate.
 */

export const DEFAULT_ROLES: readonly RateRole[] = [
  { id: 'sr', name: 'Senior Engineer', rate: 55 },
  { id: 'eng', name: 'Engineer', rate: 45 },
  { id: 'devops', name: 'DevOps', rate: 50 },
  { id: 'qa', name: 'QA Engineer', rate: 35 },
  { id: 'pm', name: 'Project Manager', rate: 40 }
];

export const DEFAULT_RATE = 60;

export function rolesOf(snap: Pick<EstimationSnapshot, 'roles'> | null | undefined): RateRole[] {
  const roles = snap?.roles;
  return Array.isArray(roles) && roles.length > 0 ? roles : [...DEFAULT_ROLES];
}

/** Ids a request has claimed as its catalog entry — those lines bill through the request. */
export function ownedCatalogIds(requests: readonly EstimateRequest[]): Record<string, string> {
  const owned: Record<string, string> = {};
  for (const r of requests) if (r.csId) owned[r.csId] = r.id;
  return owned;
}

export interface EstimateOptions {
  /** Overhead defaults when the snapshot leaves them unset. */
  defaultRate?: number;
  pmPct?: number;
  qaPct?: number;
}

export function calcEstimate(
  catalog: Catalog,
  snap: EstimationSnapshot,
  requests: readonly EstimateRequest[],
  opts: EstimateOptions = {}
): EstimateResult {
  const selected = snap.sel ?? {};
  const buf = snap.buf ?? {};
  const rate = snap.rate ?? opts.defaultRate ?? DEFAULT_RATE;
  const pm = snap.pm ?? opts.pmPct ?? 0;
  const qa = snap.qa ?? opts.qaPct ?? 0;
  const bufPct = Number(snap.bufPct) || 0;

  const owned = ownedCatalogIds(requests);
  const selIds: string[] = [];
  const groups: EstimateGroup[] = [];
  const accounts = new Set<string>();
  let first = 0;
  let repeat = 0;
  let build = 0;
  let firstRecorded = 0;
  let buildRecorded = 0;
  let inDev = 0;
  let noEst = 0;

  for (const bundle of catalog.bundles) {
    const items = bundle.items.filter((it) => selected[it.id] && !owned[it.id]);
    if (items.length === 0) continue;
    let groupFirst = 0;
    let groupRepeat = 0;
    for (const it of items) {
      selIds.push(it.id);
      if (it.first !== null) {
        first += it.first;
        groupFirst += it.first;
      }
      if (it.repeat !== null) {
        repeat += it.repeat;
        groupRepeat += it.repeat;
      }
      if (it.build !== null) build += it.build;
      if (it.first !== null && it.build !== null) {
        firstRecorded += it.first;
        buildRecorded += it.build;
      }
      if (it.status === 'In Development') inDev += 1;
      else if (it.first === null) noEst += 1;
      if (it.account) {
        for (const acct of it.account.split(';').map((s) => s.trim()).filter(Boolean)) accounts.add(acct);
      }
    }
    groups.push({ id: bundle.id, name: bundle.name, items, first: groupFirst, repeat: groupRepeat });
  }

  let estSum = 0;
  let pend = 0;
  for (const r of requests) {
    const value = r.est !== undefined && r.est !== null ? Number(r.est) : 0;
    if (value > 0) estSum += value;
    else pend += 1;
  }

  let itemBufSum = 0;
  for (const id of selIds) {
    const value = Number(buf[id]);
    if (value > 0) itemBufSum += value;
  }

  const pctH = ((first + estSum + itemBufSum) * bufPct) / 100;
  const bufH = itemBufSum + pctH;
  const baseAll = first + estSum + bufH;
  const pmH = (baseAll * pm) / 100;
  const qaH = (baseAll * qa) / 100;
  const grand = baseAll + pmH + qaH;

  /* ---- cost by role ---- */

  const roles = rolesOf(snap);
  const lineRole = snap.lineRole ?? {};
  const byId = new Map<string, RateRole & { color: string }>();
  roles.forEach((r, i) => byId.set(r.id, { ...r, color: roleColor(i) }));

  const bufferFactor = 1 + bufPct / 100;
  const agg = new Map<string, RoleCostRow>();

  const bill = (lineId: string, hrs: number): void => {
    if (!(hrs > 0)) return;
    const role = byId.get(lineRole[lineId] ?? '');
    const key = role?.id ?? '_';
    const lineRate = role ? Number(role.rate) : rate;
    const row =
      agg.get(key) ??
      ({
        id: key,
        name: role?.name ?? 'Unassigned · blended',
        rate: lineRate,
        color: role?.color ?? '#8F8F8B',
        hrs: 0,
        cost: 0,
        assigned: Boolean(role)
      } satisfies RoleCostRow);
    row.hrs += hrs;
    row.cost += hrs * lineRate;
    agg.set(key, row);
  };

  const byIdSolution = new Map<string, Solution>();
  for (const g of groups) for (const it of g.items) byIdSolution.set(it.id, it);
  for (const id of selIds) {
    const it = byIdSolution.get(id);
    if (!it) continue;
    const lineBuf = Number(buf[id]) > 0 ? Number(buf[id]) : 0;
    bill(id, ((it.first ?? 0) + lineBuf) * bufferFactor);
  }
  for (const r of requests) if (Number(r.est) > 0) bill(r.id, Number(r.est) * bufferFactor);

  const overheadRole = (kind: 'pm' | 'qa'): (RateRole & { color: string }) | null => {
    const preferred = kind === 'pm' ? snap.pmRole : snap.qaRole;
    const direct = byId.get(preferred ?? kind);
    if (direct) return direct;
    const pattern = kind === 'pm' ? /project|manager|^pm$/i : /qa|quality/i;
    const found = roles.map((r, i) => ({ ...r, color: roleColor(i) })).find((r) => pattern.test(r.name));
    return found ?? null;
  };

  const addOverhead = (kind: 'pm' | 'qa', hrs: number, label: string): void => {
    if (!(hrs > 0)) return;
    const role = overheadRole(kind);
    agg.set(`ov-${kind}`, {
      id: `ov-${kind}`,
      name: `${label} · ${role?.name ?? 'blended'}`,
      rate: role ? Number(role.rate) : rate,
      color: role?.color ?? '#8F8F8B',
      hrs,
      cost: hrs * (role ? Number(role.rate) : rate),
      assigned: Boolean(role),
      overhead: true
    });
  };

  addOverhead('pm', pmH, 'PM overhead');
  addOverhead('qa', qaH, 'QA overhead');

  const roleRows = [...agg.values()].sort(
    (a, b) => Number(a.overhead ?? false) - Number(b.overhead ?? false) || b.cost - a.cost
  );
  const usdExact = roleRows.reduce((sum, r) => sum + r.cost, 0);
  const assignedH = roleRows.filter((r) => r.assigned && !r.overhead).reduce((sum, r) => sum + r.hrs, 0);
  const unassignedH = agg.get('_')?.hrs ?? 0;

  return {
    rate,
    pm,
    qa,
    pmH,
    qaH,
    estSum,
    pend,
    itemBufSum,
    bufPct,
    pctH,
    bufH,
    selIds,
    groups,
    first,
    repeat,
    build,
    inDev,
    noEst,
    accts: [...accounts],
    grand,
    savedPct: buildRecorded > 0 ? Math.round((1 - firstRecorded / buildRecorded) * 100) : null,
    roles,
    roleRows,
    assignedH,
    unassignedH,
    lineRole,
    effRate: grand > 0 ? usdExact / grand : rate,
    usd: Math.round(usdExact),
    days: grand / 8,
    weeks: grand / 40
  };
}
