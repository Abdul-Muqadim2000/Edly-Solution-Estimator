import { useMemo, useState, type ReactNode } from 'react';
import type { RateRole } from '@/types';
import { useApp } from '@/state/AppProvider';
import { openRequests } from '@/state/reducer';
import { DEFAULT_ROLES, rolesOf } from '@/domain/estimate';
import { color, font, radius, roleColor } from '@/theme';
import { hours, money, plural } from '@/lib/format';
import { Button, Mono, Popover, Row, Select, Spacer, useRowHover } from '@/components/ui';

/**
 * The rate card, and who is on each line.
 *
 * A senior hour and a DevOps hour are not the same money, so cost is worked out per line.
 * Tick several lines and assign a role in one go — the reason this is a panel rather than a
 * per-row dropdown only.
 */
/** One billable line in the assignment list. */
function RateLine({ picked, children }: { picked: boolean; children: ReactNode }): JSX.Element {
  const hover = useRowHover({ borderColor: color.brand, background: picked ? '#EDF9F5' : color.surfaceSoft });
  return (
    <div
      {...hover.bind}
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        alignItems: 'center',
        gap: 8,
        border: `1px solid ${picked ? color.brand : color.hairline}`,
        background: picked ? '#F5FCFA' : color.surface,
        borderRadius: radius.md,
        padding: '7px 10px',
        transition: 'border-color 120ms ease, background 120ms ease',
        ...hover.style
      }}
    >
      {children}
    </div>
  );
}

