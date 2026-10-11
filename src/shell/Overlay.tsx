import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders sheets, menus and their scrims at the top of the document. On iOS a
 * fixed element inside a scrolling area can end up layered under the chat bar
 * (and clipped), so overlays live outside the app's layout entirely.
 */
export function Overlay({ children }: { children: ReactNode }) {
  return createPortal(<div className="overlay-root">{children}</div>, document.body);
}
