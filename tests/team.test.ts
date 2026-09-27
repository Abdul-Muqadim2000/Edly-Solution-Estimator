import { describe, expect, it } from 'vitest';
import { teamComposition } from '../src/domain/team';
import { calcEstimate } from '../src/domain/estimate';
import { schedule } from '../src/domain/planner';
import type { Catalog, EstimationSnapshot, RateRole, Solution } from '../src/types';

/**
 * The team a delivery needs: role and seniority from the rate card, people and weeks from the
 * delivery plan.
 *
 * The hours have to add up to the grand total, or the team sheet contradicts the breakdown it sits
 * beside. The people have to come from the plan's bars, because that is where sales decides how
 * many engineers work on something at once.
 */

const solution = (id: string, first: number): Solution => ({
  id,
  name: `Solution ${id}`,
  desc: '',
  form: 'Integration',
  status: 'Production',
  deploy: '2 days',
  first,
  repeat: null,
  build: null,
  saving: null,
  account: null,
  integrations: null,
  notes: null,
  ref: null,
  category: 'Core Platform',
  subCategory: null
});

const catalog: Catalog = {
  meta: {
    title: 'Test',
    subtitle: '',
    compiled: '',
    totals: { features: 3, buildHrs: null, firstHrs: null, repeatHrs: null, saved: null, noEstimate: 0, inDev: 0 },
    notes: []
  },
  bundles: [
    {
      id: 'B01',
      name: 'Core',
      pitch: '',
      offerWhen: '',
      featureCount: 3,
      buildHrs: null,
      firstHrs: null,
      repeatHrs: null,
      saved: null,
      noEstimate: 0,
      inDev: 0,
      accounts: null,
      pairsWith: null,
      items: [solution('A', 80), solution('B', 40), solution('C', 40)]
    }
  ]
};

const roles: RateRole[] = [
  { id: 'eng-sr', name: 'Engineer', level: 'Senior', rate: 60 },
  { id: 'eng-jr', name: 'Engineer', level: 'Junior', rate: 30 },
  { id: 'devops', name: 'DevOps Engineer', level: 'Mid-level', rate: 50 },
  { id: 'pm', name: 'Project Manager', level: 'Senior', rate: 40 },
  { id: 'qa', name: 'QA Engineer', level: 'Mid-level', rate: 35 }
];

const snap = (over: Partial<EstimationSnapshot> = {}): EstimationSnapshot => ({
  sel: { A: true, B: true, C: true },
  buf: {},
  bufPct: 10,
  pm: 10,
  qa: 5,
  rate: 100,
  cur: 'USD',
  roles,
  lineRole: { A: 'eng-sr', B: 'eng-jr', C: 'eng-jr' },
  /* A has two people; B and C are pinned to the same week, so two juniors work at once */
  plan: { A: { people: 2 }, B: { start: 0 }, C: { start: 0 } },
  hpw: 40,
  maxPar: 6,
  planStart: '',
  ...over
});

const build = (snapshot: EstimationSnapshot = snap(), blendBuffer = false) => {
  const estimate = calcEstimate(catalog, snapshot, []);
  const plan = schedule(estimate, [], snapshot, { blendBuffer });
  return { estimate, plan, team: teamComposition(estimate, snapshot, plan) };
};

const row = (team: ReturnType<typeof build>['team'], roleId: string) => team.rows.find((candidate) => candidate.roleId === roleId);

describe('what the team adds up to', () => {
  it('bills exactly the grand total, in hours and in money', () => {
    for (const blendBuffer of [false, true]) {
      const { estimate, team } = build(snap(), blendBuffer);
      expect(team.hours).toBeCloseTo(estimate.grand, 6);
      expect(Math.round(team.cost)).toBe(estimate.usd);
    }
  });

  it("gives each role its lines' hours with their share of the buffer, at that role's rate", () => {
    const { team } = build();
    /* A is 80 h plus 10% */
    expect(row(team, 'eng-sr')?.hours).toBeCloseTo(88, 6);
    expect(row(team, 'eng-sr')?.cost).toBeCloseTo(88 * 60, 6);
    expect(row(team, 'eng-jr')?.hours).toBeCloseTo(88, 6);
    expect(row(team, 'eng-jr')?.cost).toBeCloseTo(88 * 30, 6);
  });
});

