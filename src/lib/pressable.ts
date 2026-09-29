import type { KeyboardEvent } from 'react';

export interface Pressable {
  role: 'button';
  tabIndex: 0;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * What a clickable div needs to be a button to the keyboard and to a screen reader: a place in
 * the tab order, the role, and Enter or Space to press it. The practice cards, the platform rows
 * and the switcher were divs with only a click, so a keyboard user could not pick a platform at
 * all. A key pressed in something inside it, a field or a button, is left to that element.
 */
export function pressable(onPress: () => void): Pressable {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      /* Space would otherwise scroll the page as well */
      event.preventDefault();
      onPress();
    }
  };
}
