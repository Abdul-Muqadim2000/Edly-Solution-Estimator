import { useState, type ReactNode } from 'react';
import type { Solution } from '@/types';
import { useApp } from '@/state/AppProvider';
import { currentPlatform } from '@/state/reducer';
import { detailFor, internalForm, provenance, readInternalForm, reuseLine, typedAny, type InternalField, type InternalForm } from '@/domain/catalogDetails';
import { isDemoId } from '@/domain/demo';
import { color, radius } from '@/theme';
import { Button, Field, Link, Row, Select, Spacer, TextArea } from '@/components/ui';

/**
 * A catalog solution's internal details: who it was built for, who to ask, where the code is and
 * how ready it is to reuse. One block for the builder's catalog row, the tender's popup and the
 * desk's list, so they cannot disagree, and each can add or edit them in place.
 *
 * It follows the Display setting for internal notes, which is off whenever a deal is presented, so
 * a client watching the screen never sees it, nor the button that would add some. Nothing here goes
 * into the Excel sheet or the printed quote: neither takes the details at all.
 */

function Pair({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 12.5, lineHeight: 1.55, minWidth: 0 }}>
      <span style={{ flex: '0 0 132px', color: color.ghostCool }}>{label}</span>
      <span style={{ color: color.inkSoft, minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{children}</span>
    </div>
  );
}

const YES_NO: { value: string; label: string }[] = [
  { value: '', label: 'Not known' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
];

/* what each field is for, and which of them the tender AI reads; it never reads who or where */
const AI_READS = 'The tender AI reads this when matching, with client names and links taken out.';

/** The internal fields as a form, for the desk's Add to catalog and for editing any solution's. */
export function InternalFields({ value, onChange }: { value: InternalForm; onChange: (next: InternalForm) => void }): JSX.Element {
  const set = (key: InternalField) => (next: string) => onChange({ ...value, [key]: next });
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <Field label="Built for" hint="The client it was first built for. Kept from the tender AI." value={value.builtFor} onChange={set('builtFor')} placeholder="e.g. Acme Academy" />
        <Field label="Contact" hint="Who to ask before reusing it" value={value.contact} onChange={set('contact')} placeholder="Who knows the code" />
        <Field label="Team" value={value.team} onChange={set('team')} placeholder="e.g. Team Orange" />
        <Select label="Already a plugin" value={value.plugin} options={YES_NO} onChange={set('plugin')} />
        <Select label="Mixed with other features" hint="Yes when it has to be pulled out of a client's code before reuse" value={value.mixed} options={YES_NO} onChange={set('mixed')} />
        <Field label="Times reused" type="number" min={0} mono value={value.reuseCount} onChange={set('reuseCount')} placeholder="Not known" />
      </div>
      <Field label="Source code" hint="The repository, so the team can find the code to reuse. Kept from the tender AI." value={value.source} onChange={set('source')} placeholder="e.g. https://github.com/edly-io/..." />
      <Field label="Dependencies" hint={AI_READS} value={value.dependencies} onChange={set('dependencies')} placeholder="Services, plugins or accounts it needs" />
      <Field label="Tender keywords" hint={AI_READS} value={value.keywords} onChange={set('keywords')} placeholder="Other names a tender might use for it, comma separated" />
      <TextArea label="Implementation notes" hint={AI_READS} value={value.implementation} onChange={set('implementation')} placeholder="How it is built, and what reusing it involves" />
    </div>
  );
}

const box = { borderRadius: radius.md, background: color.blueWash, borderLeft: `3px solid ${color.blueEdge}`, padding: '10px 14px', display: 'grid', gap: 5, minWidth: 0 } as const;
const heading = { fontSize: 10.5, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: color.blueInk } as const;

