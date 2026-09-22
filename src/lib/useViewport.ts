import { useEffect, useState } from 'react';
import { color } from '@/theme';

/**
 * Viewport width, for the few places layout genuinely has to branch on it.
 *
 * Styling is inline in this codebase (see ARCHITECTURE.md), so grid templates that need to
 * collapse on narrow screens compute from this rather than from a media query.
 */
export function useViewport(): number {
  const [width, setWidth] = useState<number>(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));

  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return width;
}

export interface Layout {
  width: number;
  /** Single-column: the rails stack under the catalog. */
  narrow: boolean;
  /** Full three-column shell, but tightened. */
  mid: boolean;
  shellHeight: string;
  shellCols: string;
  paneOverflow: 'visible' | 'auto';
  mainPad: string;
  navDir: 'row' | 'column';
  navWrap: 'wrap' | 'nowrap';
  navBorderRight: string;
  navBorderBottom: string;
  navPad: string;
  navGap: string;
  navLabelFlex: string;
  navItemFlex: string;
  navMetaDisplay: string;
  tableCols: string;
  showDeployCol: boolean;
  heroCols: string;
  footCols: string;
}

/**
 * The two breakpoints the whole app shares — 1020 and 1320 — and every grid template
 * derived from them. Kept in one place so no screen invents its own breakpoint.
 */
export function useLayout(): Layout {
  const width = useViewport();
  const narrow = width < 1020;
  const mid = !narrow && width < 1320;

  return {
    width,
    narrow,
    mid,
    shellHeight: narrow ? 'auto' : 'calc(100vh - 62px)',
    shellCols: narrow ? 'minmax(0, 1fr)' : mid ? '238px minmax(0, 1fr) 344px' : '280px minmax(0, 1fr) 400px',
    paneOverflow: narrow ? 'visible' : 'auto',
    mainPad: narrow ? '28px 18px 56px' : mid ? '32px 28px 64px' : '40px 44px 72px',
    navDir: narrow ? 'row' : 'column',
    navWrap: narrow ? 'wrap' : 'nowrap',
    navBorderRight: narrow ? 'none' : `1px solid ${color.hairline}`,
    navBorderBottom: narrow ? `1px solid ${color.hairline}` : 'none',
    navPad: narrow ? '12px 14px' : '14px 10px 10px',
    navGap: narrow ? '6px' : '2px',
    navLabelFlex: narrow ? '0 0 100%' : 'none',
    navItemFlex: narrow ? '0 0 auto' : 'none',
    navMetaDisplay: narrow ? 'none' : 'block',
    tableCols: narrow ? '40px minmax(0, 1fr) 78px 32px' : '46px minmax(0, 1fr) 150px 96px 40px',
    showDeployCol: !narrow,
    heroCols: narrow ? 'minmax(0, 1fr)' : 'minmax(0, 1.45fr) minmax(0, 1fr)',
    footCols: narrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr)) 1.35fr'
  };
}
