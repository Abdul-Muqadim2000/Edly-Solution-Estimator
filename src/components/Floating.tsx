import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { color, radius, shadow } from '@/theme';

/**
 * A panel under a button, drawn over the page. Portalled and fixed, the way `StagePicker`'s menu
 * is, because the cards it opens from clip what overflows them. It closes on a click outside, on
 * Escape (focus goes back to the button), and when the page scrolls or the window resizes, since
 * a fixed panel would otherwise stay put while its button moved away.
 *
 * Clicks and keys inside it stop here: React sends a portal's events up through the component
 * tree, so without that a click in the panel would also press the card the button sits in.
 */
export function Floating({
  anchor,
  onClose,
  width = 320,
  align = 'left',
  label,
  children
}: {
  anchor: RefObject<HTMLElement>;
  onClose: (refocus: boolean) => void;
  width?: number;
  /** Which edge of the button the panel lines up with. */
  align?: 'left' | 'right';
  /** What the panel is to a screen reader. */
  label: string;
  children: ReactNode;
}): JSX.Element | null {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  /* Measured before it paints, and again whenever it changes size, because typing in it filters a
     list: below the button, above it when below runs off the window and above does not. Set only
     when it moved, so measuring cannot loop. */
  useLayoutEffect(() => {
    if (!panel) return;
    const measure = (): void => {
      const button = anchor.current?.getBoundingClientRect();
      if (!button) return;
      const height = panel.offsetHeight;
      const room = window.innerHeight - 8;
      const below = button.bottom + 8;
      const above = button.top - height - 8;
      const top = below + height <= room ? below : above >= 8 ? above : Math.max(8, room - height);
      const wanted = align === 'right' ? button.right - panel.offsetWidth : button.left;
      const left = Math.max(8, Math.min(wanted, window.innerWidth - panel.offsetWidth - 8));
      setPlace((was) => (was && was.top === top && was.left === left ? was : { top, left }));
    };
    measure();
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    watch?.observe(panel);
    return () => watch?.disconnect();
  }, [anchor, panel, align]);

  /* Focus goes in once it is placed, not before: a panel still hidden for measuring cannot take it,
     so `autoFocus` inside it did nothing, and typing and Escape went to the page instead. */
  const placed = Boolean(place);
  useEffect(() => {
    if (!placed || !panel || panel.contains(document.activeElement)) return;
    panel.querySelector<HTMLElement>('input, button, [tabindex="0"]')?.focus({ preventScroll: true });
  }, [placed, panel]);

  useEffect(() => {
    const outside = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && (panel?.contains(target) || anchor.current?.contains(target))) return;
      onClose(false);
    };
    const scrolled = (event: Event): void => {
      if (panel?.contains(event.target as Node)) return;
      onClose(false);
    };
    const resized = (): void => onClose(false);
    document.addEventListener('mousedown', outside);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', resized);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', resized);
    };
  }, [anchor, panel, onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={setPanel}
      role="dialog"
      aria-label={label}
      data-scroll="1"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose(true);
        }
      }}
      style={{
        position: 'fixed',
        top: place?.top ?? 0,
        left: place?.left ?? 0,
        visibility: place ? 'visible' : 'hidden',
        width,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'min(560px, calc(100vh - 24px))',
        overflowY: 'auto',
        background: color.surface,
        border: `1px solid ${color.hairline}`,
        borderRadius: radius.lg,
        boxShadow: shadow.pop,
        zIndex: 700
      }}
    >
      {children}
    </div>,
    document.body
  );
}
