import { useEffect, useState } from 'react';
import { getBlob } from '../storage/db';

/** Resolves persisted assets without leaking object URLs or showing stale images. */
export function useBlobUrl(key?: string): string | undefined {
  const [asset, setAsset] = useState<{ key: string; url: string }>();
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    if (key) void getBlob(key).then((blob) => {
      if (active && blob) {
        url = URL.createObjectURL(blob);
        setAsset({ key, url });
      }
    }).catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [key]);
  return asset && asset.key === key ? asset.url : undefined;
}
