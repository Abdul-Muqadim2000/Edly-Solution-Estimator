import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DESK_EMAIL, mailOne, mailRequests, requestEmailBody, singleRequestEmail } from '../src/lib/mail';
import { copyText } from '../src/lib/clipboard';
import type { EstimateRequest } from '../src/types';

/**
 * The mail that reaches the estimation desk, and the clipboard fallback behind it.
 *
 * The desk queue is the real channel; this is the belt-and-braces copy, and its whole reason for
 * existing is the machine with no mail client configured — where `mailto:` silently does nothing.
 * So what is asserted here is mostly the failure path: nothing throws, and the text still lands
 * on the clipboard when the draft never opens.
 *
 * These are browser APIs, stubbed rather than rendered. The node test environment has no DOM, so
 * each stub is the minimum the module actually touches.
 */

interface FakeAnchor {
  href: string;
  target: string;
  rel: string;
  value: string;
  style: Record<string, string>;
  click(): void;
  select(): void;
}

let anchors: FakeAnchor[];
let copied: string[];
let clipboardWorks: boolean;
let execCommandWorks: boolean;
let clickThrows: boolean;

const stubBrowser = (): void => {
  anchors = [];
  copied = [];
  clipboardWorks = true;
  execCommandWorks = true;
  clickThrows = false;

  const make = (): FakeAnchor => {
    const element: FakeAnchor = {
      href: '',
      target: '',
      rel: '',
      value: '',
      style: {},
      click() {
        if (clickThrows) throw new Error('no mail handler');
      },
      select() {}
    };
    anchors.push(element);
    return element;
  };

  Object.assign(globalThis, {
    window: { location: { href: 'https://estimator.edly.io/p/openedx/e/acme-academy' } },
    document: {
      createElement: () => make(),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: () => {
        if (!execCommandWorks) throw new Error('denied');
        const last = anchors[anchors.length - 1];
        if (last) copied.push(last.value);
        return true;
      }
    },
    navigator: {
      clipboard: {
        writeText: async (text: string) => {
          if (!clipboardWorks) throw new Error('denied without a user gesture');
          copied.push(text);
        }
      }
    }
  });
};

beforeEach(stubBrowser);

afterEach(() => {
  for (const key of ['window', 'document', 'navigator']) delete (globalThis as Record<string, unknown>)[key];
});

const request = (over: Partial<EstimateRequest> = {}): EstimateRequest => ({
  id: 'RQ-01',
  plat: 'openedx',
  estId: 'EST-1',
  estName: 'Acme Academy',
  client: 'Acme Inc',
  title: 'Custom SSO',
  details: 'Okta, SAML',
  area: 'Auth',
  urgency: 'Before March',
  integrations: 'Okta',
  name: 'Rep Name',
  email: 'rep@edly.io',
  org: 'Edly',
  at: '2026-01-01',
  ...over
});

describe('the note for one new request', () => {
  it('carries everything the desk needs to price it', () => {
    const { subject, body } = singleRequestEmail(request());

    expect(subject).toBe('Estimate request RQ-01 — Custom SSO');
    expect(body).toContain('RQ-01 — Custom SSO');
    expect(body).toContain('Details: Okta, SAML');
    expect(body).toContain('Closest area: Auth');
    expect(body).toContain('Systems: Okta');
    expect(body).toContain('Timeline: Before March');
    expect(body).toContain('Rep Name · Edly');
    expect(body).toContain('rep@edly.io');
  });

  it('links back to the deal the request came from', () => {
    const { body } = singleRequestEmail(request());
    /* a real deep link, so the desk lands on the deal rather than on the sign-in screen */
    expect(body).toContain('Bundle link: https://estimator.edly.io/p/openedx/e/acme-academy');
    /* and it carries ids only: no hours, no money, no client names in the URL */
    expect(body).not.toMatch(/Bundle link:.*\$/);
  });

  it('leaves out the optional lines rather than printing empty labels', () => {
    const { body } = singleRequestEmail(request({ area: '', integrations: '', urgency: '' }));
    expect(body).not.toContain('Closest area:');
    expect(body).not.toContain('Systems:');
    expect(body).not.toContain('Timeline:');
  });

  it('copes with a request nobody signed', () => {
    const { body } = singleRequestEmail(request({ name: '', org: '', email: '' }));
    expect(body).toContain('RQ-01 — Custom SSO');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
  });
});

