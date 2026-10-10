import { useRef } from 'react';

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;

/**
 * Pointer handlers that call onLongPress after a press-and-hold, or onTap for
 * a short press. Moving (e.g. scrolling) cancels both.
 */
export function useLongPress(onLongPress: () => void, onTap?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        start.current = null;
        navigator.vibrate?.(10);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: () => {
      const wasPressing = start.current !== null;
      cancel();
      if (wasPressing && !fired.current) onTap?.();
    },
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      // Desktop right-click and Android long-press open our menu instead.
      e.preventDefault();
      if (!fired.current) {
        cancel();
        fired.current = true;
        onLongPress();
      }
    },
  };
}
