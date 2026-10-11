const KEY = 'sbs-recover-reload';

/**
 * Reloads to pick up the current version, at most once a minute so an error
 * that a reload can't fix doesn't cause a loop. Returns false if it didn't.
 */
export function reloadOnce(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/** True for errors from loading a code chunk that an older deploy referenced and the server no longer has. */
export function isChunkError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Unable to preload/i.test(msg);
}
