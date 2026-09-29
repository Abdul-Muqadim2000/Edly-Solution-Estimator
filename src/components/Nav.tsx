import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useApp } from '@/state/AppProvider';
import { exactly, LANDING, type Crumb, type Route } from '@/lib/router';
import { useHover } from '@/lib/useHover';
import { color } from '@/theme';
import { QuotientLogo } from '@/components/Brand';

/**
 * A link to another screen of the app.
 *
 * A real anchor with the screen's address, so a middle or modified click opens it in a new tab
 * and a screen reader announces a link. A plain click moves in place through the router, like
 * every other move, and starts the new page at the top rather than wherever the last one was.
 */
export function AppLink({
  to,
  children,
  style,
  hover,
  title
}: {
  to: Route;
  children: ReactNode;
  style?: CSSProperties;
  hover?: CSSProperties;
  title?: string;
}): JSX.Element {
  const { router } = useApp();
  const h = useHover();
  const patch = exactly(to);
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.navigate(patch);
    window.scrollTo({ top: 0 });
  };
  return (
    <a
      href={router.href(patch)}
      onClick={onClick}
      title={title}
      {...h.bind}
      style={{
        color: 'inherit',
        textDecoration: 'none',
        textUnderlineOffset: 3,
        cursor: 'pointer',
        transition: 'color 120ms ease, opacity 120ms ease',
        ...style,
        ...(h.on ? { textDecoration: 'underline', ...hover } : null)
      }}
    >
      {children}
    </a>
  );
}

/**
 * The trail above a page's title, each step a link to its own page and the last one the page
 * itself. The separators are fainter than the links, because a practice's own name has a slash
 * in it ("EdTech / LMS") and the two must not read as the same thing.
 */
export function Breadcrumbs({ trail, style }: { trail: Crumb[]; style?: CSSProperties }): JSX.Element | null {
  if (trail.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: color.brandDeep, ...style }}
    >
      {trail.map((crumb, index) => (
        <span key={`${index}-${crumb.label}`}>
          {index > 0 ? (
            <span aria-hidden="true" style={{ color: color.ghost, margin: '0 7px' }}>
              /
            </span>
          ) : null}
          {crumb.route ? (
            <AppLink to={crumb.route} hover={{ color: color.ink }}>
              {crumb.label}
            </AppLink>
          ) : (
            <span aria-current="page" style={{ color: color.muted }}>
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Quotient's logo as the way home: the landing page, with every practice. */
export function HomeLogo({ height = 24 }: { height?: number }): JSX.Element {
  return (
    <AppLink to={LANDING} title="All practices" style={{ display: 'block', borderRadius: 4 }} hover={{ opacity: 0.75, textDecoration: 'none' }}>
      <QuotientLogo height={height} />
    </AppLink>
  );
}

/** The quiet text link back up a level, as on the practice's list of platforms. */
export function BackTo({ to, children }: { to: Route; children: ReactNode }): JSX.Element {
  return (
    <AppLink to={to} style={{ fontSize: 12.5, fontWeight: 600, color: color.muted }} hover={{ color: color.brandDeep }}>
      {children}
    </AppLink>
  );
}
