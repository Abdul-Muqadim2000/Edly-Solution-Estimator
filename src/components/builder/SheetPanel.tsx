import { useState, type ReactNode } from 'react';
import { useApp } from '@/state/AppProvider';
import { openEstimationRecord, openRequests } from '@/state/reducer';
import { findPlatform } from '@/data/practices';
import { SHEET_COLUMNS, SHEET_SECTIONS, sheetBlockers, type SheetColumnId, type SheetSectionId } from '@/domain/taskBreakdown';
import { DEFAULT_RATE } from '@/domain/estimate';
import { defaultComments, downloadTaskBreakdown, sheetBreakdown, type SheetInput } from '@/lib/quoteExport';
import { money, rateLabel } from '@/lib/format';
import { color, font, radius } from '@/theme';
import { Button, Field, Popover, Row, TextArea } from '@/components/ui';
import { useFocus, useHover } from '@/lib/useHover';

/**
 * What goes in the downloaded Excel sheet.
 *
 * The Display panel decides what the screen shows; this one decides what the file contains, and
 * the two are separate on purpose. Sales often wants the client's copy to carry the estimate while
 * the screen they are sharing does not, or the other way round. The columns Edly's task-breakdown
 * template has are listed first and ticked, and everything else the catalog knows can be added.
 */

/** Everything the workbook needs, from the open estimation. Null when none is open. */
export function useSheetInput(): SheetInput | null {
  const { state, estimate, plan, display, catalog } = useApp();
  const estimation = openEstimationRecord(state);
  if (!estimation) return null;
  return {
    estimation,
    snap: state.draft,
    estimate,
    requests: openRequests(state),
    plan,
    bundles: catalog.bundles,
    prefs: state.sheet,
    blendBuffer: display.blendBuffer,
    currency: state.draft.cur ?? 'USD',
    platformName: findPlatform(state.platform)?.platform.name ?? '',
    sample: catalog.meta.sample === true
  };
}

function Check({
  label,
  sub,
  checked,
  onChange,
  locked,
  warn
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Always on, and says so. */
  locked?: boolean;
  /** The sub-line explains why a ticked box will not appear. */
  warn?: boolean;
}): JSX.Element {
  const hover = useHover();
  const focus = useFocus();
  return (
    <label
      {...hover.bind}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '7px 6px',
        borderRadius: radius.md,
        cursor: locked ? 'default' : 'pointer',
        background: hover.on && !locked ? color.surfaceMuted : 'transparent',
        transition: 'background 120ms ease'
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(event) => onChange(event.target.checked)}
        {...focus.bind}
        style={{
          width: 16,
          height: 16,
          flex: '0 0 16px',
          margin: '1px 0 0',
          accentColor: color.brand,
          cursor: 'inherit',
          outline: focus.on ? `2px solid ${color.brand}` : 'none',
          outlineOffset: 2
        }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: locked ? color.muted : color.ink, lineHeight: 1.35 }}>{label}</span>
        {sub ? <span style={{ display: 'block', fontSize: 11, lineHeight: 1.4, color: warn ? color.amber : color.faint }}>{sub}</span> : null}
      </span>
    </label>
  );
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }): JSX.Element {
  return (
    <div style={{ borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 8, paddingTop: 10 }}>
      <Row gap={8} wrap={false} style={{ padding: '0 6px 4px' }}>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: color.muted }}>{title}</span>
        {action}
      </Row>
      {children}
    </div>
  );
}

function NoteInput({ item, name, value, onChange }: { item: string; name: string; value: string; onChange: (value: string) => void }): JSX.Element {
  const focus = useFocus();
  return (
    <label style={{ display: 'block', padding: '5px 6px' }}>
      <span style={{ display: 'flex', gap: 6, fontSize: 11.5, color: color.inkSoft, marginBottom: 4 }}>
        <span style={{ fontFamily: font.mono, color: color.faint }}>{item}</span>
        <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Assumption the client should read"
        {...focus.bind}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: focus.on ? color.brand : color.rule,
          boxShadow: focus.on ? `0 0 0 3px ${color.focusRing}` : 'none',
          borderRadius: radius.sm,
          padding: '7px 9px',
          fontSize: 12.5,
          fontFamily: font.body,
          color: color.ink,
          background: color.surfaceSoft,
          outline: 'none'
        }}
      />
    </label>
  );
}

