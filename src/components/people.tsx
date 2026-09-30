import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Assignment, Person } from '@/types';
import { useApp } from '@/state/AppProvider';
import { ADMIN_USER, assignedUsers, initials, matchPeople, normalUsername, personName, roleLabel } from '@/domain/people';
import { color, font, personStyle, radius } from '@/theme';
import { useFocus, useHover } from '@/lib/useHover';
import { useRowHover } from '@/components/ui';
import { Floating } from '@/components/Floating';

/**
 * Who is on a ticket, and the two ways to change it: a list to tick on a card, and an @ field in a
 * form. Both write through `setAssignees` (or the filing form's `assign`), and both take their people
 * from the store's list (`state.people`), never from anything typed that matches no one.
 */

/** Why nobody can be put on the demo's deal or requests. */
export const DEMO_ASSIGN = 'The demo is never saved, so nobody would be told. Assign people on a real deal.';

const known = (people: readonly Person[], username: string): boolean => username === ADMIN_USER || people.some((one) => one.username === username);

export function Avatar({ username, size = 22, people, ring }: { username: string; size?: number; people: readonly Person[]; ring?: string }): JSX.Element {
  const name = personName(people, username);
  const here = known(people, username);
  const tone = personStyle(username);
  return (
    <span
      role="img"
      aria-label={name}
      title={here ? `${name} (@${username})` : `@${username} is no longer a user`}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: here ? tone.bg : color.surfaceMuted,
        color: here ? tone.co : color.faint,
        fontFamily: font.body,
        fontSize: Math.round(size * 0.4),
        fontWeight: 700,
        letterSpacing: 0.2,
        lineHeight: 1,
        boxShadow: `0 0 0 2px ${ring ?? color.surface}`,
        userSelect: 'none'
      }}
    >
      {initials(name)}
    </span>
  );
}

/** Overlapping avatars, the first few, then how many more. */
export function AvatarStack({ users, people, max = 3, size = 22 }: { users: readonly string[]; people: readonly Person[]; max?: number; size?: number }): JSX.Element {
  const shown = users.slice(0, max);
  const more = users.length - shown.length;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((user, index) => (
        <span key={user} style={{ marginLeft: index === 0 ? 0 : -6, display: 'inline-flex' }}>
          <Avatar username={user} people={people} size={size} />
        </span>
      ))}
      {more > 0 ? (
        <span
          title={users.slice(max).map((user) => personName(people, user)).join(', ')}
          style={{
            marginLeft: -6,
            minWidth: size,
            height: size,
            padding: '0 5px',
            boxSizing: 'border-box',
            borderRadius: radius.pill,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: color.surfaceMuted,
            color: color.muted,
            fontSize: Math.round(size * 0.42),
            fontWeight: 700,
            boxShadow: `0 0 0 2px ${color.surface}`
          }}
        >
          +{more}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------ the list to tick */

function PersonRow({
  person,
  on,
  active,
  gone,
  people,
  id,
  onToggle,
  onHover
}: {
  person: Person;
  on: boolean;
  active: boolean;
  gone?: boolean;
  people: readonly Person[];
  id: string;
  onToggle: () => void;
  onHover: () => void;
}): JSX.Element {
  const hover = useRowHover({ background: color.surfaceMuted });
  return (
    <div
      id={id}
      role="option"
      aria-selected={on}
      {...hover.bind}
      onMouseEnter={() => {
        hover.bind.onMouseEnter();
        onHover();
      }}
      /* mousedown, not click, and no default: the search box keeps focus, so typing goes on */
      onMouseDown={(event) => {
        event.preventDefault();
        onToggle();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '7px 10px',
        borderRadius: radius.sm,
        cursor: 'pointer',
        background: active ? color.surfaceMuted : 'transparent',
        transition: 'background 100ms ease',
        ...(active ? {} : hover.style)
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 16,
          height: 16,
          flex: '0 0 16px',
          borderRadius: 4,
          borderWidth: 1.5,
          borderStyle: 'solid',
          borderColor: on ? color.brand : color.rule,
          background: on ? color.brand : color.surface,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: color.onSolid,
          fontSize: 10,
          fontWeight: 700
        }}
      >
        {on ? '✓' : ''}
      </span>
      <Avatar username={person.username} people={people} size={24} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: gone ? color.faint : color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {gone ? `@${person.username}` : person.name}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: color.faint }}>{gone ? 'No longer a user' : `@${person.username} · ${roleLabel(person.role)}`}</span>
      </span>
    </div>
  );
}

