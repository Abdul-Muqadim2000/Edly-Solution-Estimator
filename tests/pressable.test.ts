import { describe, expect, it } from 'vitest';
import { pressable } from '../src/lib/pressable';

describe('pressing a clickable card from the keyboard', () => {
  const press = (key: string, fromInside = false) => {
    let pressed = 0;
    let prevented = false;
    const card = {};
    const handlers = pressable(() => (pressed += 1));
    handlers.onKeyDown({ key, target: fromInside ? {} : card, currentTarget: card, preventDefault: () => (prevented = true) } as never);
    return { pressed, prevented };
  };

  it('is a button in the tab order', () => {
    const handlers = pressable(() => undefined);
    expect(handlers.role).toBe('button');
    expect(handlers.tabIndex).toBe(0);
  });

  it('presses on Enter and on Space, and stops Space scrolling the page', () => {
    expect(press('Enter')).toEqual({ pressed: 1, prevented: true });
    expect(press(' ')).toEqual({ pressed: 1, prevented: true });
  });

  it('ignores other keys, and keys meant for a field or button inside it', () => {
    expect(press('a')).toEqual({ pressed: 0, prevented: false });
    expect(press('Tab')).toEqual({ pressed: 0, prevented: false });
    /* a hub card holds a status menu and a date field; typing in them must not open the deal */
    expect(press('Enter', true)).toEqual({ pressed: 0, prevented: false });
  });

  it('still presses on a click', () => {
    let pressed = 0;
    pressable(() => (pressed += 1)).onClick();
    expect(pressed).toBe(1);
  });
});
