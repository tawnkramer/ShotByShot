import '@fontsource/comic-neue/latin-400.css';
import '@fontsource/comic-neue/latin-400-italic.css';
import '@fontsource/comic-neue/latin-700.css';
import '@fontsource/comic-neue/latin-700-italic.css';
import '@fontsource/bangers/latin-400.css';
import '@fontsource/permanent-marker/latin-400.css';
import '@fontsource/architects-daughter/latin-400.css';
import '@fontsource/covered-by-your-grace/latin-400.css';
import { deleteSetting, getBlob, getSetting, putBlob, setSetting } from '../storage/db';
import { hashKey } from '../util/hash';
import { DEFAULT_FONT } from './model';

/**
 * Lettering fonts. Free (SIL OFL) fonts ship with the app. Commercial
 * lettering fonts, like Comicraft's Wild Words, can't be published with
 * the site, so each user adds their own licensed copy in Settings; it stays
 * in this browser (IndexedDB) and is never written into project files.
 */

export const BUILTIN_FONTS = [
  { family: 'Comic Neue', label: 'Comic Neue' },
  { family: 'Bangers', label: 'Bangers (action)' },
  { family: 'Permanent Marker', label: 'Permanent Marker' },
  { family: 'Architects Daughter', label: 'Architects Daughter (handwritten)' },
  { family: 'Covered By Your Grace', label: 'Covered By Your Grace (casual)' },
] as const;

export const USER_FONTS_SETTING = 'lettering-fonts';

export interface UserFont { family: string; blob: string; fileName: string; addedAt: number }

export async function listUserFonts(): Promise<UserFont[]> {
  return (await getSetting<UserFont[]>(USER_FONTS_SETTING)) ?? [];
}

/** The font new lettering uses when the project hasn't chosen one: the first added font, else Comic Neue. */
export async function defaultLetteringFont(): Promise<string> {
  return (await listUserFonts())[0]?.family ?? DEFAULT_FONT;
}

export async function addUserFont(file: File): Promise<UserFont> {
  const data = await file.arrayBuffer();
  const family = fontFamilyName(data) ?? file.name.replace(/\.[^.]+$/, '');
  if (!family.trim()) throw new Error('This font has no name.');
  if (BUILTIN_FONTS.some((f) => f.family === family)) throw new Error(`${family} is already built in.`);
  // Checks the file is a font this browser can use before keeping it.
  await register(family, data);
  const blob = `font:${hashKey(`${family}|${file.name}|${data.byteLength}`)}`;
  await putBlob(blob, new Blob([data], { type: file.type || 'font/ttf' }));
  const font: UserFont = { family, blob, fileName: file.name, addedAt: Date.now() };
  const fonts = (await listUserFonts()).filter((f) => f.family !== family);
  await setSetting(USER_FONTS_SETTING, [...fonts, font]);
  return font;
}

export async function removeUserFont(family: string): Promise<void> {
  const fonts = (await listUserFonts()).filter((f) => f.family !== family);
  if (fonts.length) await setSetting(USER_FONTS_SETTING, fonts);
  else await deleteSetting(USER_FONTS_SETTING);
  const face = registered.get(family);
  if (face) document.fonts?.delete(face);
  registered.delete(family);
}

const registered = new Map<string, FontFace>();

async function register(family: string, data: ArrayBuffer): Promise<void> {
  if (registered.has(family) || typeof FontFace === 'undefined') return;
  // Font data rather than a blob: URL, so the page's font-src policy needn't allow blob:.
  const face = new FontFace(family, data);
  await face.load();
  document.fonts?.add(face);
  registered.set(family, face);
}

/** Makes the user's fonts available to canvas text. Safe to call often. */
export async function registerUserFonts(): Promise<void> {
  for (const font of await listUserFonts()) {
    if (registered.has(font.family)) continue;
    const blob = await getBlob(font.blob);
    if (blob) await register(font.family, await blob.arrayBuffer()).catch(() => {});
  }
}

/**
 * Waits until the given families can be measured. Canvas text silently uses
 * a fallback until a font has loaded, which would wrap lines wrongly.
 */
export async function ensureFonts(families: Iterable<string>): Promise<void> {
  await registerUserFonts().catch(() => {});
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts?.load) return;
  const loads: Promise<unknown>[] = [];
  for (const family of new Set(families)) {
    const name = `"${family.replace(/["\\]/g, '')}"`;
    loads.push(fonts.load(`16px ${name}`, 'Ag'), fonts.load(`bold 16px ${name}`, 'Ag'));
  }
  await Promise.allSettled(loads);
}

/**
 * The family name inside a TrueType/OpenType file (name table: typographic
 * family, else family), or undefined if it can't be read.
 */
export function fontFamilyName(data: ArrayBuffer): string | undefined {
  try {
    const view = new DataView(data);
    const tables = view.getUint16(4);
    let nameOffset = -1;
    for (let i = 0; i < tables; i++) {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
      if (tag === 'name') nameOffset = view.getUint32(rec + 8);
    }
    if (nameOffset < 0) return undefined;
    const count = view.getUint16(nameOffset + 2);
    const strings = nameOffset + view.getUint16(nameOffset + 4);
    const found = new Map<number, string>();
    for (let i = 0; i < count; i++) {
      const rec = nameOffset + 6 + i * 12;
      const platform = view.getUint16(rec), nameId = view.getUint16(rec + 6);
      const length = view.getUint16(rec + 8), offset = strings + view.getUint16(rec + 10);
      if (nameId !== 1 && nameId !== 16) continue;
      let text = '';
      if (platform === 0 || platform === 3) {
        for (let k = 0; k + 1 < length; k += 2) text += String.fromCharCode(view.getUint16(offset + k));
        found.set(nameId, text);
      } else if (platform === 1 && !found.has(nameId)) {
        for (let k = 0; k < length; k++) text += String.fromCharCode(view.getUint8(offset + k));
        found.set(nameId, text);
      }
    }
    const name = (found.get(16) ?? found.get(1))?.trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}
