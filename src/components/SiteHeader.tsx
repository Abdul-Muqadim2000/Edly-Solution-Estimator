import { useState } from 'react';
import { EDLY_LINKS, NAV_MENUS } from '@/data/nav';
import { color, font, radius } from '@/theme';
import { Link } from '@/components/ui';

/**
 * The edly.io marketing header, sitting above the tool.
 *
 * It is part of the product: sales screen-share this, and the client should see the same chrome
 * as the public site. Links open on edly.io in a new tab.
 */
export function SiteHeader(): JSX.Element {
  const [open, setOpen] = useState('');

  return (
    <div style={{ background: color.surface, borderBottom: `1px solid ${color.hairlineSoft}`, padding: '0 32px' }}>
      <div
        style={{
          maxWidth: 1240,
          margin: '0 auto',
          minHeight: 74,
          padding: '10px 0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px 22px'
        }}
      >
        <Link
          href={EDLY_LINKS.home}
          hover={{ color: color.ink }}
          style={{ fontFamily: font.display, fontWeight: 700, fontSize: 30, letterSpacing: -0.5, color: color.ink, lineHeight: 1 }}
        >
          edly
        </Link>

        <nav style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 2 }} onMouseLeave={() => setOpen('')}>
          {NAV_MENUS.map((menu) => (
            <div key={menu.label} style={{ position: 'relative' }} onMouseEnter={() => setOpen(menu.children ? menu.label : '')}>
              <Link
                href={menu.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '10px 13px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: color.ink,
                  whiteSpace: 'nowrap'
                }}
              >
                {menu.label}
                {menu.children ? <span style={{ fontSize: 8, color: color.chevron }}>▼</span> : null}
              </Link>
              {menu.children && open === menu.label ? (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    minWidth: 250,
                    background: color.surface,
                    border: `1px solid ${color.hairlineSoft}`,
                    borderRadius: radius.lg,
                    boxShadow: '0 14px 34px rgba(20, 16, 58, 0.14)',
                    padding: 8,
                    zIndex: 300
                  }}
                >
                  {menu.children.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      hover={{ background: color.brandWash, color: color.ink }}
                      style={{ display: 'block', padding: '9px 12px', fontSize: 13, fontWeight: 500, color: color.inkSoft, borderRadius: 8 }}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </nav>

        <Link
          href={EDLY_LINKS.trial}
          hover={{ background: color.redDeep, color: color.onSolid }}
          style={{
            background: color.red,
            color: color.onSolid,
            borderRadius: 8,
            padding: '11px 18px',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap'
          }}
        >
          Try for Free
        </Link>
        <Link
          href={EDLY_LINKS.demo}
          hover={{ background: color.redWash, color: color.redInk }}
          style={{
            border: `1.5px solid ${color.red}`,
            color: color.red,
            borderRadius: 8,
            padding: '10px 18px',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap'
          }}
        >
          Request a Demo
        </Link>
      </div>
    </div>
  );
}
