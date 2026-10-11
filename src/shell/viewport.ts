/**
 * Exposes the visible viewport height as `--app-height` while the on-screen
 * keyboard is open, so the fixed chat bar stays above it (iOS Safari doesn't
 * resize the layout viewport for the keyboard). Otherwise the app uses the
 * full screen height: iOS can report a stale, keyboard-sized height after the
 * keyboard closes, which left the bottom of the screen empty.
 */
export function trackVisualViewport(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const typing = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && !/^(button|checkbox|radio|range|file|color|submit|reset)$/i.test((el as HTMLInputElement).type);
  };
  const update = () => {
    if (vv && typing()) root.style.setProperty('--app-height', `${vv.height}px`);
    else root.style.removeProperty('--app-height');
    // iOS scrolls the page up when focusing an input near the bottom; undo it.
    if (vv && vv.offsetTop > 0) window.scrollTo(0, 0);
  };
  // The keyboard animates closed after focus leaves; check again once it has.
  const settle = () => {
    update();
    for (const ms of [100, 350, 700]) setTimeout(update, ms);
  };
  update();
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', settle);
  window.addEventListener('pageshow', settle);
  document.addEventListener('focusin', settle);
  document.addEventListener('focusout', settle);
  document.addEventListener('visibilitychange', settle);
}
