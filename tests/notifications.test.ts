import { describe, expect, it } from 'vitest';
import {
  markSeen,
  noticeAction,
  noticesFor,
  readSeen,
  SEEN_LIMIT,
  seenStorageKey,
  unreadNotices,
  type Notice
} from '../src/domain/notifications';
import { DEMO_ID } from '../src/domain/demo';
import type { Assignment, EstimateRequest, Estimation, Person } from '../src/types';

/**
 * The bell, worked out from the records. Nothing is stored when something happens, so every rule is
 * a reading of what a deal or a request already says: who is on it and who put them there, who
 * filed it, who priced it, who asked for more detail. What is asserted is mostly who is told and
 * who is not, because a notification sent to the wrong person, or to everyone on the first day, is
 * the failure people notice.
 */

const T1 = '2026-09-30T09:00:00.000Z';
const T2 = '2026-09-30T10:00:00.000Z';
const T3 = '2026-09-30T11:00:00.000Z';

const people: Person[] = [
  { username: 'sara', name: 'Sara Khan', role: 'sales' },
  { username: 'muqadim', name: 'Abdul Muqadim', role: 'estimator' },
  { username: 'nadia', name: 'Nadia Rahman', role: 'estimator' },
  { username: 'omar', name: 'Omar Farooq', role: 'sales' }
];

const on = (user: string, by: string, at: string): Assignment => ({ user, by, at });

const estimation = (id: string, over: Partial<Estimation> = {}): Estimation => ({
  id,
  plat: 'openedx',
  name: `Deal ${id}`,
  slug: id.toLowerCase(),
  client: 'Acme Academy',
  tag: 'Active',
  due: '',
  at: '2026-09-01',
  up: '2026-09-01',
  total: 0,
  cost: 0,
  items: 0,
  snap: { sel: {}, buf: {}, bufPct: 0 },
  ...over
});

const request = (id: string, over: Partial<EstimateRequest> = {}): EstimateRequest => ({
  id,
  plat: 'openedx',
  estId: 'EST-1',
  estName: 'Deal EST-1',
  client: 'Acme Academy',
  title: `Request ${id}`,
  details: '',
  area: '',
  urgency: '',
  integrations: '',
  name: '',
  email: '',
  org: '',
  at: '2026-09-10',
  ...over
});

const kinds = (list: readonly Notice[]): string[] => list.map((one) => `${one.ticket}:${one.id}:${one.kind}`);

/* ---------------------------------------------------------- assignment */

describe('being assigned', () => {
  it('tells a person they were put on a deal, and by whom', () => {
    const records = { estimations: [estimation('EST-1', { name: 'Acme Academy LMS', assigned: [on('sara', 'omar', T1)] })], requests: [] };
    expect(noticesFor('sara', records)).toEqual([
      {
        key: `deal:EST-1:assigned:${T1}`,
        kind: 'assigned',
        by: 'omar',
        at: T1,
        ticket: 'deal',
        id: 'EST-1',
        plat: 'openedx',
        estId: 'EST-1',
        title: 'Acme Academy LMS',
        deal: 'Acme Academy LMS',
        client: 'Acme Academy'
      }
    ]);
  });

  it('tells a person they were put on a desk request, naming the deal it belongs to', () => {
    const records = {
      estimations: [estimation('EST-1', { name: 'Acme Academy LMS', client: 'Acme Academy' })],
      requests: [request('RQ-01', { title: 'Custom SSO', estName: 'An older name', assigned: [on('muqadim', 'nadia', T1)] })]
    };
    const [notice] = noticesFor('muqadim', records);
    expect(notice).toMatchObject({
      key: `request:RQ-01:assigned:${T1}`,
      kind: 'assigned',
      by: 'nadia',
      ticket: 'request',
      id: 'RQ-01',
      estId: 'EST-1',
      title: 'Custom SSO',
      /* the deal as it is called now, not as the request copied it when it was filed */
      deal: 'Acme Academy LMS',
      client: 'Acme Academy'
    });
  });

  it("falls back to the request's own copy of the deal when the deal is not here", () => {
    const records = { estimations: [], requests: [request('RQ-01', { estName: 'Nordic University', client: 'Nordic', assigned: [on('muqadim', 'nadia', T1)] })] };
    expect(noticesFor('muqadim', records)[0]).toMatchObject({ deal: 'Nordic University', client: 'Nordic' });
  });

  it('never tells the person who did it, even when they put themselves on', () => {
    const records = {
      estimations: [estimation('EST-1', { assigned: [on('sara', 'sara', T1)] })],
      requests: [request('RQ-01', { assigned: [on('muqadim', 'muqadim', T1)] })]
    };
    expect(noticesFor('sara', records)).toEqual([]);
    expect(noticesFor('muqadim', records)).toEqual([]);
  });

  it('tells only the person assigned, not the others on the ticket', () => {
    const records = { estimations: [estimation('EST-1', { assigned: [on('sara', 'omar', T1), on('omar', 'omar', T1)] })], requests: [] };
    expect(noticesFor('sara', records)).toHaveLength(1);
    expect(noticesFor('omar', records)).toEqual([]);
    expect(noticesFor('nadia', records)).toEqual([]);
  });

  it('tells a person put on by hand in the sheet, with nobody named and no time', () => {
    const records = { estimations: [estimation('EST-1', { assigned: [on('sara', '', '')] })], requests: [] };
    expect(noticesFor('sara', records)[0]).toMatchObject({ kind: 'assigned', by: '', at: '', key: 'deal:EST-1:assigned:' });
  });

  it('says nothing once the person is taken off again', () => {
    const records = { estimations: [estimation('EST-1')], requests: [request('RQ-01')] };
    expect(noticesFor('sara', records)).toEqual([]);
  });
});

