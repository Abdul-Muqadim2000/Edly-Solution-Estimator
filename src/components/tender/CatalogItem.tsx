import { useMemo, useState, type ReactNode } from 'react';
import type { Bundle, Catalog, Solution, Tender, TenderRequirement } from '@/types';
import { useApp } from '@/state/AppProvider';
import { referenceUrl, solutionFacts, solutionHome, solutionKind } from '@/domain/catalog';
import { requirementsUsing, shortTitle } from '@/domain/tender';
import { hours, plural } from '@/lib/format';
import { pressable } from '@/lib/pressable';
import { useHover } from '@/lib/useHover';
import { color, font, radius } from '@/theme';
import { Button, Link, Modal, Mono, Row, SearchInput, Spacer } from '@/components/ui';
import { TextButton, useDialogKeys } from '@/components/tender/parts';
import { CatalogInternal } from '@/components/CatalogInternal';

/**
 * A catalog solution, opened from the tender's match step without leaving it. Everything the builder's
 * catalog shows for it, read from the catalog by id like the hours beside it, and what it covers in
 * this tender. The browser below it is the same detail for choosing a solution by hand.
 */

const badge = (text: string, bg: string, co: string, title?: string): JSX.Element => (
  <span key={text} title={title} style={{ fontSize: 10.5, fontWeight: 700, color: co, background: bg, borderRadius: radius.pill, padding: '3px 10px', whiteSpace: 'nowrap' }}>
    {text}
  </span>
);

/** The badges the builder's catalog row shows, in the same words. */
function badges(item: Solution, bundle: Bundle | null): JSX.Element[] {
  const out: JSX.Element[] = [];
  if (bundle) out.push(badge(`${bundle.id} · ${bundle.name}`, color.brandWash, color.brandDeep));
  if (item.status === 'In Development') out.push(badge('In development', color.amberWash, color.amberInk));
  if (solutionKind(item) === 'estimates') {
    out.push(badge('Estimate, not built', color.violetWash, color.violet, 'Priced by the estimation desk and never built, so its hours are a forecast rather than a delivery record'));
  } else if (item.status === 'Production') {
    out.push(badge('Built before', color.brandWashDeep, color.brandInk, 'Delivered for a client before, so its hours are a delivery record'));
  }
  if (item.first === null && item.status !== 'In Development') out.push(badge('No estimate', color.surfaceMuted, color.muted));
  return out;
}

function Figure({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: font.mono, fontSize: 18, fontWeight: 600, color: color.ink }}>{value}</div>
      <div style={{ fontSize: 11.5, color: color.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Pair({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 12.5, lineHeight: 1.55, minWidth: 0 }}>
      <span style={{ flex: '0 0 140px', color: color.ghostCool }}>{label}</span>
      <span style={{ color: color.inkSoft, minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{children}</span>
    </div>
  );
}

/** Facts the figures above the description already show, so the list below does not say them twice. */
const IN_FIGURES = new Set(['Std deployment', 'Original build', 'Repeat redeploy']);

/** A solution's whole entry. Reuse and build hours, and internal references, follow the Display settings, as in the builder. */
export function SolutionDetail({ item, bundle }: { item: Solution; bundle: Bundle | null }): JSX.Element {
  /* the display in effect, so nothing internal shows if a deal is being presented */
  const { display: prefs } = useApp();
  const link = referenceUrl(item, prefs);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <Row gap={6}>{badges(item, bundle)}</Row>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, padding: '12px 14px', background: color.surfaceSoft, borderRadius: radius.md }}>
        <Figure value={item.first === null ? 'Not priced' : `${hours(item.first)} h`} label="first delivery for a client" />
        {prefs.savings && item.repeat !== null ? <Figure value={`${hours(item.repeat)} h`} label="for the next client" /> : null}
        {prefs.savings && item.build !== null ? <Figure value={`${hours(item.build)} h`} label="original build" /> : null}
        <Figure value={!item.deploy || item.deploy === 'Not recorded' ? 'Not recorded' : item.deploy} label="standard deployment" />
      </div>
      {item.desc ? <div style={{ fontSize: 13.5, lineHeight: 1.65, color: color.body, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{item.desc}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '7px 28px' }}>
        {solutionFacts(item, prefs)
          .filter(([label]) => !IN_FIGURES.has(label))
          .map(([label, value]) => (
          <Pair key={label} label={label}>
            {value}
          </Pair>
        ))}
      </div>
      {/* written for the client, so it shows whatever the settings; the client's sheet prints it */}
      {item.notes ? <Pair label="Notes / Assumptions">{item.notes}</Pair> : null}
      {link ? (
        <Pair label="Reference">
          <Link href={link} style={{ wordBreak: 'break-all', color: color.brandDeep }} hover={{ color: color.red, textDecoration: 'underline' }}>
            {link}
          </Link>
        </Pair>
      ) : null}
      <CatalogInternal item={item} />
    </div>
  );
}

