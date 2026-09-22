import { useMemo, useState } from 'react';

/**
 * Hover and press state for inline-styled elements.
 *
 * React inline style objects cannot express `:hover`, and this codebase styles inline by design
 * (see ARCHITECTURE.md). So interactive elements track the state themselves. Prefer the `Button`,
 * `Card` and `Link` primitives, which already do this — reach for the hook directly only for a
 * bespoke clickable row.
 *
 *   const hover = useHover();
 *   <div {...hover.bind} style={{ ...base, ...(hover.on ? lifted : null) }} />
 */
export interface HoverState {
  on: boolean;
  down: boolean;
  bind: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onMouseDown: () => void;
    onMouseUp: () => void;
  };
}

export function useHover(): HoverState {
  const [on, setOn] = useState(false);
  const [down, setDown] = useState(false);

  const bind = useMemo(
    () => ({
      onMouseEnter: () => setOn(true),
      onMouseLeave: () => {
        setOn(false);
        setDown(false);
      },
      onMouseDown: () => setDown(true),
      onMouseUp: () => setDown(false)
    }),
    []
  );

  return { on, down, bind };
}

/** Focus state, for fields whose border should react. Same reasoning as useHover. */
export interface FocusState {
  on: boolean;
  bind: { onFocus: () => void; onBlur: () => void };
}

export function useFocus(): FocusState {
  const [on, setOn] = useState(false);
  const bind = useMemo(() => ({ onFocus: () => setOn(true), onBlur: () => setOn(false) }), []);
  return { on, bind };
}
