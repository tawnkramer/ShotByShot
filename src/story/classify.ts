import type { LineType } from '../state/schema';

export interface ClassifiedLine {
  text: string;
  type: LineType;
  /** 0..1. Lines below LOW_CONFIDENCE are highlighted for review. */
  confidence: number;
}

export const LOW_CONFIDENCE = 0.6;

const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)[.\s]/i;
export const TRANSITION_RE = /^(FADE (IN|OUT|TO)|CUT TO|SMASH CUT|MATCH CUT|JUMP CUT|DISSOLVE TO|WIPE TO|BACK TO)\b/i;
const CAMERA_RE =
  /^(CLOSE ON|CLOSE[- ]?UP|EXTREME CLOSE|ANGLE ON|REVERSE ANGLE|WIDE( SHOT| ANGLE)?|MEDIUM( SHOT)?|ESTABLISHING( SHOT)?|POV|PAN( TO)?|TRACKING( SHOT)?|INSERT|ECU|CU|MCU|MS|MWS|WS|EWS|OTS|OVER THE SHOULDER|AERIAL|ZOOM|DOLLY|CRANE|PUSH IN|PULL BACK|TWO[- ]SHOT|ON [A-Z])\b/;
/** "SAM: Hello there." or "Sam (V.O.): Hello." */
const INLINE_DIALOGUE_RE = /^([A-Z][A-Za-z0-9.'\- ]{0,30}?)(\s*\([^)]*\))?\s*:\s+(\S.*)$/;
const TITLE_KEY_RE = /^title\s*:/i;
const TITLE_PAGE_KEY_RE = /^(credit|author|authors|source|draft date|date|contact|copyright|notes)\s*:/i;
const PARENTHETICAL_RE = /^\(.*\)$/;

function letters(s: string): string {
  return s.replace(/\([^)]*\)/g, '').replace(/[^A-Za-z]/g, '');
}

function isAllCaps(s: string): boolean {
  const l = letters(s);
  return l.length > 0 && l === l.toUpperCase();
}

function looksLikeCue(s: string): boolean {
  const name = s.replace(/\([^)]*\)/g, '').replace(/\^$/, '').trim();
  return isAllCaps(s) && name.length > 0 && name.length <= 32 && name.split(/\s+/).length <= 4 && !/[.!?:]$/.test(name);
}

/**
 * Labels each non-blank line of a plain-text script. Uses screenplay / Fountain
 * conventions; the assistant refines the result later.
 */
export function classifyScript(text: string): ClassifiedLine[] {
  const raw = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const hasScenes = raw.some((l) => SCENE_RE.test(l.trim()) || /^\.[A-Za-z]/.test(l.trim()));
  const out: ClassifiedLine[] = [];
  let inDialogue = false;
  let seenBody = false; // anything past the title block
  let titleTaken = false;

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i].trim();
    if (!line) {
      inDialogue = false;
      continue;
    }
    const prevBlank = i === 0 || !raw[i - 1].trim();
    const nextLine = raw[i + 1]?.trim() ?? '';
    const push = (type: LineType, confidence: number, t = line) => out.push({ text: t, type, confidence });

    // Fountain forced elements.
    if (/^\.[A-Za-z]/.test(line)) {
      push('scene', 1, line.slice(1).trim());
      seenBody = true;
      inDialogue = false;
      continue;
    }
    if (line.startsWith('@')) {
      push('character', 1, line.slice(1).trim());
      inDialogue = true;
      seenBody = true;
      continue;
    }
    if (line.startsWith('>') && !line.endsWith('<')) {
      push('camera', 1, line.slice(1).trim());
      seenBody = true;
      inDialogue = false;
      continue;
    }
    if (line.startsWith('!')) {
      push('action', 1, line.slice(1).trim());
      seenBody = true;
      inDialogue = false;
      continue;
    }

    if (inDialogue) {
      push('dialogue', PARENTHETICAL_RE.test(line) ? 0.9 : 0.85);
      continue;
    }

    if (SCENE_RE.test(line)) {
      push('scene', 0.95);
      seenBody = true;
      continue;
    }

    // Title page: before the first scene heading of a script that has them.
    if (!seenBody) {
      if (TITLE_KEY_RE.test(line)) {
        push('title', 0.95);
        titleTaken = true;
        continue;
      }
      if (TITLE_PAGE_KEY_RE.test(line)) {
        push('description', 0.9);
        continue;
      }
      if (hasScenes && !CAMERA_RE.test(line) && !TRANSITION_RE.test(line)) {
        if (!titleTaken && line.length <= 60) {
          push('title', 0.7);
          titleTaken = true;
        } else {
          push('description', 0.6);
        }
        continue;
      }
    }

    if (TRANSITION_RE.test(line) || (isAllCaps(line) && /TO:$/.test(line))) {
      push('camera', 0.9);
      seenBody = true;
      continue;
    }
    if (CAMERA_RE.test(line) && (isAllCaps(line.split(/[.,;-]/)[0]) || line.length < 40)) {
      push('camera', 0.8);
      seenBody = true;
      continue;
    }

    const inline = INLINE_DIALOGUE_RE.exec(line);
    if (inline && inline[1].trim().split(/\s+/).length <= 3 && !TITLE_PAGE_KEY_RE.test(line)) {
      const name = (inline[1].trim() + (inline[2] ?? '')).toUpperCase();
      push('character', 0.8, name);
      push('dialogue', 0.8, inline[3].trim());
      seenBody = true;
      continue;
    }

    if (looksLikeCue(line) && nextLine) {
      // A cue needs dialogue directly after it. Without a blank line before
      // it, it's more likely an all-caps action beat ("BANG!").
      push('character', prevBlank ? 0.9 : 0.55);
      inDialogue = true;
      seenBody = true;
      continue;
    }

    push('action', isAllCaps(line) && line.length < 40 ? 0.5 : 0.85);
    seenBody = true;
  }
  return out;
}

/** The speaker for each dialogue line: the nearest preceding character cue. */
export function speakerOf(lines: { id: string; type: LineType; text: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  let current: string | undefined;
  for (const l of lines) {
    if (l.type === 'character') current = cueName(l.text);
    else if (l.type === 'dialogue' && current) map.set(l.id, current);
    else if (l.type !== 'dialogue') current = undefined;
  }
  return map;
}

/** "SAM (V.O.)" → "SAM" */
export function cueName(text: string): string {
  return text.replace(/\([^)]*\)/g, '').replace(/\^$/, '').trim().toUpperCase();
}

/** True for transitions such as "CUT TO:" or "FADE OUT." that sit between shots. */
export function isTransition(text: string): boolean {
  const t = text.trim();
  return TRANSITION_RE.test(t) || (isAllCaps(t) && /TO:$/.test(t));
}

/**
 * True when a camera line only directs the next shot ("ANGLE ON MAYA",
 * "CLOSE ON:"), as opposed to describing a shot itself ("CLOSE ON the
 * envelope. A police seal.").
 */
export function isCameraHeading(text: string): boolean {
  const t = text.trim();
  if (t.endsWith(':')) return true;
  return !/[.!?]\s+\S/.test(t) && t.split(/\s+/).length <= 4;
}
