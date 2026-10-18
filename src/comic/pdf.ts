/**
 * A minimal PDF with one JPEG image per page, filling the page. Images are
 * embedded as-is (DCTDecode), so no re-encoding and no PDF library.
 */
export interface PdfImage { jpeg: Uint8Array; width: number; height: number }

/** Page width in points (8.5 in); height follows each image's shape. */
const PAGE_W = 612;

export function buildPdf(images: PdfImage[], title = ''): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  // Objects: 1 catalog, 2 pages, 3 info, then per image: page, contents, image.
  const object = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };
  const pageIds = images.map((_, i) => 4 + i * 3);
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${images.length} >>`));
  object(3, () => push(`<< /Title (${title.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '')}) /Producer (ShotByShot) >>`));
  images.forEach((img, i) => {
    const page = pageIds[i], contents = page + 1, image = page + 2;
    const w = PAGE_W, h = Math.round((PAGE_W * img.height) / img.width * 100) / 100;
    object(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${image} 0 R >> >> /Contents ${contents} 0 R >>`));
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    object(contents, () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
    object(image, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`);
      push(img.jpeg);
      push('\nendstream');
    });
  });
  const count = 4 + images.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
