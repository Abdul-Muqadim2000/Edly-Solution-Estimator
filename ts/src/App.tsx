import { AppProvider, useApp } from '@/state/AppProvider';
import { SignIn } from '@/components/SignIn';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PracticePicker } from '@/components/PracticePicker';
import { EstimationsHub } from '@/components/EstimationsHub';
import { Builder } from '@/components/builder/Builder';
import { Desk } from '@/components/desk/Desk';
import { SyncPill } from '@/components/AppHeader';
import { color } from '@/theme';

/**
 * Routing, such as it is: which screen shows follows from state, not a URL.
 *
 *   not signed in            → SignIn
 *   no platform chosen       → PracticePicker  (always after sign-in; last choice is a shortcut)
 *   estimator               → Desk
 *   sales, no estimation open → SiteHeader + EstimationsHub + SiteFooter
 *   sales, estimation open   → SiteHeader + Builder (Hero + sticky bar) + SiteFooter
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
      <Screens />
      <SyncPill />
    </AppProvider>
  );
}