/**
 * Everyone who can be put on a ticket, to tick. Typing narrows it, with or without the @. Arrow keys
 * move, Enter ticks, Escape closes. Someone on the ticket who is no longer a user is listed too, so
 * they can be taken off.
 */
export function PeopleMenu({
  value,
  onChange,
  title,
  note
}: {
  value: readonly string[];
  onChange: (users: string[]) => void;
  title: string;
  note?: ReactNode;
}): JSX.Element {
  const { state } = useApp();
  const people = state.people;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const focus = useFocus();
  const listId = useId();

  const rows = useMemo(() => {
    const gone: Person[] = value.filter((user) => !known(people, user)).map((user) => ({ username: user, name: `@${user}`, role: 'sales' }));
    if (query.trim()) return matchPeople([...people, ...gone], query, [], 50);
    /* who is on it first, so taking someone off never means scrolling for them */
    const picked = value.map((user) => people.find((one) => one.username === user) ?? gone.find((one) => one.username === user)).filter((one): one is Person => Boolean(one));
    return [...picked, ...matchPeople(people, '', value, 200)];
  }, [people, query, value]);

  const toggle = (user: string): void => onChange(value.includes(user) ? value.filter((one) => one !== user) : [...value, user]);
  const at = Math.min(active, Math.max(0, rows.length - 1));

  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length === 0) return;
      setActive((at + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[at];
      if (row) toggle(row.username);
    }
  };

  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: color.muted, padding: '2px 4px 8px' }}>{title}</div>
      {/* focused by `Floating` once the panel is placed */}
      <input
        value={query}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={rows[at] ? `${listId}-${at}` : undefined}
        aria-label="Find someone by name or @username"
        placeholder="Type @ and a name"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKey}
        {...focus.bind}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: focus.on ? color.brand : color.rule,
          borderRadius: radius.md,
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: font.body,
          color: color.ink,
          background: color.surfaceSoft,
          outline: 'none',
          boxShadow: focus.on ? `0 0 0 3px ${color.focusRing}` : 'none'
        }}
      />
      <div id={listId} role="listbox" aria-multiselectable="true" aria-label={title} style={{ marginTop: 6 }}>
        {rows.map((person, index) => (
          <PersonRow
            key={person.username}
            id={`${listId}-${index}`}
            person={person}
            people={people}
            gone={!known(people, person.username)}
            on={value.includes(person.username)}
            active={index === at}
            onToggle={() => toggle(person.username)}
            onHover={() => setActive(index)}
          />
        ))}
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: color.faint, lineHeight: 1.5, padding: '10px 8px' }}>
            {people.length === 0 ? 'No users yet. The admin adds people in the admin panel.' : `No one matches “${query.trim()}”.`}
          </div>
        ) : null}
      </div>
      {note ? <div style={{ fontSize: 11, color: color.faint, lineHeight: 1.5, padding: '8px 4px 2px', borderTop: `1px solid ${color.hairlineSoft}`, marginTop: 6 }}>{note}</div> : null}
    </div>
  );
}

/**
 * The people on a deal or a request, and the button that opens `PeopleMenu` to change them. Each
 * tick is saved as it is made; the person ticked is told through their bell.
 */
