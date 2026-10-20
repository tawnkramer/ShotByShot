/**
 * Reads the 35 mm-equivalent focal length from a JPEG's EXIF data
 * (FocalLengthIn35mmFilm), if it has one. Phones write it; many other
 * cameras do too. Must be read from the original file: scaling an upload
 * drops EXIF.
 */
export async function readPhotoLens(file: Blob): Promise<number | undefined> {
  try {
    return lens35FromJpeg(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
  } catch {
    return undefined;
  }
}

const FOCAL_35 = 0xa405;
const EXIF_IFD = 0x8769;

export function lens35FromJpeg(bytes: Uint8Array): number | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1];
    // Start of scan: image data follows, no more headers.
    if (marker === 0xda) return undefined;
    const size = view.getUint16(at + 2);
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 10)) === 'Exif\0\0') return fromTiff(view, at + 10);
    at += 2 + size;
  }
  return undefined;
}

function fromTiff(view: DataView, tiff: number): number | undefined {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => view.getUint16(tiff + o, little);
  const u32 = (o: number) => view.getUint32(tiff + o, little);
  const tag = (ifd: number, id: number) => {
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === id) return e;
    }
    return undefined;
  };
  const exif = tag(u32(4), EXIF_IFD);
  if (exif === undefined) return undefined;
  const e = tag(u32(exif + 8), FOCAL_35);
  if (e === undefined) return undefined;
  const lens = u16(e + 8);
  return lens > 0 ? lens : undefined;
}