describe('who is on it', () => {
  it('keeps one role at two levels as two rows, in rate-card order', () => {
    const { team } = build();
    expect(team.rows.map((candidate) => [candidate.role, candidate.level])).toEqual([
      ['Engineer', 'Senior'],
      ['Engineer', 'Junior'],
      ['Project Manager', 'Senior'],
      ['QA Engineer', 'Mid-level']
    ]);
  });

  it('leaves out a role nobody is billed at', () => {
    /* DevOps is on the card but has no lines */
    expect(row(build().team, 'devops')).toBeUndefined();
  });

  it('puts PM and QA overhead on the roles the rate card gives them', () => {
    const { estimate, team } = build();
    expect(row(team, 'pm')?.hours).toBeCloseTo(estimate.pmH, 6);
    expect(row(team, 'pm')?.carries).toEqual(['pm']);
    expect(row(team, 'qa')?.hours).toBeCloseTo(estimate.qaH, 6);
    expect(row(team, 'qa')?.carries).toEqual(['qa']);
  });

  it('adds overhead to a role that also has lines of its own', () => {
    const { estimate, team } = build(snap({ lineRole: { A: 'eng-sr', B: 'qa', C: 'eng-jr' } }));
    const qa = row(team, 'qa');
    expect(qa?.hours).toBeCloseTo(40 * 1.1 + estimate.qaH, 6);
    expect(qa?.carries).toEqual(['qa']);
  });

  it('puts work with no role, and a role no longer on the card, on an Unassigned row, last', () => {
    const { estimate, team } = build(snap({ lineRole: { A: 'eng-sr', B: 'retired-role' } }));
    const unassigned = team.rows.at(-1);
    expect(unassigned?.roleId).toBe('');
    expect(unassigned?.role).toBe('Unassigned');
    expect(unassigned?.rate).toBe(estimate.rate);
    /* B and C, 40 h each plus 10% */
    expect(unassigned?.hours).toBeCloseTo(88, 6);
  });

  it('puts overhead on the Unassigned row when no role on the card can carry it', () => {
    const engineersOnly = roles.filter((role) => role.id.startsWith('eng'));
    const { estimate, team } = build(snap({ roles: engineersOnly }));
    const unassigned = row(team, '');
    expect(unassigned?.hours).toBeCloseTo(estimate.pmH + estimate.qaH, 6);
    expect(unassigned?.carries).toEqual(['pm', 'qa']);
  });
});

describe('people and weeks, from the delivery plan', () => {
  it('counts the most people in a role working at the same time', () => {
    const { team } = build();
    expect(row(team, 'eng-sr')?.people).toBe(2);
    /* B and C overlap in week 1, one person each */
    expect(row(team, 'eng-jr')?.people).toBe(2);
  });

  it('counts people once when their bars follow one another', () => {
    const { team } = build(snap({ plan: { A: { people: 2 }, B: { start: 0 }, C: { start: 4 } } }));
    expect(row(team, 'eng-jr')?.people).toBe(1);
  });

  it("reads a role's weeks from its first bar to its last", () => {
    const { team, plan } = build(snap({ plan: { A: { people: 2 }, B: { start: 0 }, C: { start: 4 } } }));
    const juniors = plan.tasks.filter((task) => task.key === 'B' || task.key === 'C');
    const last = Math.max(...juniors.map((task) => task.start + task.dur));
    expect(row(team, 'eng-jr')?.weeks).toEqual({ from: 1, to: Math.ceil(last) });
  });

  it('gives an overhead role one person across the whole delivery, with no bar of its own', () => {
    const { team, plan } = build();
    expect(row(team, 'pm')?.people).toBe(1);
    expect(row(team, 'pm')?.weeks).toEqual({ from: 1, to: Math.ceil(plan.end) });
  });

  it('does not staff the risk buffer bar, which is contingency time and not a person', () => {
    const { team, plan } = build(snap(), false);
    expect(plan.tasks.some((task) => task.kind === 'buffer')).toBe(true);
    /* every line has a role and so does the overhead: no Unassigned row appears for the buffer */
    expect(row(team, '')).toBeUndefined();
  });

  it('makes the team the sum of every role, since one person does not fill two rows', () => {
    const { team } = build();
    expect(team.size).toBe(2 + 2 + 1 + 1);
    expect(team.weeks).toBeGreaterThan(0);
  });

  it('has nobody and no weeks when nothing is selected', () => {
    const { team } = build(snap({ sel: {} }));
    expect(team.rows).toEqual([]);
    expect(team.size).toBe(0);
    expect(team.weeks).toBe(0);
  });
});