export function AssignControl({
  ticket,
  id,
  assigned,
  disabledReason,
  size = 22,
  align = 'left'
}: {
  ticket: 'deal' | 'request';
  id: string;
  assigned: readonly Assignment[] | undefined;
  /** Set when nobody may be put on this ticket, saying why: the demo is never saved. */
  disabledReason?: string;
  size?: number;
  align?: 'left' | 'right';
}): JSX.Element {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const hover = useHover();
  const users = assignedUsers(assigned);
  const names = users.map((user) => personName(state.people, user)).join(', ');
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  const disabled = Boolean(disabledReason);

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={users.length > 0 ? `Assigned: ${names}. Change` : 'Assign people'}
        title={disabledReason ?? (users.length > 0 ? `${names}. Click to change` : 'Assign people to this')}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((was) => !was);
        }}
        /* the card around it opens on Enter; this key belongs to the button */
        onKeyDown={(event) => event.stopPropagation()}
        {...hover.bind}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          borderWidth: 1,
          borderStyle: users.length > 0 ? 'solid' : 'dashed',
          borderColor: open || (hover.on && !disabled) ? color.chevron : users.length > 0 ? 'transparent' : color.rule,
          background: open || (hover.on && !disabled) ? color.surfaceMuted : 'transparent',
          borderRadius: radius.pill,
          padding: users.length > 0 ? '2px 8px 2px 3px' : '3px 9px',
          fontFamily: font.body,
          fontSize: 11,
          fontWeight: 600,
          color: color.muted,
          whiteSpace: 'nowrap',
          transition: 'background 120ms ease, border-color 120ms ease'
        }}
      >
        {users.length > 0 ? <AvatarStack users={users} people={state.people} size={size} /> : <span aria-hidden="true">@</span>}
        <span>{users.length > 0 ? (open || hover.on ? 'Change' : users.length === 1 ? personName(state.people, users[0] ?? '').split(' ')[0] : `${users.length} people`) : 'Assign'}</span>
      </button>
      {open ? (
        <Floating anchor={button} onClose={close} width={300} align={align} label="Assign people">
          <PeopleMenu
            title={ticket === 'deal' ? 'People on this deal' : 'People on this request'}
            value={users}
            onChange={(next) => dispatch({ type: 'setAssignees', ticket, id, users: next })}
            note="Whoever you add is told in their notifications."
          />
        </Floating>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------ the @ field */

function Chip({ username, people, onRemove, disabled }: { username: string; people: readonly Person[]; onRemove: () => void; disabled?: boolean }): JSX.Element {
  const hover = useHover();
  const name = personName(people, username);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: color.surface,
        border: `1px solid ${color.hairline}`,
        borderRadius: radius.pill,
        padding: '2px 4px 2px 2px',
        fontSize: 12,
        fontWeight: 600,
        color: color.ink,
        whiteSpace: 'nowrap'
      }}
    >
      <Avatar username={username} people={people} size={20} />
      {name}
      {disabled ? null : (
        <button
          type="button"
          aria-label={`Take ${name} off`}
          title={`Take ${name} off`}
          onClick={onRemove}
          {...hover.bind}
          style={{
            border: 'none',
            cursor: 'pointer',
            background: hover.on ? color.surfaceMuted : 'transparent',
            color: hover.on ? color.ink : color.faint,
            borderRadius: '50%',
            width: 18,
            height: 18,
            padding: 0,
            fontSize: 13,
            lineHeight: 1
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

/**
 * Type @ and a name, and pick from the list; each pick becomes a chip. Enter or Tab takes the
 * highlighted name, Backspace in an empty field takes the last chip off, Escape closes the list.
 * Only people on the store's list can be picked, so a typo never assigns nobody.
 */
export function MentionField({
  label,
  value,
  onChange,
  hint,
  disabledReason
}: {
  label: string;
  value: readonly string[];
  onChange: (users: string[]) => void;
  hint?: string;
  disabledReason?: string;
}): JSX.Element {
  const { state } = useApp();
  const people = state.people;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const focus = useFocus();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const disabled = Boolean(disabledReason);

  const options = useMemo(() => matchPeople(people, query, value, 8), [people, query, value]);
  const showing = open && !disabled && (query.trim() !== '' || focus.on);
  const at = Math.min(active, Math.max(0, options.length - 1));

  const pick = (username: string): void => {
    onChange([...value, username]);
    setQuery('');
    setActive(0);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace' && query === '' && value.length > 0) {
      onChange(value.slice(0, -1));
      return;
    }
    if (event.key === 'Escape') {
      if (showing) {
        event.preventDefault();
        /* the list closes; a modal around the field stays open */
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (options.length > 0) setActive((at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
      return;
    }
    /* a comma or a space after a whole username takes it, the way a mention does in chat */
    if ((event.key === ',' || event.key === ' ') && query.trim()) {
      const exact = people.find((one) => one.username === normalUsername(query) && !value.includes(one.username));
      if (exact) {
        event.preventDefault();
        pick(exact.username);
      }
      return;
    }
    if ((event.key === 'Enter' || (event.key === 'Tab' && query.trim())) && showing && options[at]) {
      event.preventDefault();
      pick(options[at].username);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span title={hint} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: color.muted }}>
        {label}
      </span>
      <div style={{ position: 'relative' }}>
        <div
          onMouseDown={(event) => {
            /* a click on the box, between chips, puts the cursor in the field */
            if (event.target === event.currentTarget) {
              event.preventDefault();
              input.current?.focus();
            }
          }}
          title={disabledReason}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 5,
            minHeight: 40,
            boxSizing: 'border-box',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: focus.on ? color.brand : color.rule,
            borderRadius: radius.md,
            padding: '5px 8px',
            background: disabled ? color.surfaceMuted : color.surfaceSoft,
            boxShadow: focus.on ? '0 0 0 3px rgba(0, 173, 144, 0.13)' : 'none',
            cursor: disabled ? 'not-allowed' : 'text'
          }}
        >
          {value.map((user) => (
            <Chip key={user} username={user} people={people} disabled={disabled} onRemove={() => onChange(value.filter((one) => one !== user))} />
          ))}
          <input
            ref={input}
            value={query}
            disabled={disabled}
            role="combobox"
            aria-expanded={showing}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showing && options[at] ? `${listId}-${at}` : undefined}
            aria-label={label}
            placeholder={disabled ? disabledReason : value.length > 0 ? 'Add someone' : people.length > 0 ? 'Type @ and a name' : 'No users yet'}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={onKey}
            onFocus={() => {
              focus.bind.onFocus();
              setOpen(true);
            }}
            onBlur={() => {
              focus.bind.onBlur();
              setOpen(false);
            }}
            style={{
              flex: '1 1 120px',
              minWidth: 100,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 13,
              fontFamily: font.body,
              color: color.ink,
              padding: '4px 2px',
              /* the field draws its own ring around the whole box */
              boxShadow: 'none'
            }}
          />
        </div>
        {showing ? (
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 30,
              background: color.surface,
              border: `1px solid ${color.hairline}`,
              borderRadius: radius.md,
              boxShadow: '0 12px 28px rgba(20, 20, 20, 0.14)',
              padding: 5,
              maxHeight: 260,
              overflowY: 'auto'
            }}
          >
            {options.map((person, index) => (
              <Suggestion key={person.username} id={`${listId}-${index}`} person={person} people={people} active={index === at} onPick={() => pick(person.username)} onHover={() => setActive(index)} />
            ))}
            {options.length === 0 ? (
              <div style={{ fontSize: 12, color: color.faint, padding: '8px 9px' }}>
                {people.length === 0
                  ? 'No users yet. The admin adds people in the admin panel.'
                  : query.trim()
                    ? `No one matches “${query.trim()}”.`
                    : 'Everyone is already on it.'}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Suggestion({ id, person, people, active, onPick, onHover }: { id: string; person: Person; people: readonly Person[]; active: boolean; onPick: () => void; onHover: () => void }): JSX.Element {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      /* mousedown with no default, so the field keeps focus and the list does not close first */
      onMouseDown={(event) => {
        event.preventDefault();
        onPick();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '6px 9px',
        borderRadius: radius.sm,
        cursor: 'pointer',
        background: active ? color.brandWash : 'transparent'
      }}
    >
      <Avatar username={person.username} people={people} size={24} />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: color.ink }}>{person.name}</span>
      <span style={{ fontSize: 11.5, color: color.faint }}>@{person.username}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 10.5, fontWeight: 700, color: color.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{roleLabel(person.role)}</span>
    </div>
  );
}
