import type { Project } from '../state/schema';
import { buildSequence } from '../shots/sequence';
import { captionsOf, effectiveShots } from '../shots/setup';
import { loadBuffer, type Cue } from '../audio/player';

export const MIX_RATE = 48000;

/** Every voiced line on the film's timeline (lines past a shot's end are cut, like in playback). */
export function filmCues(project: Project): Cue[] {
  const seq = buildSequence(project);
  const eff = effectiveShots(project);
  const out: Cue[] = [];
  for (const it of seq.items) {
    const shot = project.shots.find((s) => s.id === it.shotId);
    const e = eff.get(it.shotId);
    if (!shot || !e) continue;
    for (const c of captionsOf(project, shot, e.durationSec)) if (c.audioBlob && c.inSec < e.durationSec) out.push({ blob: c.audioBlob, at: it.start + c.inSec });
  }
  return out;
}

/** Mixes the dialogue into one stereo track the length of the film. Returns null if nothing is voiced. */
export async function mixDialogue(project: Project): Promise<AudioBuffer | null> {
  const cues = filmCues(project);
  if (!cues.length) return null;
  const total = buildSequence(project).total;
  const Offline = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new Offline(2, Math.max(1, Math.ceil(total * MIX_RATE)), MIX_RATE);
  for (const cue of cues) {
    const buffer = await loadBuffer(cue.blob);
    if (!buffer) continue;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(cue.at);
  }
  return ctx.startRendering();
}
