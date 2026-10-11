declare const __APP_BUILD__: { commit: string; time: string };

/** Which build is running: the commit it was built from and when. */
export const BUILD = __APP_BUILD__;

export function buildLabel(): string {
  const d = new Date(BUILD.time);
  const when = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${BUILD.commit} · ${when}`;
}
