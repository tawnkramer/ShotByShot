import { useEffect, useState } from 'react';
import { useBlobUrl } from '../images/useBlobUrl';
import { renderShotThumbnail } from '../shots/thumbnail';
import type { Project, Shot } from '../state/schema';
import { useLetteredUrl } from './preview';

/**
 * A panel as a reader sees it: its image (or the previs frame until it has
 * one) with its lettering drawn on. `visible` delays rendering previs
 * frames until the panel is on screen.
 */
export function usePanelPicture(project: Project, shot: Shot, visible = true, maxWidth = 960): { url?: string; artwork: boolean } {
  const artwork = useBlobUrl(shot.image?.blob);
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || artwork) return;
    let cancelled = false;
    void renderShotThumbnail(project, shot.id).then((u) => !cancelled && u && setThumb(u));
    return () => { cancelled = true; };
  }, [visible, project, shot.id, artwork]);
  const url = useLetteredUrl(artwork || thumb || undefined, shot.lettering, project.lettering, maxWidth);
  return { url, artwork: Boolean(artwork) };
}
