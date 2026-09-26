import type { DeskTab } from '@/types';

/**
 * The URL, as a value.
 *
 * Deep links are the whole point: a salesperson pastes a link into Slack and a colleague lands on
 * the same estimation, on the same bundle, with the same search in the box. So a route has to say
 * enough to rebuild the screen — and nothing more. Ids and slugs only; no hours, no money, no
 * client names. A forwarded link must not leak the economics that "Present to client" hides.
 *
 * Everything in this file is pure string work, so it is unit-tested rather than clicked. The
 * bridge that applies a route to the reducer, and mirrors state back into the address bar, is
 * `state/useRouting.ts`.
 */

/** Which screen a URL asks for. `root` is "/" — the bridge decides where that lands. */
export type Screen = 'root' | 'practices' | 'hub' | 'builder' | 'desk';

/** "All solutions" in the bundle rail, spelled for a URL. */
export const ALL_BUNDLES = 'all';

const TABS: readonly DeskTab[] = ['queue', 'estimations', 'add'];

export interface Route {
  screen: Screen;
  /** Practice being browsed on the picker. */
  practice?: string;
  platform?: string;
  /** An estimation's slug. Its id is accepted too, so links made before slugs still resolve. */
  estimation?: string;
  /** Active bundle id, or `all`. Builder only. */
  bundle?: string;
  /** The delivery planner is open over the builder. Builder only. */
  plan?: boolean;
  /** Catalog search text. Builder only. */
  q?: string;
  /** Which desk tab. Desk only. */
  tab?: DeskTab;
}

/** `decodeURIComponent` throws on a stray `%`, which a hand-edited URL will have sooner or later. */
const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isTab = (value: string | undefined): value is DeskTab => TABS.includes(value as DeskTab);

/**
 * `/p/openedx/e/acme-academy/b/B03?plan=1` → a Route.
 *
 * Deliberately forgiving: anything unrecognised falls back to the root rather than throwing, so
 * a mistyped or truncated link opens the app instead of a blank page.
 */
export function parseRoute(url: string): Route {
  const raw = String(url ?? '');
  const cut = raw.indexOf('?');
  const path = cut === -1 ? raw : raw.slice(0, cut);
  const query = new URLSearchParams(cut === -1 ? '' : raw.slice(cut + 1));

  const seg = path.split('/').map(decode).filter(Boolean);
  const [first, second, third, fourth, fifth, sixth] = seg;

  if (first === 'practices') {
    return second ? { screen: 'practices', practice: second } : { screen: 'practices' };
  }

  if (first === 'p' && second) {
    const platform = second;

    if (third === 'desk') {
      if (fourth === 'e' && fifth) return { screen: 'desk', platform, estimation: fifth, tab: 'estimations' };
      return { screen: 'desk', platform, tab: isTab(fourth) ? fourth : 'queue' };
    }

    if (third === 'e' && fourth) {
      const route: Route = { screen: 'builder', platform, estimation: fourth };
      if (fifth === 'b' && sixth) route.bundle = sixth;
      const q = query.get('q')?.trim();
      if (q) route.q = q;
      if (query.get('plan') === '1') route.plan = true;
      return route;
    }

    return { screen: 'hub', platform };
  }

  return { screen: 'root' };
}

/** A Route → `/p/openedx/e/acme-academy/b/B03?plan=1`. The inverse of `parseRoute`. */
export function formatRoute(route: Route): string {
  const seg: string[] = [];

  switch (route.screen) {
    case 'practices':
      seg.push('practices');
      if (route.practice) seg.push(route.practice);
      break;

    case 'hub':
      if (route.platform) seg.push('p', route.platform);
      break;

    case 'builder':
      if (route.platform && route.estimation) {
        seg.push('p', route.platform, 'e', route.estimation);
        if (route.bundle) seg.push('b', route.bundle);
      }
      break;

    case 'desk':
      if (route.platform) {
        seg.push('p', route.platform, 'desk');
        if (route.estimation) seg.push('e', route.estimation);
        else if (route.tab && route.tab !== 'queue') seg.push(route.tab);
      }
      break;

    case 'root':
      break;
  }

  const path = `/${seg.map(encodeURIComponent).join('/')}`;

  /* search and the planner belong to the builder; emitting them anywhere else would make
     formatRoute and parseRoute disagree, and the round-trip test would catch it */
  if (route.screen !== 'builder') return path;
  const query = new URLSearchParams();
  if (route.q) query.set('q', route.q);
  if (route.plan) query.set('plan', '1');
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/* ------------------------------------------------------------ the browser */

/** The parts of `window.location` this module reads. Passed in, so the logic stays testable. */
export interface Address {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Where the app is mounted, always ending in a slash.
 *
 * `index.html` carries a `<base href>` for this, so the answer does not change as you navigate
 * deeper. Without it every relative URL in the app — the catalog sheet included — would resolve
 * against `/p/openedx/e/acme` and 404.
 */
export function basePath(baseUri: string): string {
  let pathname: string;
  try {
    pathname = new URL(baseUri, 'http://localhost').pathname;
  } catch {
    return '/';
  }
  const dir = pathname.replace(/[^/]*$/, '');
  return dir.startsWith('/') ? dir : `/${dir}`;
}

/**
 * Whether routing has to live in the hash.
 *
 * Clean paths need the host to serve `index.html` for unknown paths; `vercel.json` has that
 * rewrite. Anywhere that cannot do it — a plain static server, a `file://` preview, the
 * no-toolchain runners in VERIFY.md — the document is a named `.html` file rather than a
 * directory index, and the hash keeps a reload landing on the app instead of a 404.
 */
export function usesHash(pathname: string): boolean {
  return /\.html?$/i.test(pathname) && !/(^|\/)index\.html?$/i.test(pathname);
}

/** The app-relative url the browser is currently showing, base path and hash mode accounted for. */
export function readAddress(address: Address, base: string): string {
  if (usesHash(address.pathname)) {
    const raw = address.hash.replace(/^#/, '');
    return raw.startsWith('/') ? raw : '/';
  }
  const path = address.pathname.startsWith(base) ? address.pathname.slice(base.length - 1) : address.pathname;
  return `${path || '/'}${address.search}`;
}

/** The href for a route: what goes into history, and what "Copy link" puts on the clipboard. */
export function routeHref(route: Route, address: Address, base: string, origin = ''): string {
  const url = formatRoute(route);
  if (usesHash(address.pathname)) return `${origin}${address.pathname}#${url}`;
  return `${origin}${base.replace(/\/$/, '')}${url}`;
}

/** Two routes point at the same screen. */
export function sameRoute(a: Route, b: Route): boolean {
  return formatRoute(a) === formatRoute(b);
}

/**
 * A url with the catalog search dropped.
 *
 * This is what decides replace versus push. Search is the one thing that changes per keystroke,
 * so it replaces; everything else — the planner included — is somewhere you went, and Back has to
 * bring you out of it. Comparing whole query strings instead would let opening the planner
 * swallow the bundle's history entry, so Back would drop you two screens at once.
 */
export function withoutSearch(url: string): string {
  const cut = url.indexOf('?');
  if (cut === -1) return url;
  const params = new URLSearchParams(url.slice(cut + 1));
  params.delete('q');
  const rest = params.toString();
  return rest ? `${url.slice(0, cut)}?${rest}` : url.slice(0, cut);
}
