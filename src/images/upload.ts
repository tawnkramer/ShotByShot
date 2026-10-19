/** Model name recorded for images the user uploaded rather than generated. */
export const UPLOAD_MODEL = 'upload';

/** Uploads are kept at most this many pixels on the long side, to spare browser storage. */
export const MAX_UPLOAD_SIDE = 2048;

const KEEP_AS_IS = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Readies a picked image file to be used as artwork: checks it's an image
 * this browser can open, and scales big photos down to MAX_UPLOAD_SIDE
 * (JPEG, or PNG for PNGs so transparency survives). Small JPEG, PNG and
 * WebP files are kept unchanged.
 */
export async function prepareUpload(file: Blob, maxSide = MAX_UPLOAD_SIDE): Promise<Blob> {
  if (file.type && !file.type.startsWith('image/')) throw new Error("That file isn't an image.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser can't open that image. Try a JPEG or PNG.");
  }
  const long = Math.max(bitmap.width, bitmap.height);
  if (long <= maxSide && KEEP_AS_IS.has(file.type)) {
    bitmap.close?.();
    return file;
  }
  const scale = Math.min(1, maxSide / long);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("This browser can't resize images.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!out) throw new Error('Could not read that image.');
  return out;
}