/* ---------------------------------------------------- the desk's answers */

describe('hours returned and questions asked', () => {
  const priced = (over: Partial<EstimateRequest> = {}): EstimateRequest =>
    request('RQ-01', { by: 'sara', est: 24, priced: { by: 'muqadim', at: T2 }, ...over });
  const asked = (over: Partial<EstimateRequest> = {}): EstimateRequest =>
    request('RQ-02', { by: 'sara', stage: 'info', staged: { by: 'muqadim', at: T3 }, ...over });

  it('tells whoever filed the request that its hours are back, with the hours', () => {
    const [notice] = noticesFor('sara', { estimations: [estimation('EST-1')], requests: [priced()] });
    expect(notice).toMatchObject({ kind: 'estimated', by: 'muqadim', at: T2, hours: 24, key: `request:RQ-01:estimated:${T2}` });
  });

  it('tells whoever filed it that the desk needs more detail', () => {
    const [notice] = noticesFor('sara', { estimations: [estimation('EST-1')], requests: [asked()] });
    expect(notice).toMatchObject({ kind: 'info', by: 'muqadim', at: T3, key: `request:RQ-02:info:${T3}` });
    expect(notice).not.toHaveProperty('hours');
  });

  it("tells the people on the request and the people on its deal as well", () => {
    /* omar put himself on the deal, so the only thing he is told about is the hours */
    const estimations = [estimation('EST-1', { assigned: [on('omar', 'omar', T1)] })];
    const requests = [priced({ by: '', assigned: [on('nadia', 'muqadim', T1)] })];
    expect(kinds(noticesFor('omar', { estimations, requests }))).toEqual(['request:RQ-01:estimated']);
    /* nadia is told she was put on the request, and then that its hours came back */
    expect(kinds(noticesFor('nadia', { estimations, requests }))).toEqual(['request:RQ-01:estimated', 'request:RQ-01:assigned']);
  });

  it('tells nobody else, the other people on the platform included', () => {
    const records = { estimations: [estimation('EST-1', { assigned: [on('omar', 'sara', T1)] })], requests: [priced(), asked()] };
    expect(noticesFor('nadia', records)).toEqual([]);
  });

  it('never tells the person who priced it or asked, even when they filed it or are on it', () => {
    const requests = [
      priced({ by: 'muqadim', assigned: [on('muqadim', 'sara', T1)] }),
      asked({ by: 'muqadim', assigned: [on('muqadim', 'sara', T1)] })
    ];
    /* only the two assignments, which sara made */
    expect(kinds(noticesFor('muqadim', { estimations: [], requests }))).toEqual(['request:RQ-01:assigned', 'request:RQ-02:assigned']);
  });

  it('tells a person once, however many ways they are watching the request', () => {
    const estimations = [estimation('EST-1', { assigned: [on('sara', 'sara', T1)] })];
    const requests = [priced({ by: 'sara', assigned: [on('sara', 'sara', T1)] })];
    expect(kinds(noticesFor('sara', { estimations, requests }))).toEqual(['request:RQ-01:estimated']);
  });

  it('raises nothing for a request priced before who priced it was recorded', () => {
    /* every request priced before this feature has hours and no `priced`; telling everyone about
       all of them on the first day would bury the bell */
    const records = { estimations: [], requests: [request('RQ-01', { by: 'sara', est: 40, estBy: 'desk@edly.io', estAt: '2026-09-12' })] };
    expect(noticesFor('sara', records)).toEqual([]);
  });

  it('raises nothing for hours that are not there, whatever was recorded', () => {
    expect(noticesFor('sara', { estimations: [], requests: [priced({ est: 0 })] })).toEqual([]);
    expect(noticesFor('sara', { estimations: [], requests: [priced({ est: undefined })] })).toEqual([]);
  });

  it('drops the question once the request has moved on from Needs info', () => {
    expect(noticesFor('sara', { estimations: [], requests: [asked({ stage: 'progress' })] })).toEqual([]);
    expect(noticesFor('sara', { estimations: [], requests: [asked({ stage: undefined })] })).toEqual([]);
    /* priced while still marked Needs info: the hours say it is estimated, so only they are told */
    expect(kinds(noticesFor('sara', { estimations: [], requests: [asked({ est: 16, priced: { by: 'muqadim', at: T3 } })] }))).toEqual(['request:RQ-02:estimated']);
  });

  it('raises nothing for a request in Needs info that nobody is recorded as moving there', () => {
    /* a status typed into the sheet by hand, or set before `staged` existed */
    expect(noticesFor('sara', { estimations: [], requests: [asked({ staged: undefined })] })).toEqual([]);
  });

  it('says The desk when the hours came back from a session with no name', () => {
    const [notice] = noticesFor('sara', { estimations: [], requests: [priced({ priced: { by: '', at: T2 } })] });
    expect(notice?.by).toBe('');
    expect(notice && noticeAction(notice, people)).toEqual({ who: 'The desk', did: 'returned 24 h on' });
  });
});

