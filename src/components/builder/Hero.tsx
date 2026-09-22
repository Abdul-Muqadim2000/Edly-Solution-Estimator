import { useApp } from '@/state/AppProvider';
import { allSolutions } from '@/domain/catalog';
import { isLiveCatalog, findPlatform } from '@/data/practices';
import { EDLY_LINKS, TEAMS_BEHIND, TRADEMARK } from '@/data/nav';
import { color, font } from '@/theme';
import { Button, Link } from '@/components/ui';
import { hours } from '@/lib/format';
import { useLayout } from '@/lib/useViewport';

/**
 * The builder hero.
 *
 * Open edX keeps its real, approved claims — 2013, 5,000+ upstream contributions, 40M+ learners.
 * No other platform may borrow them: the benchmark platforms get copy that says the hours are
 * indicative and must be confirmed.
 */
export function Hero({ onBuild }: { onBuild: () => void }): JSX.Element {
  const { state, catalog } = useApp();
  const { heroCols } = useLayout();

  const live = isLiveCatalog(state.platform);
  const platformName = findPlatform(state.platform)?.platform.name ?? 'Platform';
  const ownSheet = Boolean(state.loadedCatalogs[state.platform]);
  const total = allSolutions(catalog).length;
  const engineered = catalog.meta.totals.buildHrs;

  const kicker = live ? 'Open edX Solution Bundles · by Arbisoft' : `${platformName} Solution Bundles · by Arbisoft`;
  const title = live
    ? 'Client-proven Open edX solutions, ready to redeploy in hours.'
    : `Scoped ${platformName} solutions, priced before you promise.`;
  const blurb = live
    ? 'Edly has been a core contributor to Open edX since 2013 — 5,000+ upstream contributions and platforms trusted by 40M+ learners. Every solution below was engineered for a real client. Pick what you need and see the effort instantly.'
    : ownSheet
      ? `Loaded from your ${platformName} sheet. Pick what the client needs and see the effort instantly.`
      : `A benchmark catalog for ${platformName} — typical scopes and hours for this kind of work, here so you can shape a number in the meeting. Confirm anything you quote with the delivery team, or load your own sheet to replace it.`;

  const stats: { value: string; label: string }[] = [
    { value: String(total), label: live ? 'client-proven solutions' : ownSheet ? 'solutions in your sheet' : 'benchmark solutions' },
    { value: String(catalog.bundles.length), label: 'sellable bundles' },
    { value: `${hours(engineered ?? 0)} h`, label: 'engineering already built — you reuse it' },
    { value: '2013', label: 'core Open edX contributor since' }
  ];

  const card = {
    background: color.surface,
    border: `1px solid ${color.brandEdgeSoft}`,
    borderRadius: 12,
    padding: '16px 18px'
  } as const;

  return (
    <section
      data-screen-label="Hero"
      style={{ background: color.brandWash, color: color.ink, padding: '52px 32px 56px', borderBottom: `1px solid ${color.brandEdgeSoft}` }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: heroCols,
            gap: 40,
            alignItems: 'end'
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2.2, textTransform: 'uppercase', color: color.brandDeep }}>
              {kicker}
            </div>
            <h1
              style={{
                fontFamily: font.display,
                fontSize: 39,
                fontWeight: 700,
                lineHeight: 1.16,
                letterSpacing: -0.8,
                margin: '12px 0 14px',
                textWrap: 'balance'
              }}
            >
              {title}
            </h1>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: color.bodySoft, margin: 0, maxWidth: 640, textWrap: 'pretty' }}>{blurb}</p>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 26 }}>
              <Button
                tone="primary"
                onClick={onBuild}
                style={{ borderRadius: 9, padding: '13px 24px', letterSpacing: 0.8, textTransform: 'uppercase' }}
              >
                Build your bundle ↓
              </Button>
              <Link
                href={EDLY_LINKS.customSolutions}
                hover={{ background: color.surface, color: color.redInk }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  border: `1.5px solid ${color.red}`,
                  color: color.red,
                  borderRadius: 9,
                  padding: '11px 20px',
                  fontSize: 12.5,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase'
                }}
              >
                Custom development
              </Link>
            </div>

            <div
              style={{
                display: 'inline-flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 6,
                maxWidth: '100%',
                marginTop: 18,
                background: color.surface,
                border: `1px solid ${color.brandEdge}`,
                borderRadius: 18,
                padding: '8px 16px',
                fontSize: 12.5,
                fontWeight: 600,
                color: color.brandInk
              }}
            >
              These bundles are only our pre-built work — don’t see what you need?{' '}
              <Link
                href={EDLY_LINKS.contact}
                hover={{ color: color.red, textDecoration: 'underline' }}
                style={{ color: color.red, fontWeight: 700 }}
              >
                We build fully custom {platformName} solutions — contact us
              </Link>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {stats.map((stat) => (
              <div key={stat.label} style={card}>
                <div style={{ fontFamily: font.display, fontSize: 27, fontWeight: 700, lineHeight: 1 }}>{stat.value}</div>
                <div style={{ fontSize: 11.5, color: color.muted, marginTop: 6, lineHeight: 1.4 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 16,
            marginTop: 32,
            paddingTop: 16,
            borderTop: `1px solid ${color.brandEdgeFaint}`,
            flexWrap: 'wrap'
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: color.dim }}>
            Built with teams behind
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: color.footerField }}>{TEAMS_BEHIND}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: color.dim }}>{TRADEMARK}</span>
        </div>
      </div>
    </section>
  );
}
