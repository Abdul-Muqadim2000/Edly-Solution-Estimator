import type { ReactNode } from 'react';
import { AppProvider, useApp } from '@/state/AppProvider';
import { SignIn } from '@/components/SignIn';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PracticePicker } from '@/components/PracticePicker';
import { EstimationsHub } from '@/components/EstimationsHub';
import { Builder } from '@/components/builder/Builder';
import { Desk } from '@/components/desk/Desk';
import { TenderWorkspace } from '@/components/tender/TenderWorkspace';
import { SyncPill } from '@/components/AppHeader';
import { AppFooter } from '@/components/Brand';
import { QuoteSheet } from '@/components/QuoteSheet';
import { AdminPanel } from '@/components/AdminPanel';
import { showsSiteChrome } from '@/state/reducer';
import { color } from '@/theme';

/**
 * A screen with its header and footer, the footer held at the bottom of the window when the screen
 * is shorter than it. The three slots never move, so switching presenting on or off adds the
 * edly.io header without remounting the builder under it: its search and open panels survive.
 */
function Framed({ header, children, footer }: { header?: ReactNode; children: ReactNode; footer: ReactNode }): JSX.Element {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: color.page }}>
      {header ?? null}
      <div style={{ flex: '1 0 auto' }}>{children}</div>
      {footer}
    </div>
  );
}

/**
 * Which screen shows still follows from state, and deliberately so. The URL is a projection of
 * that state rather than a second source of truth: `state/useRouting.ts` reads a link once, turns
 * it into a single `applyRoute` action, and thereafter keeps the address bar in step. So this
 * stayed a plain list of conditions when deep links arrived.
 *
 *   not signed in             → SignIn                          /
 *   the admin panel           → AdminPanel                      /admin
 *   no platform chosen        → PracticePicker                  /practices[/:practice]
 *   estimator                 → Desk                            /p/:platform/desk[/…]
 *   sales, no estimation open → EstimationsHub                  /p/:platform
 *   sales, estimation open    → Builder                         /p/:platform/e/:slug[/b/:bundle]
 *   sales, tender open        → TenderWorkspace                 /p/:platform/t/:slug
 *
 * Every screen after sign-in ends with Quotient's own footer, except the builder while a deal is
 * presented: then the edly.io header sits above it and the edly.io footer below (`showsSiteChrome`),
 * because that is what the client is watching.
 *
 * Sign-in is a client-side gate, so a deep link is not an access grant. It only decides which
 * screen someone who has already signed in lands on. See the README on putting real auth in front.
 */
function Screens(): JSX.Element {
  const { state } = useApp();

  if (!state.ready) {
    return <div style={{ minHeight: '100vh', background: color.page }} />;
  }
  if (!state.auth) return <SignIn />;
  /* it asks for the admin password itself, whoever is signed in */
  if (state.adminPanel) return <Framed footer={<AppFooter />}><AdminPanel /></Framed>;
  if (!state.platform) return <Framed footer={<AppFooter />}><PracticePicker /></Framed>;
  if (state.auth.role === 'estimator') return <Framed footer={<AppFooter />}><Desk /></Framed>;

  const chrome = showsSiteChrome(state);
  return (
    <Framed header={chrome ? <SiteHeader /> : null} footer={chrome ? <SiteFooter /> : <AppFooter />}>
      {state.openTender ? <TenderWorkspace /> : state.openEstimation ? <Builder /> : <EstimationsHub />}
    </Framed>
  );
}

export function App(): JSX.Element {
  return (
    <AppProvider>
      <div data-app="true">
        <Screens />
        <SyncPill />
      </div>
      {/* Hidden on screen; the print stylesheet swaps it in for the app. */}
      <QuoteSheet />
    </AppProvider>
  );
}