/* ---------------------------------------------------------- the demo */

describe('the demo estimation', () => {
  it('raises nothing, because nobody is ever told about records that are never stored', () => {
    const records = {
      estimations: [estimation(DEMO_ID, { assigned: [on('sara', 'omar', T1)] })],
      requests: [
        request('RQ-DEMO-1', { estId: DEMO_ID, by: 'sara', est: 24, priced: { by: 'muqadim', at: T2 }, assigned: [on('sara', 'omar', T1)] }),
        /* a request someone filed while trying the demo takes a normal number but belongs to it */
        request('RQ-04', { estId: DEMO_ID, by: 'sara', stage: 'info', staged: { by: 'muqadim', at: T3 } })
      ]
    };
    expect(noticesFor('sara', records)).toEqual([]);
  });
});

/* ---------------------------------------------------------- the list */

describe('the order and the keys', () => {
  it('lists the newest first and anything with no time, typed into the sheet, last', () => {
    const records = {
      estimations: [
        estimation('EST-1', { assigned: [on('sara', 'omar', T1)] }),
        estimation('EST-2', { assigned: [on('sara', '', '')] }),
        estimation('EST-3', { assigned: [on('sara', 'omar', T3)] })
      ],
      requests: [request('RQ-01', { estId: 'EST-1', by: 'sara', est: 8, priced: { by: 'muqadim', at: T2 } })]
    };
    expect(kinds(noticesFor('sara', records))).toEqual(['deal:EST-3:assigned', 'request:RQ-01:estimated', 'deal:EST-1:assigned', 'deal:EST-2:assigned']);
  });

  it('breaks a tie in time by the key, so the list never flickers between reads', () => {
    const estimations = [estimation('EST-2', { assigned: [on('sara', 'omar', T1)] }), estimation('EST-1', { assigned: [on('sara', 'omar', T1)] })];
    const forwards = noticesFor('sara', { estimations, requests: [] });
    const backwards = noticesFor('sara', { estimations: [...estimations].reverse(), requests: [] });
    expect(kinds(forwards)).toEqual(['deal:EST-1:assigned', 'deal:EST-2:assigned']);
    expect(kinds(backwards)).toEqual(kinds(forwards));
  });

  it('stops at the limit, keeping the newest', () => {
    const estimations = Array.from({ length: 5 }, (_, i) => estimation(`EST-${i + 1}`, { assigned: [on('sara', 'omar', `2026-09-2${i}T09:00:00.000Z`)] }));
    expect(noticesFor('sara', { estimations, requests: [] }, 2).map((one) => one.id)).toEqual(['EST-5', 'EST-4']);
    expect(noticesFor('sara', { estimations, requests: [] })).toHaveLength(5);
  });

  it('keeps the same key while the event stands, so a read mark holds across reads', () => {
    const records = { estimations: [estimation('EST-1', { assigned: [on('sara', 'omar', T1)] })], requests: [] };
    const again = { estimations: [estimation('EST-1', { name: 'Renamed deal', assigned: [on('sara', 'omar', T1)] })], requests: [] };
    expect(noticesFor('sara', again)[0]?.key).toBe(noticesFor('sara', records)[0]?.key);
  });

  it('makes a new key for a new event, so being put back on or priced again is unread', () => {
    const first = noticesFor('sara', { estimations: [estimation('EST-1', { assigned: [on('sara', 'omar', T1)] })], requests: [] })[0]?.key;
    const putBack = noticesFor('sara', { estimations: [estimation('EST-1', { assigned: [on('sara', 'omar', T2)] })], requests: [] })[0]?.key;
    expect(putBack).not.toBe(first);

    const pricedAt = (at: string): string | undefined =>
      noticesFor('sara', { estimations: [], requests: [request('RQ-01', { by: 'sara', est: 8, priced: { by: 'muqadim', at } })] })[0]?.key;
    expect(pricedAt(T3)).not.toBe(pricedAt(T2));
  });

  it('shows nothing to nobody', () => {
    const records = { estimations: [estimation('EST-1', { assigned: [on('', 'omar', T1)] })], requests: [] };
    expect(noticesFor('', records)).toEqual([]);
  });
});