export function SheetPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { state, dispatch, estimate } = useApp();
  const input = useSheetInput();
  const [more, setMore] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [flash, setFlash] = useState(false);

  const prefs = state.sheet;
  const blocked = sheetBlockers(prefs, {
    blendBuffer: input?.blendBuffer ?? false,
    planned: input?.plan.tasks.length ?? 0,
    assigned: estimate.assignedH
  });
  const breakdown = input ? sheetBreakdown(input) : null;
  const lines = breakdown?.deliverables.flatMap((deliverable) => deliverable.lines) ?? [];
  const written = state.draft.sheet?.notes ?? {};
  const writtenCount = lines.filter((line) => written[line.key]?.trim()).length;
  const currency = state.draft.cur ?? 'USD';

  /* The estimate column prices every line, so say at what, and warn when nobody has set a rate:
     the default is a placeholder, and a client file is the worst place to discover that. */
  const pricing =
    estimate.assignedH > 0
      ? { text: `By role, ${money(estimate.effRate, currency)}/h blended`, warn: false }
      : state.draft.rate === null || state.draft.rate === undefined
        ? { text: `Default rate of ${rateLabel(DEFAULT_RATE, currency)}. Set yours: Display, then USD estimate`, warn: true }
        : { text: `At ${rateLabel(estimate.rate, currency)}`, warn: false };

  const column = (id: SheetColumnId): JSX.Element => {
    const entry = SHEET_COLUMNS.find((candidate) => candidate.id === id)!;
    const reason = blocked[id];
    const on = prefs.columns[id];
    const sub = id === 'component' ? entry.sub : on && reason ? reason : id === 'estimate' && on ? pricing.text : entry.sub;
    return (
      <Check
        key={id}
        label={entry.label}
        sub={sub}
        checked={on}
        locked={id === 'component'}
        warn={Boolean(on && reason) || (id === 'estimate' && on && pricing.warn)}
        onChange={(checked) => dispatch({ type: 'setSheet', columns: { [id]: checked } })}
      />
    );
  };

  const section = (id: SheetSectionId): JSX.Element => {
    const entry = SHEET_SECTIONS.find((candidate) => candidate.id === id)!;
    const reason = blocked[id];
    const on = prefs.sections[id];
    return (
      <Check
        key={id}
        label={entry.label}
        sub={on && reason ? reason : entry.sub}
        checked={on}
        warn={Boolean(on && reason)}
        onChange={(checked) => dispatch({ type: 'setSheet', sections: { [id]: checked } })}
      />
    );
  };

  const core = SHEET_COLUMNS.filter((entry) => entry.core);
  const extra = SHEET_COLUMNS.filter((entry) => !entry.core);
  const extraOn = extra.filter((entry) => prefs.columns[entry.id]).length;

  return (
    <Popover width={400} padding={14}>
      <Row gap={8} wrap={false} style={{ padding: '0 6px' }}>
        <span style={{ flex: 1, fontFamily: font.display, fontSize: 14, fontWeight: 600 }}>Excel sheet</span>
        <Button
          tone="primary"
          size="sm"
          disabled={!input || lines.length === 0}
          title={lines.length === 0 ? 'Select solutions first' : 'Download the branded task breakdown'}
          onClick={() => {
            if (!input) return;
            downloadTaskBreakdown(input);
            setFlash(true);
            window.setTimeout(() => setFlash(false), 2200);
          }}
        >
          {flash ? 'Downloaded' : 'Download .xlsx'}
        </Button>
        <Button tone="ghost" onClick={onClose} title="Close" style={{ background: color.surfaceMuted, width: 24, height: 24, padding: 0, fontSize: 13 }}>
          ×
        </Button>
      </Row>
      <div style={{ fontSize: 11.5, color: color.faint, lineHeight: 1.5, padding: '4px 6px 2px' }}>
        Choose what the downloaded workbook contains. What is on screen does not change.
      </div>

      <Group title="Columns from Edly’s template">{core.map((entry) => column(entry.id))}</Group>

      <Group
        title={`More columns${extraOn > 0 ? `, ${extraOn} on` : ''}`}
        action={
          <Button tone="ghost" size="sm" onClick={() => setMore((value) => !value)} style={{ padding: '3px 8px' }}>
            {more ? 'Hide' : 'Show'}
          </Button>
        }
      >
        {more ? extra.map((entry) => column(entry.id)) : null}
      </Group>

      <Group title="Sheets and sections">{SHEET_SECTIONS.map((entry) => section(entry.id))}</Group>

      <Group title="On the introduction sheet">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 6px' }}>
          <Field
            label="Contact point"
            value={state.draft.sheet?.contact ?? ''}
            placeholder="Who the client should talk to"
            onChange={(contact) => dispatch({ type: 'setSheetDetails', patch: { contact } })}
          />
          <TextArea
            label="General comments"
            value={state.draft.sheet?.comments ?? ''}
            placeholder={input && breakdown ? `Left blank, the sheet says: ${defaultComments(input, breakdown)}` : ''}
            onChange={(comments) => dispatch({ type: 'setSheetDetails', patch: { comments } })}
          />
        </div>
      </Group>

      <Group
        title={`Notes per line${writtenCount > 0 ? `, ${writtenCount} written` : ''}`}
        action={
          lines.length > 0 ? (
            <Button tone="ghost" size="sm" onClick={() => setNotesOpen((value) => !value)} style={{ padding: '3px 8px' }}>
              {notesOpen ? 'Hide' : 'Show'}
            </Button>
          ) : null
        }
      >
        {lines.length === 0 ? (
          <div style={{ fontSize: 11.5, color: color.faint, padding: '2px 6px' }}>Select solutions to write notes for them.</div>
        ) : notesOpen ? (
          <>
            <div style={{ fontSize: 11, color: color.faint, lineHeight: 1.45, padding: '0 6px 4px' }}>
              Shown first in Notes/Assumptions, above the caveats the sheet adds itself.
            </div>
            {lines.map((line) => (
              <NoteInput
                key={line.key}
                item={line.item}
                name={line.component}
                value={written[line.key] ?? ''}
                onChange={(note) => dispatch({ type: 'setLineNote', id: line.key, note })}
              />
            ))}
          </>
        ) : null}
      </Group>

      <div style={{ borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 10, padding: '10px 6px 0' }}>
        <Button tone="ghost" size="sm" onClick={() => dispatch({ type: 'resetSheet' })} style={{ padding: '4px 8px' }}>
          Reset to Edly’s template
        </Button>
      </div>
    </Popover>
  );
}
