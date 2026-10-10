import type { LineType } from '../../state/schema';

export const LINE_TYPE_INFO: Record<LineType, { label: string; short: string }> = {
  action: { label: 'Action', short: 'Action' },
  dialogue: { label: 'Dialogue', short: 'Dialog' },
  character: { label: 'Character', short: 'Char' },
  scene: { label: 'Scene', short: 'Scene' },
  camera: { label: 'Camera', short: 'Camera' },
  title: { label: 'Title', short: 'Title' },
  description: { label: 'Description', short: 'Desc' },
};

/** Order used when tapping a chip to cycle types. */
export const CYCLE: LineType[] = ['action', 'dialogue', 'character', 'scene', 'camera', 'title', 'description'];

export function nextType(t: LineType): LineType {
  return CYCLE[(CYCLE.indexOf(t) + 1) % CYCLE.length];
}