/* ---------------------------------------------------------- the sentence */

describe('what a notification says', () => {
  const notice = (over: Partial<Notice>): Notice => ({
    key: 'k',
    kind: 'assigned',
    by: 'nadia',
    at: T1,
    ticket: 'deal',
    id: 'EST-1',
    plat: 'openedx',
    estId: 'EST-1',
    title: 'Acme Academy LMS',
    deal: 'Acme Academy LMS',
    client: 'Acme Academy',
    ...over
  });

  it('names who assigned you', () => {
    expect(noticeAction(notice({}), people)).toEqual({ who: 'Nadia Rahman', did: 'assigned you to' });
    expect(noticeAction(notice({ by: 'admin' }), people)).toEqual({ who: 'Admin', did: 'assigned you to' });
  });

  it('says you were assigned when nobody is recorded as doing it', () => {
    expect(noticeAction(notice({ by: '' }), people)).toEqual({ who: 'You were', did: 'assigned to' });
  });

  it('names who returned the hours, and how many', () => {
    expect(noticeAction(notice({ kind: 'estimated', by: 'muqadim', hours: 12.5 }), people)).toEqual({ who: 'Abdul Muqadim', did: 'returned 12.5 h on' });
  });

  it('names who asked for more detail, or The desk when nobody is named', () => {
    expect(noticeAction(notice({ kind: 'info', by: 'muqadim' }), people)).toEqual({ who: 'Abdul Muqadim', did: 'asked for more detail on' });
    expect(noticeAction(notice({ kind: 'info', by: '' }), people)).toEqual({ who: 'The desk', did: 'asked for more detail on' });
  });

  it('still names someone who has since been removed, by their @name', () => {
    expect(noticeAction(notice({ by: 'farid' }), people)).toEqual({ who: '@farid', did: 'assigned you to' });
  });
});

/* ---------------------------------------------------------- read marks */

describe('what has been read', () => {
  it('keeps each person their own marks in browser storage', () => {
    expect(seenStorageKey('sara')).toBe('quotient-seen-v1:sara');
    expect(seenStorageKey('sara')).not.toBe(seenStorageKey('omar'));
  });

  it('reads anything but a list of keys as nothing read', () => {
    expect(readSeen(null)).toEqual([]);
    expect(readSeen('deal:EST-1')).toEqual([]);
    expect(readSeen({ 0: 'deal:EST-1' })).toEqual([]);
    expect(readSeen(['deal:EST-1', '', 7, null, 'request:RQ-01'])).toEqual(['deal:EST-1', 'request:RQ-01']);
  });

  it('adds new marks at the end, once each', () => {
    expect(markSeen(['a'], ['b', 'a', 'c', 'b', ''])).toEqual(['a', 'b', 'c']);
  });

  it('hands back the same marks when nothing new was read', () => {
    const seen = ['a', 'b'];
    const next = markSeen(seen, ['a', '']);
    expect(next).toEqual(seen);
    /* a copy, so the caller can store it without sharing the array */
    expect(next).not.toBe(seen);
  });

  it('drops the oldest marks past the limit', () => {
    const seen = Array.from({ length: SEEN_LIMIT }, (_, i) => `old-${i}`);
    const next = markSeen(seen, ['new-1', 'new-2']);
    expect(next).toHaveLength(SEEN_LIMIT);
    expect(next[0]).toBe('old-2');
    expect(next.slice(-2)).toEqual(['new-1', 'new-2']);
  });

  it('never prunes a mark because its notification is not showing', () => {
    /* a read that came back without a notice would otherwise forget it was read, and the next read
       that brings it back would show it unread */
    expect(markSeen(['gone-for-now'], ['showing'])).toEqual(['gone-for-now', 'showing']);
  });

  it('leaves the unread ones, in the order given', () => {
    const records = {
      estimations: [estimation('EST-1', { assigned: [on('sara', 'omar', T1)] }), estimation('EST-2', { assigned: [on('sara', 'omar', T2)] })],
      requests: []
    };
    const notices = noticesFor('sara', records);
    const firstKey = notices[0]?.key ?? '';
    expect(unreadNotices(notices, [])).toEqual(notices);
    expect(unreadNotices(notices, [firstKey]).map((one) => one.id)).toEqual(['EST-1']);
    expect(unreadNotices(notices, markSeen([], notices.map((one) => one.key)))).toEqual([]);
  });
});
