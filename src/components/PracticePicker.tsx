import { PRACTICES, findPlatform } from '@/data/practices';
import { useApp } from '@/state/AppProvider';
import { color, font, radius, shadow } from '@/theme';
import { Mono, useRowHover } from '@/components/ui';
import { useHover } from '@/lib/useHover';
import { plural } from '@/lib/format';
import { AppHeader } from '@/components/AppHeader';

/**
 * Practice → platform, in two steps. Shown after every sign-in, with the last platform offered
 * as a shortcut: people usually return to the same one, but shouldn't be forced there.
 */

const platformMeta = (platform: { live?: boolean; catalog?: { meta: { totals: { features: number } } } }): string => {
  if (platform.live) return 'Live catalog';
  if (platform.catalog) return `${platform.catalog.meta.totals.features} benchmark solutions`;
  return 'Empty — build it up';
};

function PracticeCard({ practice, onPick }: { practice: (typeof PRACTICES)[number]; onPick: () => void }): JSX.Element {
  const hover = useRowHover({ borderColor: color.brand, boxShadow: '0 14px 34px rgba(20, 20, 20, 0.09)' });
  return (
    <div
      onClick={onPick}
      {...hover.bind}
      style={{
        background: color.surface,
        border: `1px solid ${color.hairline}`,
        borderRadius: radius.xl,
        padding: '22px 24px',
        cursor: 'pointer',
        transition: 'border-color 140ms ease, box-shadow 140ms ease',
        ...hover.style
      }}
    >
      <div style={{ fontSize: 26, color: color.brand, lineHeight: 1 }}>{practice.icon}</div>
      <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 600, marginTop: 12 }}>{practice.name}</div>
      <div style={{ fontSize: 13, color: color.muted, lineHeight: 1.55, marginTop: 5 }}>{practice.blurb}</div>
      <Mono block size={10.5} tone={color.ghost} style={{ marginTop: 12 }}>
        {plural(practice.platforms.length, 'platform')}
        {practice.platforms.some((platform) => platform.live) ? ' · 1 live catalog' : ''}
      </Mono>
    </div>
  );
}

function PlatformRow({
  platform,
  onPick
}: {
  platform: (typeof PRACTICES)[number]['platforms'][number];
  onPick: () => void;
}): JSX.Element {
  const hover = useRowHover({ borderColor: color.brand, boxShadow: '0 12px 30px rgba(20, 20, 20, 0.08)' });
  return (
    <div
      onClick={onPick}
      {...hover.bind}
      style={{
        background: color.surface,
        border: `1px solid ${platform.live ? color.brandEdge : color.hairline}`,
        borderRadius: radius.lg,
        padding: '18px 22px',
        cursor: 'pointer',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 14px',
        transition: 'border-color 140ms ease, box-shadow 140ms ease',
        ...hover.style
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontFamily: font.display, fontSize: 17, fontWeight: 600 }}>{platform.name}</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              borderRadius: radius.pill,
              padding: '3px 9px',
              background: platform.live ? color.brandWash : color.amberWash,
              color: platform.live ? color.brandDeep : color.amber
            }}
          >
            {platform.live ? 'Live' : 'Sample'}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55, marginTop: 4 }}>
          {platform.live
            ? platform.note ?? ''
            : 'Benchmark scopes and hours — replace by loading your sheet or adding solutions at the desk.'}
        </div>
      </div>
      <Mono tone={color.ghost}>{platformMeta(platform)}</Mono>
      <span style={{ fontSize: 13, fontWeight: 700, color: color.brandDeep }}>Open ›</span>
    </div>
  );
}

function ResumeShortcut({ label, meta, onPick }: { label: string; meta: string; onPick: () => void }): JSX.Element {
  const hover = useRowHover({ borderColor: color.brand, boxShadow: shadow.brand });
  return (
    <div
      onClick={onPick}
      {...hover.bind}
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        marginTop: 20,
        background: color.surface,
        border: `1px solid ${color.brandEdge}`,
        borderRadius: radius.lg,
        padding: '13px 18px',
        cursor: 'pointer',
        transition: 'border-color 140ms ease, box-shadow 140ms ease',
        ...hover.style
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: color.ghost }}>Last time</span>
      <span style={{ fontFamily: font.display, fontSize: 14.5, fontWeight: 600 }}>{label}</span>
      <Mono size={10.5} tone={color.ghost}>
        {meta}
      </Mono>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: color.brandDeep }}>Continue ›</span>
    </div>
  );
}

/** The quiet text link back up a level. */
function BackLink({ children, onClick }: { children: string; onClick: () => void }): JSX.Element {
  const h = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...h.bind}
      style={{
        border: 'none',
        cursor: 'pointer',
        background: 'transparent',
        color: h.on ? color.brandDeep : color.muted,
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: font.body,
        padding: 0,
        transition: 'color 120ms ease'
      }}
    >
      {children}
    </button>
  );
}

export function PracticePicker(): JSX.Element {
  const { state, dispatch } = useApp();
  const chosen = PRACTICES.find((practice) => practice.id === state.practice) ?? null;
  const last = findPlatform(state.lastPlatform);

  if (chosen) {
    return (
      <div style={{ minHeight: '100vh', background: color.page }}>
        <AppHeader />
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '52px 24px 80px' }}>
          <BackLink onClick={() => dispatch({ type: 'choosePractice', practice: '' })}>← All practices</BackLink>
          <h1 style={{ fontFamily: font.display, fontSize: 30, fontWeight: 700, letterSpacing: -0.5, margin: '14px 0 0' }}>{chosen.name}</h1>
          <p style={{ fontSize: 14, color: color.muted, lineHeight: 1.6, margin: '6px 0 0', maxWidth: 560 }}>{chosen.blurb}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 26 }}>
            {chosen.platforms.map((platform) => (
              <PlatformRow
                key={platform.id}
                platform={platform}
                onPick={() => dispatch({ type: 'choosePlatform', practice: chosen.id, platform: platform.id })}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: color.page }}>
      <AppHeader />
      <div style={{ maxWidth: 940, margin: '0 auto', padding: '52px 24px 80px' }}>
        <div style={{ fontFamily: font.display, fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: color.brandDeep }}>
          edly · solution estimator
        </div>
        <h1 style={{ fontFamily: font.display, fontSize: 34, fontWeight: 700, letterSpacing: -0.6, margin: '10px 0 0' }}>
          Where are you estimating today?
        </h1>
        <p style={{ fontSize: 14.5, color: color.muted, lineHeight: 1.6, margin: '8px 0 0', maxWidth: 580 }}>
          Pick the practice, then the platform. Each platform keeps its own catalog, estimations and request queue.
        </p>

        {last ? (
          <ResumeShortcut
            label={`${last.practice.name} / ${last.platform.name}`}
            meta={platformMeta(last.platform)}
            onPick={() => dispatch({ type: 'choosePlatform', practice: last.practice.id, platform: last.platform.id })}
          />
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginTop: 28 }}>
          {PRACTICES.map((practice) => (
            <PracticeCard key={practice.id} practice={practice} onPick={() => dispatch({ type: 'choosePractice', practice: practice.id })} />
          ))}
        </div>
      </div>
    </div>
  );
}
