import type { CSSProperties } from 'react';
import { BRAND_FILES, LOGO_ASPECT, PRODUCT_NAME } from '@/data/brand';
import { color } from '@/theme';

/** Quotient's lockup. Sized by height; the width is reserved so the header does not shift on load. */
export function QuotientLogo({ height, style }: { height: number; style?: CSSProperties }): JSX.Element {
  return (
    <img
      src={BRAND_FILES.logo}
      alt={PRODUCT_NAME}
      height={height}
      width={Math.round(height * LOGO_ASPECT)}
      style={{ display: 'block', flex: '0 0 auto', ...style }}
    />
  );
}

/**
 * The working screens' footer: the tool's name, who makes it, and nothing to click.
 *
 * Kept to one quiet line because these screens are for sales and the desk. While a deal is
 * presented, the builder swaps it for the edly.io footer, which is the one a client should see.
 * Centred, so the sync pill in the bottom-left corner never sits on top of it.
 */
export function AppFooter(): JSX.Element {
  return (
    <footer
      data-screen-label="App footer"
      style={{
        borderTop: `1px solid ${color.hairlineSoft}`,
        background: color.surface,
        padding: '14px 24px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px 14px',
        fontSize: 11.5,
        color: color.faint
      }}
    >
      <img src={BRAND_FILES.mark} alt="" width={16} height={16} style={{ display: 'block' }} />
      <span style={{ fontWeight: 600, color: color.muted }}>{PRODUCT_NAME}</span>
      <span>Solutions workspace by Arbisoft</span>
      <span>© Edly {new Date().getFullYear()}</span>
    </footer>
  );
}
