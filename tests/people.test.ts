import { describe, expect, it } from 'vitest';
import {
  ADMIN_USER,
  assignedDetail,
  assignedLabel,
  assignedUsers,
  initials,
  isAdmin,
  matchPeople,
  MIN_PASSWORD,
  nextAssignments,
  normalUsername,
  passwordProblem,
  personName,
  readAssigned,
  readEvent,
  readRole,
  roleLabel,
  sameAssignees,
  usernameProblem
} from '../src/domain/people';
import type { Assignment, Person } from '../src/types';

/**
 * Who can sign in and who is on what, as plain data. A username is the key every assignment, every
 * `assignedTo` cell and every read mark points at, so most of what is asserted here is that one
 * person stays one person: typed with an @, in capitals, twice, or by hand into the sheet.
 */

const people: Person[] = [
  { username: 'sara', name: 'Sara Khan', role: 'sales' },
  { username: 'sarah.lee', name: 'Sarah Lee', role: 'estimator' },
  { username: 'muqadim', name: 'Abdul Muqadim', role: 'estimator' },
  { username: 'omar', name: 'Omar Sara', role: 'sales' },
  { username: 'lisara', name: 'Li Zhang', role: 'sales' },
  { username: 'nadia', name: 'Nadia Rahman', role: 'estimator' }
];

const usernames = (list: readonly Person[]): string[] => list.map((one) => one.username);

const T1 = '2026-09-30T09:00:00.000Z';
const T2 = '2026-09-30T10:30:00.000Z';

/* ------------------------------------------------------------ accounts */

describe('a username', () => {
  it('is read the way it was meant, with the @ and the capitals and the spaces gone', () => {
    expect(normalUsername('@Muqadim ')).toBe('muqadim');
    expect(normalUsername('  @@Sara')).toBe('sara');
    expect(normalUsername(undefined)).toBe('');
    expect(normalUsername(null)).toBe('');
  });

  it('asks for one when none is given, an @ on its own included', () => {
    expect(usernameProblem('', [])).toBe('Give them a username.');
    expect(usernameProblem('  @ ', [])).toBe('Give them a username.');
  });

  it('keeps "admin" for the built-in account, however it is typed', () => {
    /* a created "admin" would share the one name the server lets manage accounts */
    expect(usernameProblem('admin', [])).toBe('"admin" is the built-in admin account.');
    expect(usernameProblem('@Admin ', [])).toBe('"admin" is the built-in admin account.');
    expect(ADMIN_USER).toBe('admin');
  });

  it('refuses one that could not sit in the assignedTo column as a single word', () => {
    const malformed = 'Use 2 to 32 letters, digits, dots, dashes or underscores, starting with a letter or digit.';
    expect(usernameProblem('s', [])).toBe(malformed);
    expect(usernameProblem('Abdul Muqadim', [])).toBe(malformed);
    expect(usernameProblem('-sara', [])).toBe(malformed);
    expect(usernameProblem('.sara', [])).toBe(malformed);
    expect(usernameProblem('sara!', [])).toBe(malformed);
    expect(usernameProblem('sara,omar', [])).toBe(malformed);
    expect(usernameProblem('a'.repeat(33), [])).toBe(malformed);
  });

  it('takes letters, digits, dots, dashes and underscores, up to 32', () => {
    expect(usernameProblem('sa', [])).toBeNull();
    expect(usernameProblem('sarah.lee', [])).toBeNull();
    expect(usernameProblem('omar_2', [])).toBeNull();
    expect(usernameProblem('li-zhang', [])).toBeNull();
    expect(usernameProblem('7nadia', [])).toBeNull();
    expect(usernameProblem('a'.repeat(32), [])).toBeNull();
  });

  it('says a taken one is taken, and "@Muqadim" is the same person as muqadim', () => {
    expect(usernameProblem('@Muqadim', ['muqadim'])).toBe('@muqadim is already taken.');
    expect(usernameProblem('@Muqadim', ['sara'])).toBeNull();
  });
});

describe('a password', () => {
  it('needs six characters at least and two hundred at most', () => {
    expect(passwordProblem('')).toBe(`Use at least ${MIN_PASSWORD} characters.`);
    expect(passwordProblem('five5')).toBe('Use at least 6 characters.');
    expect(passwordProblem('sixsix')).toBeNull();
    expect(passwordProblem('x'.repeat(200))).toBeNull();
    expect(passwordProblem('x'.repeat(201))).toBe('Use at most 200 characters.');
  });
});

