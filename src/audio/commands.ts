import type { Command } from '../state/commands';

export interface GeneratedClip {
  lineId: string;
  sig: string;
  blob: string;
  durationSec: number;
}

/** Saves generated clips and drops audio for lines that no longer exist. */
export function setDialogueAudio(clips: GeneratedClip[]): Command {
  return {
    label: clips.length === 1 ? 'Voice a line' : `Voice ${clips.length} lines`,
    apply: (d) => {
      for (const c of clips) d.audio[c.lineId] = { sig: c.sig, blob: c.blob, durationSec: c.durationSec };
      const lineIds = new Set(d.script.map((l) => l.id));
      for (const id of Object.keys(d.audio)) if (!lineIds.has(id)) delete d.audio[id];
    },
  };
}

export function clearDialogueAudio(): Command {
  return {
    label: 'Remove dialogue audio',
    apply: (d) => {
      d.audio = {};
    },
  };
}