/** The internal block for one solution, with a way to add or edit it; nothing at all while internal notes are hidden. */
export function CatalogInternal({ item }: { item: Pick<Solution, 'id' | 'ref' | 'name'> }): JSX.Element | null {
  const { state, display, dispatch } = useApp();
  /* null while not editing */
  const [form, setForm] = useState<InternalForm | null>(null);
  const [error, setError] = useState('');
  if (!display.notes) return null;
  const detail = detailFor(state.catalogDetails, currentPlatform(state), item.id);
  /* the demo is never stored, so details typed on its estimates would be a row about nothing */
  const editable = !isDemoId(item.id);
  /* the tracker matches the master sheet's solutions, never what the desk added */
  const fromSheet = !state.solutions.some((one) => one.id === item.id);

  const edit = (): void => {
    setForm(internalForm(detail));
    setError('');
  };

  if (form) {
    const save = (): void => {
      const read = readInternalForm(form);
      if ('error' in read) {
        setError(read.error);
        return;
      }
      dispatch({ type: 'editCatalogDetail', solutionId: item.id, name: item.name, patch: read.patch });
      setForm(null);
    };
    return (
      <div data-internal="1" style={{ ...box, gap: 10 }}>
        <div style={heading}>Internal, never shown to clients</div>
        <InternalFields value={form} onChange={setForm} />
        {fromSheet ? (
          <div style={{ fontSize: 11.5, color: color.muted, lineHeight: 1.5 }}>
            The next import of the features tracker replaces the fields it has a column for.
          </div>
        ) : null}
        <Row gap={8}>
          <Button size="sm" tone="primary" onClick={save}>
            Save details
          </Button>
          <Button size="sm" tone="ghost" onClick={() => setForm(null)}>
            Cancel
          </Button>
          {error ? <span style={{ fontSize: 12, fontWeight: 600, color: color.redInk }}>{error}</span> : null}
        </Row>
      </div>
    );
  }

  if (!detail || !typedAny(detail)) {
    if (!editable) return null;
    return (
      <Row gap={8}>
        <Button size="sm" tone="ghost" title="Who it was built for, the code, who to ask. Never shown to a client." onClick={edit}>
          Add internal details
        </Button>
      </Row>
    );
  }

  return (
    <div data-internal="1" style={box}>
      <Row gap={8} wrap={false}>
        <div style={heading}>Internal, never shown to clients</div>
        <Spacer />
        {editable ? (
          <Button size="sm" tone="ghost" title="Edit the internal details" onClick={edit} style={{ padding: '3px 10px', fontSize: 11 }}>
            Edit
          </Button>
        ) : null}
      </Row>
      {detailRows(detail, item).map(([label, value]) => (
        <Pair key={label} label={label}>
          {value}
        </Pair>
      ))}
      <div style={{ fontSize: 11, color: color.muted, marginTop: 2 }}>{provenance(detail)}</div>
    </div>
  );
}

function detailRows(detail: NonNullable<ReturnType<typeof detailFor>>, item: Pick<Solution, 'ref'>): [string, ReactNode][] {
  const reuse = reuseLine(detail);
  /* the catalog's Reference row already shows the same link */
  const source = detail.source && detail.source !== item.ref ? detail.source : '';
  const rows: ([string, ReactNode] | null)[] = [
    detail.builtFor ? ['Built for', detail.builtFor] : null,
    detail.contact ? ['Contact', detail.contact] : null,
    detail.team ? ['Team', detail.team] : null,
    source
      ? [
          'Source code',
          /^https?:\/\//.test(source) ? (
            <Link href={source} style={{ wordBreak: 'break-all', color: color.brandDeep }} hover={{ color: color.red, textDecoration: 'underline' }}>
              {source}
            </Link>
          ) : (
            source
          )
        ]
      : null,
    reuse ? ['Reuse', reuse] : null,
    detail.dependencies ? ['Dependencies', detail.dependencies] : null,
    detail.implementation ? ['Implementation', detail.implementation] : null,
    detail.keywords ? ['Tender keywords', detail.keywords] : null
  ];
  return rows.filter((row): row is [string, ReactNode] => row !== null);
}