describe('a role typed into the Users sheet', () => {
  it('reads the words a person uses for the desk as the estimator role', () => {
    for (const typed of ['Estimator', 'estimator', ' ESTIMATOR ', 'estimation desk', 'Estimate', 'Desk', 'desk team']) {
      expect(readRole(typed)).toBe('estimator');
    }
  });

  it('reads anything else as sales, a blank cell included', () => {
    for (const typed of ['Sales', 'sales', '', 'the desk', 'Account', 42, undefined, null]) {
      expect(readRole(typed)).toBe('sales');
    }
  });

  it('writes each role back as the word it reads', () => {
    expect(readRole(roleLabel('estimator'))).toBe('estimator');
    expect(readRole(roleLabel('sales'))).toBe('sales');
    expect(roleLabel('estimator')).toBe('Estimator');
    expect(roleLabel('sales')).toBe('Sales');
  });
});

describe('the built-in admin', () => {
  it('is the admin username and nobody else', () => {
    expect(isAdmin({ user: 'admin' })).toBe(true);
    expect(isAdmin({ user: 'sara' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

/* ------------------------------------------------------------ names */

describe('what to call someone', () => {
  it('calls the admin Admin and a person on the list by their display name', () => {
    expect(personName(people, 'admin')).toBe('Admin');
    expect(personName(people, 'sara')).toBe('Sara Khan');
  });

  it('shows a removed person as their @name, so the ticket still says who it was', () => {
    expect(personName(people, 'farid')).toBe('@farid');
    expect(personName([], 'sara')).toBe('@sara');
  });

  it('falls back to the @name for a person whose name was left blank in the sheet', () => {
    expect(personName([{ username: 'farid', name: '', role: 'sales' }], 'farid')).toBe('@farid');
  });

  it('says Someone when nobody is named at all', () => {
    expect(personName(people, '')).toBe('Someone');
  });
});

describe('initials for an avatar', () => {
  it('takes the first and last word of a name', () => {
    expect(initials('Sara Khan')).toBe('SK');
    expect(initials('Abdul Muqadim Qureshi')).toBe('AQ');
  });

  it('takes the first two letters of a single word, a username included', () => {
    expect(initials('sara')).toBe('SA');
    expect(initials('@muqadim')).toBe('MU');
    expect(initials('x')).toBe('X');
  });

  it('splits a username at its dots, dashes and underscores', () => {
    expect(initials('sarah.lee')).toBe('SL');
    expect(initials('li-zhang')).toBe('LZ');
    expect(initials('omar_farooq')).toBe('OF');
  });

  it('shows a question mark rather than an empty circle', () => {
    expect(initials('')).toBe('?');
    expect(initials('@')).toBe('?');
  });
});

/* ------------------------------------------------------------ the @ list */

describe('who an @ offers', () => {
  it('ranks the exact username, then usernames starting with it, then a word of a name, then anything containing it', () => {
    /* sara is exact, sarah.lee starts with it, Omar Sara has it as a word, lisara contains it */
    expect(usernames(matchPeople(people, 'sara'))).toEqual(['sara', 'sarah.lee', 'omar', 'lisara']);
  });

  it('reads what was typed the way a username is read', () => {
    expect(usernames(matchPeople(people, '@Sara'))).toEqual(['sara', 'sarah.lee', 'omar', 'lisara']);
  });

  it('finds someone by a word of their name when the username does not match', () => {
    expect(usernames(matchPeople(people, 'khan'))).toEqual(['sara']);
    expect(usernames(matchPeople(people, 'zh'))).toEqual(['lisara']);
  });

  it('orders people of the same rank by name, so the list does not reshuffle as they type', () => {
    /* muqadim starts with m; omar and Nadia Rahman only contain it, and Nadia sorts first */
    expect(usernames(matchPeople(people, 'm'))).toEqual(['muqadim', 'nadia', 'omar']);
  });

  it('leaves out whoever is already on the ticket', () => {
    expect(usernames(matchPeople(people, 'sara', ['sara', 'omar']))).toEqual(['sarah.lee', 'lisara']);
  });

  it('offers everyone by name when nothing has been typed yet', () => {
    expect(usernames(matchPeople(people, ''))).toEqual(['muqadim', 'lisara', 'nadia', 'omar', 'sara', 'sarah.lee']);
    expect(usernames(matchPeople(people, '@', ['muqadim']))).toEqual(['lisara', 'nadia', 'omar', 'sara', 'sarah.lee']);
  });

  it('stops at the limit it is given', () => {
    expect(usernames(matchPeople(people, 'sara', [], 2))).toEqual(['sara', 'sarah.lee']);
    expect(matchPeople(people, '', [], 3)).toHaveLength(3);
  });

  it('offers nobody for something nobody matches', () => {
    expect(matchPeople(people, 'zzz')).toEqual([]);
    expect(matchPeople([], 'sara')).toEqual([]);
  });
});

/* ------------------------------------------------------------ assignments */

describe('setting who is on a ticket', () => {
  it('puts each person on once, stamped with who did it and when', () => {
    expect(nextAssignments(undefined, ['@Sara', 'muqadim', 'sara', ' '], 'nadia', T1)).toEqual([
      { user: 'sara', by: 'nadia', at: T1 },
      { user: 'muqadim', by: 'nadia', at: T1 }
    ]);
  });

  it('keeps who assigned someone already on it and when, so saving the list again raises no new notification', () => {
    const current: Assignment[] = [{ user: 'sara', by: 'nadia', at: T1 }];
    const next = nextAssignments(current, ['muqadim', 'Sara'], 'omar', T2);
    /* the order is the new list's; sara's stamp is still nadia's from T1, not omar's */
    expect(next).toEqual([
      { user: 'muqadim', by: 'omar', at: T2 },
      { user: 'sara', by: 'nadia', at: T1 }
    ]);
  });

  it('takes off whoever the new list leaves out', () => {
    const current: Assignment[] = [
      { user: 'sara', by: 'nadia', at: T1 },
      { user: 'muqadim', by: 'nadia', at: T1 }
    ];
    expect(nextAssignments(current, ['muqadim'], 'omar', T2)).toEqual([{ user: 'muqadim', by: 'nadia', at: T1 }]);
    expect(nextAssignments(current, [], 'omar', T2)).toEqual([]);
  });

  it('lists the usernames on a ticket, in order', () => {
    expect(assignedUsers(nextAssignments(undefined, ['omar', 'sara'], 'nadia', T1))).toEqual(['omar', 'sara']);
    expect(assignedUsers(undefined)).toEqual([]);
  });
});

describe('whether a new list changes anything', () => {
  const on: Assignment[] = [
    { user: 'sara', by: 'nadia', at: T1 },
    { user: 'muqadim', by: 'nadia', at: T1 }
  ];

  it('is the same list when the same people come in the same order, however they were typed', () => {
    expect(sameAssignees(on, ['@Sara', 'MUQADIM'])).toBe(true);
    expect(sameAssignees(on, ['sara', 'sara', 'muqadim', ''])).toBe(true);
    expect(sameAssignees(undefined, [])).toBe(true);
    expect(sameAssignees([], [' '])).toBe(true);
  });

  it('is a change when someone comes, goes or moves', () => {
    expect(sameAssignees(on, ['sara'])).toBe(false);
    expect(sameAssignees(on, ['sara', 'muqadim', 'omar'])).toBe(false);
    expect(sameAssignees(on, ['muqadim', 'sara'])).toBe(false);
    expect(sameAssignees(undefined, ['sara'])).toBe(false);
  });
});

/* ------------------------------------------------------------ the sheet */

describe('who is on a ticket, as the sheet holds it', () => {
  const detail = JSON.stringify([
    { user: 'muqadim', by: 'nadia', at: T1 },
    { user: 'sara', by: 'admin', at: T2 }
  ]);

  it('writes a readable column and the JSON of who assigned each and when', () => {
    const list: Assignment[] = [
      { user: 'muqadim', by: 'nadia', at: T1 },
      { user: 'sara', by: 'admin', at: T2 }
    ];
    expect(assignedLabel(list)).toBe('@muqadim, @sara');
    expect(assignedDetail(list)).toBe(detail);
    /* nobody on it is two blank cells, not "[]" */
    expect(assignedLabel(undefined)).toBe('');
    expect(assignedDetail([])).toBe('');
  });

  it('reads back what it wrote, stamps and all', () => {
    expect(readAssigned('@muqadim, @sara', detail)).toEqual([
      { user: 'muqadim', by: 'nadia', at: T1 },
      { user: 'sara', by: 'admin', at: T2 }
    ]);
  });

  it('assigns a name typed into the column by hand, with no one to say who did it or when', () => {
    expect(readAssigned('@muqadim, @sara, @Omar', detail)).toEqual([
      { user: 'muqadim', by: 'nadia', at: T1 },
      { user: 'sara', by: 'admin', at: T2 },
      { user: 'omar', by: '', at: '' }
    ]);
    /* the @ is optional, the way a person types it */
    expect(readAssigned('omar', '')).toEqual([{ user: 'omar', by: '', at: '' }]);
  });

  it('unassigns a name deleted from the column, even though the JSON beside it still lists them', () => {
    /* the column is what a person edits; the JSON only remembers stamps */
    expect(readAssigned('@sara', detail)).toEqual([{ user: 'sara', by: 'admin', at: T2 }]);
    expect(readAssigned('', detail)).toEqual([]);
    expect(readAssigned(undefined, detail)).toEqual([]);
  });

  it('follows the order of the column, and takes the stamps of whoever it names', () => {
    expect(readAssigned('@Sara @muqadim', detail)).toEqual([
      { user: 'sara', by: 'admin', at: T2 },
      { user: 'muqadim', by: 'nadia', at: T1 }
    ]);
  });

  it('reads commas, semicolons and spaces as separators, and a name twice as one person', () => {
    expect(readAssigned('@omar;@sara  ,@omar  sara', '').map((one) => one.user)).toEqual(['omar', 'sara']);
  });

  it('ignores a word that could not be a username', () => {
    /* "muqadim!" could never have been created, so it is not taken for anyone, and a phrase with no
       @ in it names nobody at all */
    expect(readAssigned('muqadim!', '')).toEqual([]);
    expect(readAssigned('Abdul Muqadim!', '')).toEqual([]);
    expect(readAssigned('@s, -dash, ??, @@', '')).toEqual([]);
  });

  it('never reads a display name typed there as two people', () => {
    /* "Sara Khan" typed into the column used to assign @sara and @khan, since each word on its own
       is a valid username: two strangers put on a ticket, and one of them possibly real */
    expect(readAssigned('Sara Khan', '')).toEqual([]);
    expect(readAssigned('Sara Khan, omar', '').map((one) => one.user)).toEqual(['omar']);
  });

  it('takes the @names out of a longer entry, and a lone word as a username', () => {
    expect(readAssigned('ask @sara and @omar', '').map((one) => one.user)).toEqual(['sara', 'omar']);
    expect(readAssigned('@sara @omar', '').map((one) => one.user)).toEqual(['sara', 'omar']);
    expect(readAssigned('sara; omar\nlina', '').map((one) => one.user)).toEqual(['sara', 'omar', 'lina']);
  });

  it('takes the JSON already parsed, the way a request carries it inside extraJson', () => {
    expect(readAssigned('@muqadim', [{ user: 'muqadim', by: 'nadia', at: T1 }])).toEqual([{ user: 'muqadim', by: 'nadia', at: T1 }]);
  });

  it('survives JSON that is broken or holds the wrong things, keeping the column', () => {
    expect(readAssigned('@sara', '{"half written')).toEqual([{ user: 'sara', by: '', at: '' }]);
    expect(readAssigned('@sara', '{"user":"sara"}')).toEqual([{ user: 'sara', by: '', at: '' }]);
    expect(readAssigned('@sara', [null, 'sara', 7, { user: 'sara', by: 42, at: false }])).toEqual([{ user: 'sara', by: '', at: '' }]);
  });

  it('keeps the first stamp when the JSON lists someone twice', () => {
    const twice = JSON.stringify([
      { user: 'sara', by: 'nadia', at: T1 },
      { user: 'Sara', by: 'omar', at: T2 }
    ]);
    expect(readAssigned('@sara', twice)).toEqual([{ user: 'sara', by: 'nadia', at: T1 }]);
  });
});

describe('who did something, from a JSON column', () => {
  it('reads who and when, the name read as a username', () => {
    expect(readEvent({ by: '@Nadia', at: T1 })).toEqual({ by: 'nadia', at: T1 });
  });

  it('keeps an event with only one of the two', () => {
    expect(readEvent({ at: T1 })).toEqual({ by: '', at: T1 });
    expect(readEvent({ by: 'nadia' })).toEqual({ by: 'nadia', at: '' });
  });

  it('reads anything else as no event at all', () => {
    for (const value of [undefined, null, '', 'nadia', 42, true, {}, { by: '', at: '' }, { at: 7 }]) {
      expect(readEvent(value)).toBeUndefined();
    }
  });
});
