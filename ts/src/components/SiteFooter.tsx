import { color, font, radius } from '@/theme';
import { Link } from '@/components/ui';
import { useLayout } from '@/lib/useViewport';

/**
 * The edly.io footer, matching the marketing site. Renders below the sales screens.
 *
 * The newsletter field is presentational here — it points at the edly.io signup rather than
 * posting anywhere, because this tool has no mailing-list backend.
 */

interface FooterColumn {
  title: string;
  links: [string, string][];
}

const COLUMNS: FooterColumn[] = [
  {
    title: 'Industries',
    links: [
      ['K12', 'https://edly.io/k12-lms/'],
      ['Higher Ed', 'https://edly.io/higher-education-lms/'],
      ['Corporate', 'https://edly.io/corporate-lms/'],
      ['Non Profit', 'https://edly.io/nonprofit-lms/'],
      ['Business', 'https://edly.io/business-lms/']
    ]
  },
  {
    title: 'Services',
    links: [
      ['Managed Hosting', 'https://edly.io/services/open-edx-managed-hosting/'],
      ['Open edX Installation', 'https://edly.io/services/open-edx-installation/'],
      ['Open edX Custom Solutions', 'https://edly.io/services/open-edx-custom-solutions/'],
      ['Instructional Design', 'https://edly.io/services/instructional-design/'],
      ['LMS Training and Support', 'https://edly.io/services/lms-training-support/'],
      ['Data Migration', 'https://edly.io/services/lms-data-migration/']
    ]
  },
  {
    title: 'Resources',
    links: [
      ['Blog', 'https://edly.io/resources/blog/'],
      ['Case Studies', 'https://edly.io/resources/case-studies/'],
      ['Guides and Whitepapers', 'https://edly.io/resources/guides-and-whitepapers/'],
      ['Product Updates', 'https://edly.io/resources/news-and-updates/'],
      ['FAQs', 'https://edly.io/faq/']
    ]
  },
  {
    title: 'About',
    links: [
      ['Why Edly', 'https://edly.io/why-edly/'],
      ['Our Customers', 'https://edly.io/customers/'],
      ['Features', 'https://edly.io/features/'],
      ['Edly Plans', 'https://edly.io/pricing-and-plans/'],
      ['Contact us', 'https://edly.io/contact-us/'],
      ['Sign In', 'https://panel.edly.io/']
    ]
  }
];

const linkStyle = { fontSize: 13, color: '#BDBDB8', textDecoration: 'none' } as const;

export function SiteFooter(): JSX.Element {
  const { footCols } = useLayout();

  return (
    <footer data-screen-label="Footer" style={{ background: color.dark, color: '#FFFFFF', padding: '50px 32px 24px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: footCols, gap: 36 }}>
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <div style={{ fontFamily: font.display, fontSize: 14, fontWeight: 600, marginBottom: 14 }}>{column.title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {column.links.map(([label, href]) => (
                  <Link key={label} href={href} hover={{ color: '#FFFFFF' }} style={linkStyle}>
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          ))}

          <div>
            <div style={{ fontFamily: font.display, fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Subscribe to Our Newsletter</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                placeholder="Email"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: '#333333',
                  border: '1px solid #4C4C4A',
                  borderRadius: 8,
                  color: '#FFFFFF',
                  padding: '10px 12px',
                  fontSize: 13,
                  outline: 'none',
                  fontFamily: font.body
                }}
              />
              <Link
                href="https://edly.io/resources/news-and-updates/"
                hover={{ background: color.redDeep, color: '#FFFFFF' }}
                style={{
                  background: color.red,
                  color: '#FFFFFF',
                  borderRadius: 8,
                  padding: '10px 16px',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap'
                }}
              >
                Subscribe
              </Link>
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
              <Link href="https://twitter.com/edly_inc" hover={{ color: '#FFFFFF' }} style={{ ...linkStyle, fontSize: 12.5, fontWeight: 600 }}>
                Twitter
              </Link>
              <Link href="https://www.linkedin.com/company/edly" hover={{ color: '#FFFFFF' }} style={{ ...linkStyle, fontSize: 12.5, fontWeight: 600 }}>
                LinkedIn
              </Link>
            </div>
            <div
              style={{
                marginTop: 16,
                background: '#333333',
                border: '1px solid #4C4C4A',
                borderRadius: radius.md,
                padding: '12px 14px',
                fontSize: 12,
                lineHeight: 1.6,
                color: '#BDBDB8'
              }}
            >
              This catalog is only our pre-built work.{' '}
              <Link href="https://edly.io/contact-us/" hover={{ color: '#FFFFFF' }} style={{ color: color.brandGlow, fontWeight: 600 }}>
                Need something custom? Talk to us.
              </Link>
            </div>
          </div>
        </div>

        <div
          style={{
            borderTop: `1px solid ${color.onDarkRule}`,
            marginTop: 40,
            paddingTop: 16,
            display: 'flex',
            alignItems: 'baseline',
            gap: 16,
            flexWrap: 'wrap',
            fontSize: 11.5,
            color: color.onDarkFaint
          }}
        >
          <span style={{ lineHeight: 1.6 }}>
            EDX, Open EDX are registered trademarks of edX Inc. All Rights Reserved. © Edly {new Date().getFullYear()}. All rights reserved.
          </span>
          <span style={{ flex: 1 }} />
          {(
            [
              ['Privacy Policy', 'https://edly.io/privacy-policy/'],
              ['Refund Policy', 'https://edly.io/refund-policy/'],
              ['Cancellation Policy', 'https://edly.io/cancellation-policy/'],
              ['Terms & Conditions', 'https://edly.io/terms-and-conditions/']
            ] as [string, string][]
          ).map(([label, href]) => (
            <Link key={label} href={href} hover={{ color: '#FFFFFF' }} style={{ color: '#C9C9C4', fontSize: 11.5 }}>
              {label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