describe('the chaser for a whole estimation', () => {
  it('lists every outstanding request', () => {
    const body = requestEmailBody([request(), request({ id: 'RQ-02', title: 'Proctoring', details: 'Live invigilation' })], {
      name: 'Acme Academy',
      client: 'Acme Inc'
    });

    expect(body).toContain('RQ-01 — Custom SSO');
    expect(body).toContain('RQ-02 — Proctoring');
    expect(body).toContain('Details: Live invigilation');
  });

  it('adds the bundle context only when there is a selection', () => {
    const withContext = requestEmailBody([request()], { name: 'Acme', client: 'Acme Inc', selected: 12, hours: '480' });
    expect(withContext).toContain('Alongside our selected bundle: 12 solutions, 480 h');

    const without = requestEmailBody([request()], { name: 'Acme', client: 'Acme Inc' });
    expect(without).not.toContain('Alongside our selected bundle');
  });

  it('signs off with whoever raised the last one', () => {
    const body = requestEmailBody([request(), request({ id: 'RQ-02', name: 'Second Rep', org: 'Edly', email: 'second@edly.io' })], {
      name: 'Acme',
      client: 'Acme Inc'
    });
    expect(body.trim().endsWith('second@edly.io')).toBe(true);
  });

  it('produces something sane for an empty list', () => {
    const body = requestEmailBody([], { name: 'Acme', client: 'Acme Inc' });
    expect(body).toContain('Hi Edly team');
    expect(body).not.toContain('undefined');
  });
});

describe('sending', () => {
  it('opens a draft addressed to the desk and copies the same text', async () => {
    const result = await mailOne(request());

    expect(result).toEqual({ copied: true, opened: true });
    expect(anchors[0]?.href).toContain(`mailto:${DESK_EMAIL}`);
    expect(anchors[0]?.href).toContain('subject=Estimate%20request%20RQ-01');
    /* opened in a new context, so a mailto: navigation cannot tear down the workspace */
    expect(anchors[0]?.target).toBe('_blank');
    expect(anchors[0]?.rel).toBe('noopener');
    expect(copied[0]).toContain(`To: ${DESK_EMAIL}`);
    expect(copied[0]).toContain('Custom SSO');
  });

  it('still copies when no mail client answers', async () => {
    clickThrows = true;

    const result = await mailOne(request());

    /* this is the whole point of the module: the text is on the clipboard either way */
    expect(result).toEqual({ copied: true, opened: false });
    expect(copied[0]).toContain('Custom SSO');
  });

  it('reports honestly when neither the draft nor the clipboard works', async () => {
    clickThrows = true;
    clipboardWorks = false;
    execCommandWorks = false;

    expect(await mailOne(request())).toEqual({ copied: false, opened: false });
  });

  it('mails a batch under one subject naming each id', async () => {
    const result = await mailRequests([request(), request({ id: 'RQ-02' })], { name: 'Acme', client: 'Acme Inc' });

    expect(result.opened).toBe(true);
    expect(decodeURIComponent(anchors[0]?.href ?? '')).toContain('Custom estimate request — RQ-01, RQ-02');
  });

  it('does nothing at all for an empty batch', async () => {
    expect(await mailRequests([], { name: 'Acme', client: 'Acme Inc' })).toEqual({ copied: false, opened: false });
    expect(anchors).toHaveLength(0);
  });
});

describe('copying to the clipboard', () => {
  it('uses the clipboard API when it is allowed', async () => {
    expect(await copyText('hello')).toBe(true);
    expect(copied).toEqual(['hello']);
  });

  it('falls back to a hidden textarea when the API refuses', async () => {
    /* http, or no user gesture — exactly where a salesperson demoing off a laptop tends to be */
    clipboardWorks = false;

    expect(await copyText('hello')).toBe(true);
    expect(copied).toEqual(['hello']);
  });

  it('falls back when there is no clipboard API at all', async () => {
    Object.assign(globalThis, { navigator: {} });
    expect(await copyText('hello')).toBe(true);
    expect(copied).toEqual(['hello']);
  });

  it('reports failure rather than throwing when nothing works', async () => {
    clipboardWorks = false;
    execCommandWorks = false;
    expect(await copyText('hello')).toBe(false);
  });
});
