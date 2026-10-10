/**
 * Exposes the visible viewport height as `--app-height`, so the fixed chat bar
 * stays above the on-screen keyboard (iOS Safari doesn't resize the layout
 * viewport when the keyboard opens).
 */
export function trackVisualViewport(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const update = () => {
    const height = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--app-height', `${height}px`);
    // iOS scrolls the page up when focusing an input near the bottom; undo it.
    if (vv && vv.offsetTop > 0) window.scrollTo(0, 0);
  };
  update();
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
}
