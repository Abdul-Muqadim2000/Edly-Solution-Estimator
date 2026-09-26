import { AppProvider, useApp } from '@/state/AppProvider';
import { SignIn } from '@/components/SignIn';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PracticePicker } from '@/components/PracticePicker';
import { EstimationsHub } from '@/components/EstimationsHub';
import { Builder } from '@/components/builder/Builder';
import { Desk } from '@/components/desk/Desk';
import { SyncPill } from '@/components/AppHeader';
import { QuoteSheet } from '@/components/QuoteSheet';
import { color } from '@/theme';

/**
 * Which screen shows still follows from state, and deliberately so. The URL is a projection of
 * that state rather than a second source of truth: `state/useRouting.ts` reads a link once, turns
 * it into a single `applyRoute` action, and thereafter keeps the address bar in step. So this
 * stayed a plain list of conditions when deep links arrived.
 *
 *   not signed in             → SignIn                          /
 *   no platform chosen        → PracticePicker                  /practices[/:practice]
 *   estimator                 → Desk                            /p/:platform/desk[/…]
 *   sales, no estimation open → SiteHeader + EstimationsHub      /p/:platform
 *   sales, estimation open    → SiteHeader + Builder             /p/:platform/e/:slug[/b/:bundle]
 *
 * Sign-in is a client-side gate, so a deep link is not an access grant — it only decides which
 * screen someone who has already signed in lands on. See the README on putting real auth in front.
 */
function Screens(): JSX.Element {
  const { state } = useApp();

  if (!state.ready) {
    return <div style={{ minHeight: '100vh', background: color.page }} />;
  }
  if (!state.auth) return <SignIn />;
  if (!state.platform) return <PracticePicker />;
  if (state.auth.role === 'estimator') return <Desk />;
  /* sales screens carry the edly.io marketing chrome above them — clients see this on a screen-share */
  return (
    <>
      <SiteHeader />
      {state.openEstimation ? <Builder /> : <EstimationsHub />}
      <SiteFooter />
    </>
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