export function RatesPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { state, dispatch, estimate } = useApp();
  const requests = openRequests(state);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const roles = rolesOf(state.draft);
  const currency = state.draft.cur ?? 'USD';
  const lineRole = state.draft.lineRole ?? {};
  const factor = 1 + estimate.bufPct / 100;

  const lines = useMemo(() => {
    const out: { id: string; name: string; where: string; hrs: number; role: (RateRole & { color: string }) | null }[] = [];
    const byId = new Map(roles.map((role, index) => [role.id, { ...role, color: roleColor(index) }]));
    for (const group of estimate.groups) {
      for (const item of group.items) {
        const buffer = Number(state.draft.buf?.[item.id]) || 0;
        out.push({
          id: item.id,
          name: item.name,
          where: group.id,
          hrs: ((item.first ?? 0) + buffer) * factor,
          role: byId.get(lineRole[item.id] ?? '') ?? null
        });
      }
    }
    for (const request of requests) {
      if (Number(request.est) > 0) {
        out.push({
          id: request.id,
          name: request.title,
          where: 'Custom',
          hrs: Number(request.est) * factor,
          role: byId.get(lineRole[request.id] ?? '') ?? null
        });
      }
    }
    return out;
  }, [estimate.groups, requests, roles, lineRole, state.draft.buf, factor]);

  const pickedIds = Object.keys(picked).filter((id) => picked[id]);
  const editRole = (index: number, patch: Partial<RateRole>): void => {
    dispatch({ type: 'setRoles', roles: roles.map((role, i) => (i === index ? { ...role, ...patch } : role)) });
  };

  return (
    <Popover width={520}>
      <Row gap={10} wrap={false}>
        <span style={{ flex: 1, fontFamily: font.display, fontSize: 14, fontWeight: 600 }}>Rate card &amp; who does the work</span>
        <Button size="sm" tone="ghost" onClick={onClose} style={{ background: color.surfaceMuted, width: 24, height: 24, padding: 0 }}>
          ×
        </Button>
      </Row>
      <div style={{ fontSize: 11.5, color: color.muted, lineHeight: 1.55, marginTop: 4 }}>
        Rates are entered in USD per hour. Overhead is priced at the Project Manager and QA rates automatically.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {roles.map((role, index) => (
          <Row key={role.id} gap={8} wrap={false}>
            <span style={{ width: 8, height: 8, borderRadius: radius.pill, background: roleColor(index), flex: '0 0 auto' }} />
            <input
              value={role.name}
              onChange={(event) => editRole(index, { name: event.target.value })}
              style={{ flex: 1, minWidth: 0, border: `1px solid ${color.hairline}`, borderRadius: 7, padding: '7px 9px', fontSize: 12.5, color: color.ink, outline: 'none' }}
            />
            <input
              type="number"
              min={0}
              value={role.rate}
              onChange={(event) => editRole(index, { rate: Math.max(0, Number(event.target.value) || 0) })}
              style={{ flex: '0 0 76px', border: `1px solid ${color.hairline}`, borderRadius: 7, padding: '7px 9px', fontSize: 12.5, fontFamily: font.mono, color: color.ink, outline: 'none' }}
            />
            <Button
              size="sm"
              tone="ghost"
              title="Remove role"
              onClick={() => {
                dispatch({ type: 'setRoles', roles: roles.filter((_, i) => i !== index) });
                dispatch({ type: 'assignRole', ids: Object.keys(lineRole).filter((id) => lineRole[id] === role.id), roleId: null });
              }}
              style={{ padding: '2px 5px', fontSize: 15 }}
            >
              ×
            </Button>
          </Row>
        ))}
      </div>

      <Row gap={6} style={{ marginTop: 8 }}>
        <Button
          size="sm"
          onClick={() => dispatch({ type: 'setRoles', roles: [...roles, { id: `r${Date.now().toString(36)}`, name: 'New role', rate: 50 }] })}
          style={{ border: `1px dashed ${color.ghost}`, background: 'transparent', color: color.muted }}
        >
          + Add role
        </Button>
        <Button size="sm" onClick={() => dispatch({ type: 'setRoles', roles: [...DEFAULT_ROLES] })}>
          Reset to defaults
        </Button>
      </Row>

      <div style={{ borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 14, paddingTop: 12 }}>
        <Row gap={8} align="baseline">
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>Assign rates</span>
          <Spacer />
          <Button
            size="sm"
            tone="ghost"
            onClick={() => setPicked(pickedIds.length === lines.length ? {} : Object.fromEntries(lines.map((line) => [line.id, true])))}
            style={{ color: color.brandDeep, padding: 0 }}
          >
            {pickedIds.length === lines.length && lines.length > 0 ? 'Untick all' : 'Tick all'}
          </Button>
        </Row>
        <div style={{ fontSize: 11.5, color: color.muted, lineHeight: 1.55, marginTop: 3 }}>
          {pickedIds.length > 0
            ? `${plural(pickedIds.length, 'line')} ticked — give them a rate:`
            : 'Tick lines below, then choose a rate. Anything left blank bills at the blended rate.'}
        </div>

        <Row gap={6} style={{ marginTop: 8 }}>
          {roles.map((role, index) => (
            <Button
              key={role.id}
              size="sm"
              pill
              disabled={pickedIds.length === 0}
              onClick={() => {
                dispatch({ type: 'assignRole', ids: pickedIds, roleId: role.id });
                setPicked({});
              }}
              style={{ background: pickedIds.length > 0 ? roleColor(index) : color.onDark, color: pickedIds.length > 0 ? '#FFFFFF' : color.ghost, border: 'none' }}
            >
              {role.name} · {money(role.rate, currency)}
            </Button>
          ))}
          <Button
            size="sm"
            pill
            disabled={pickedIds.length === 0}
            onClick={() => {
              dispatch({ type: 'assignRole', ids: pickedIds, roleId: null });
              setPicked({});
            }}
          >
            Back to blended
          </Button>
        </Row>

        {lines.length === 0 ? (
          <div style={{ fontSize: 12, color: color.faint, marginTop: 10 }}>Nothing selected yet — pick solutions first and they show up here.</div>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
          {lines.map((line) => (
            <RateLine key={line.id} picked={Boolean(picked[line.id])}>
              <input
                type="checkbox"
                checked={Boolean(picked[line.id])}
                onChange={() => setPicked((prev) => ({ ...prev, [line.id]: !prev[line.id] }))}
                style={{ width: 15, height: 15, accentColor: color.brand, cursor: 'pointer', flex: '0 0 auto' }}
              />
              <span style={{ flex: 1, minWidth: 100, fontSize: 12.5, lineHeight: 1.4 }}>{line.name}</span>
              <Mono size={11}>{hours(line.hrs)} h</Mono>
              <span style={{ flex: '0 0 150px' }}>
                <Select
                  value={line.role?.id ?? ''}
                  options={[{ value: '', label: 'Blended rate' }, ...roles.map((role) => ({ value: role.id, label: `${role.name} · ${money(role.rate, currency)}/h` }))]}
                  onChange={(value) => dispatch({ type: 'assignRole', ids: [line.id], roleId: value || null })}
                />
              </span>
              <Mono size={11.5} tone={color.ink}>
                {money(line.hrs * (line.role ? line.role.rate : estimate.rate), currency)}
              </Mono>
            </RateLine>
          ))}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 14, paddingTop: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>Cost by role</div>
        {estimate.roleRows.map((row) => (
          <div key={row.id} style={{ marginTop: 8 }}>
            <Row gap={8} align="baseline" wrap={false}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: color.inkSoft }}>{row.name}</span>
              <Mono size={11} tone={color.faint}>
                {hours(row.hrs)} h × {money(row.rate, currency)}
              </Mono>
              <Mono size={12} tone={color.ink}>
                {money(row.cost, currency)}
              </Mono>
            </Row>
            <div style={{ height: 5, borderRadius: radius.pill, background: color.hairlineSoft, marginTop: 3 }}>
              <div
                style={{
                  height: 5,
                  borderRadius: radius.pill,
                  width: estimate.grand > 0 ? `${Math.max(2, Math.round((row.hrs / estimate.grand) * 100))}%` : '0%',
                  background: row.color
                }}
              />
            </div>
          </div>
        ))}
        <Row gap={12} align="baseline" style={{ borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 10, paddingTop: 9 }} wrap={false}>
          <span style={{ fontSize: 12, color: color.muted }}>{money(estimate.effRate, currency)}/h effective</span>
          <Spacer />
          <span style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700 }}>{money(estimate.usd, currency)}</span>
        </Row>
        {estimate.unassignedH > 0 ? (
          <div style={{ fontSize: 11, color: color.amber, marginTop: 4 }}>{hours(estimate.unassignedH)} h still on the blended rate</div>
        ) : null}
      </div>
    </Popover>
  );
}