const reqName = (req: Pick<TenderRequirement, 'title' | 'text'>): string => req.title?.trim() || shortTitle(req.text, 80);

function SolutionTitle({ item, eyebrow }: { item: Solution; eyebrow: string }): JSX.Element {
  return (
    <div>
      <Row gap={8}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: color.brandDeep }}>{eyebrow}</span>
        <Mono size={11} tone={color.ghostCool}>
          {item.id}
        </Mono>
      </Row>
      <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, marginTop: 4, lineHeight: 1.3 }}>{item.name}</div>
    </div>
  );
}

/**
 * One solution, opened from a requirement's match. `req` is that requirement: the popup says why the
 * AI matched it and can take the solution off it. A solution the catalog no longer has says so,
 * rather than showing an empty entry.
 */
export function CatalogItemModal({
  catalog,
  solutionId,
  tender,
  req,
  onRemove,
  onClose
}: {
  catalog: Catalog;
  solutionId: string;
  tender: Pick<Tender, 'reqs'>;
  req: TenderRequirement | null;
  onRemove?: () => void;
  onClose: () => void;
}): JSX.Element {
  const box = useDialogKeys(onClose);
  const home = solutionHome(catalog, solutionId);
  const using = requirementsUsing(tender, solutionId);
  const title = home ? <SolutionTitle item={home.item} eyebrow="Catalog solution" /> : <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700 }}>{solutionId}</div>;

  return (
    <Modal title={title} onClose={onClose} width={860} padding="24px 28px">
      <div ref={box} tabIndex={-1} role="dialog" aria-label={home ? home.item.name : solutionId} style={{ outline: 'none', display: 'flex', flexDirection: 'column', gap: 18, marginTop: 14 }}>
        {home ? (
          <SolutionDetail item={home.item} bundle={home.bundle} />
        ) : (
          <div style={{ fontSize: 13, color: color.redInk }}>This platform&apos;s catalog has no solution {solutionId} any more. Take it off the match, or pick another.</div>
        )}

        <div style={{ borderTop: `1px solid ${color.hairline}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: color.muted }}>In this tender</div>
          {req?.match?.reason ? (
            <div style={{ fontSize: 13, lineHeight: 1.55, color: color.body }}>
              <span style={{ fontWeight: 600, color: color.ink }}>Why the AI matched it to {req.id}: </span>
              {req.match.reason}
            </div>
          ) : null}
          {using.length > 0 ? (
            <>
              <div style={{ fontSize: 12.5, color: color.muted }}>
                Named on {plural(using.length, 'approved requirement')}. Its hours count once in the estimation, however many name it.
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {using.map((one) => (
                  <li key={one.id} style={{ fontSize: 12.5, lineHeight: 1.5, color: color.body }}>
                    <Mono size={11} tone={color.brandDeep}>
                      {one.id}
                    </Mono>{' '}
                    {reqName(one)}
                    {one.match?.approved ? '' : <span style={{ color: color.amberInk }}> (not accepted yet)</span>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: color.muted }}>No approved requirement names it yet.</div>
          )}
        </div>

        <Row gap={10} style={{ justifyContent: 'flex-end' }}>
          {onRemove && req ? (
            <Button
              tone="danger"
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              Take it off {req.id}
            </Button>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </Row>
      </div>
    </Modal>
  );
}

/** A row of the browser: name, bundle and first-delivery hours, opening to the whole entry. */
function PickerRow({
  item,
  bundle,
  open,
  picked,
  onToggle,
  onAdd,
  reqId
}: {
  item: Solution;
  bundle: Bundle;
  open: boolean;
  picked: boolean;
  onToggle: () => void;
  onAdd: () => void;
  reqId: string;
}): JSX.Element {
  const hover = useHover();
  return (
    <div style={{ borderTop: `1px solid ${color.hairlineSoft}`, background: open ? color.surfaceSoft : hover.on ? color.surfaceSoft : color.surface }}>
      <div
        {...pressable(onToggle)}
        {...hover.bind}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 12px', cursor: 'pointer', boxShadow: solutionKind(item) === 'estimates' ? `inset 3px 0 0 ${color.violet}` : undefined }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <Row gap={8}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: color.ink }}>{item.name}</span>
            <Mono size={10} tone={color.ghostCool}>
              {item.id}
            </Mono>
            <span style={{ fontSize: 11, color: color.faint }}>{bundle.name}</span>
          </Row>
          {!open && item.desc ? (
            <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</div>
          ) : null}
        </div>
        <Mono size={12.5} tone={color.ink} style={{ fontWeight: 600 }}>
          {item.first === null ? '—' : `${hours(item.first)} h`}
        </Mono>
      </div>
      {open ? (
        <div style={{ padding: '4px 12px 14px' }}>
          <SolutionDetail item={item} bundle={bundle} />
          <Row gap={10} style={{ marginTop: 12 }}>
            {picked ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: color.brandInk }}>Already on {reqId}</span>
            ) : (
              <Button size="sm" tone="brand" onClick={onAdd}>
                Add to {reqId}
              </Button>
            )}
            <Spacer />
            <TextButton onClick={onToggle}>Close this</TextButton>
          </Row>
        </div>
      ) : null}
    </div>
  );
}

/** At most this many rows are drawn at once; a search narrows the rest. */
const SHOWN = 60;

/**
 * The catalog, searchable, for choosing a solution by hand: each row opens to its whole entry, so a
 * person reads what it does before adding it to the requirement.
 */
export function CatalogPicker({
  catalog,
  req,
  onAdd,
  onClose
}: {
  catalog: Catalog;
  req: TenderRequirement;
  onAdd: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const box = useDialogKeys(onClose);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState('');
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return catalog.bundles.flatMap((bundle) =>
      bundle.items.flatMap((item) => {
        if (seen.has(item.id)) return [];
        seen.add(item.id);
        return [{ item, bundle, haystack: [item.id, item.name, item.desc, item.category, item.subCategory, item.integrations, bundle.id, bundle.name].join(' ').toLowerCase() }];
      })
    );
  }, [catalog]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length === 0 ? rows : rows.filter((row) => words.every((word) => row.haystack.includes(word)));
  const picked = new Set(req.match?.solutionIds ?? []);

  const title = (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: color.brandDeep }}>Find in the catalog</div>
      <div style={{ fontFamily: font.display, fontSize: 19, fontWeight: 700, marginTop: 4, lineHeight: 1.35 }}>
        {req.id}: {reqName(req)}
      </div>
    </div>
  );

  return (
    <Modal title={title} onClose={onClose} width={900} padding="24px 28px">
      <div ref={box} tabIndex={-1} role="dialog" aria-label={`Find a catalog solution for ${req.id}`} style={{ outline: 'none', marginTop: 14 }}>
        <div style={{ fontSize: 13, color: color.body, lineHeight: 1.55, marginBottom: 12 }}>{req.text}</div>
        <SearchInput value={query} onChange={setQuery} placeholder="Search by name, id, bundle or what it does" style={{ width: '100%' }} />
        <div style={{ fontSize: 11.5, color: color.muted, margin: '10px 0 6px' }}>
          {found.length > SHOWN ? `First ${SHOWN} of ${plural(found.length, 'solution')}. Search to narrow them.` : plural(found.length, 'solution')}
        </div>
        <div style={{ border: `1px solid ${color.hairline}`, borderRadius: radius.md, overflow: 'hidden' }}>
          {found.slice(0, SHOWN).map(({ item, bundle }) => (
            <PickerRow
              key={item.id}
              item={item}
              bundle={bundle}
              open={open === item.id}
              picked={picked.has(item.id)}
              reqId={req.id}
              onToggle={() => setOpen((current) => (current === item.id ? '' : item.id))}
              onAdd={() => onAdd(item.id)}
            />
          ))}
          {found.length === 0 ? <div style={{ padding: '18px 14px', fontSize: 12.5, color: color.muted }}>Nothing in the catalog matches that.</div> : null}
        </div>
        <Row gap={10} style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <Button onClick={onClose}>Done</Button>
        </Row>
      </div>
    </Modal>
  );
}
