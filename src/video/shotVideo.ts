import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny';
import type { Character, Project, Shot } from '../state/schema';
import { aspectOf, captionsOf, effectiveShot, shotLines } from '../shots/setup';
import { getBlob } from '../storage/db';
import { CHARACTER_IMAGE_PRESENTATION, characterImagePrompt } from '../images/generate';
import { groupKey, sizeForAspect, type MediaKind, type MediaSlot, type ReferenceGroup } from '../comfy/workflow';
import { FilmRenderer } from '../export/render';
import { probe } from '../export/exportVideo';

/** Something from the project that can fill a workflow's media input. */
export interface MediaOption {
  id: string;
  kind: MediaKind;
  label: string;
  /** How the prompt refers to it. */
  role: string;
  fileName: string;
  /** Stored asset; options without one are produced on demand. */
  blobKey?: string;
  data?: Blob;
}

const MIME: Record<string, string> = { png: 'image/png', mp3: 'audio/mpeg', mp4: 'video/mp4' };
export const PREVIS_CLIP = 'previs-clip';
export const SHOT_VIDEO = 'shot-video';

/** Images, dialogue, the previs clip and the shot's current video that suit this shot, in the order they're suggested. */
export function mediaOptions(project: Project, shot: Shot, previsFrame?: { blob: Blob; characterIds: string[] }): MediaOption[] {
  const eff = effectiveShot(project, shot.id)!;
  const options: MediaOption[] = [];
  if (shot.image) options.push({ id: 'shot-image', kind: 'image', label: 'Shot image', role: `the illustrated start frame of the shot`, fileName: 'shot.png', blobKey: shot.image.blob });
  if (previsFrame) options.push({ id: 'previs-frame', kind: 'image', label: 'Previs frame (greyscale)', role: 'a rough greyscale previs frame for camera framing and composition', fileName: 'previs-frame.png', data: previsFrame.blob });
  const characterIds = [...new Set([...eff.setup.actors.map((a) => a.characterId), ...(previsFrame?.characterIds ?? [])])];
  for (const id of characterIds) {
    const c = project.characters.find((x) => x.id === id);
    if (c?.image) options.push({ id: `character:${id}`, kind: 'image', label: `${c.name} (character)`, role: `the appearance reference for ${c.name}`, fileName: 'character.png', blobKey: c.image.blob });
  }
  const stage = project.stages.find((s) => s.id === eff.stageId);
  if (stage?.image) options.push({ id: 'stage', kind: 'image', label: `${stage.name} (stage)`, role: `the set reference for ${stage.name}`, fileName: 'stage.png', blobKey: stage.image.blob });
  for (const c of captionsOf(project, shot, eff.durationSec)) {
    if (c.audioBlob) options.push({ id: `line:${c.lineId}`, kind: 'audio', label: `${c.speaker ? `${c.speaker}: ` : ''}${clip(c.text, 40)}`, role: `the recorded dialogue${c.speaker ? ` spoken by ${c.speaker}` : ''} starting ${c.inSec.toFixed(1)} s into the shot: "${c.text}"`, fileName: 'dialogue.mp3', blobKey: c.audioBlob });
  }
  options.push({ id: PREVIS_CLIP, kind: 'video', label: 'Previs clip (camera and blocking)', role: 'a rough greyscale previs of the camera movement and blocking. Follow its camera motion, timing and positions, not its look', fileName: 'previs.mp4' });
  if (shot.video) options.push({ id: SHOT_VIDEO, kind: 'video', label: 'Current shot video (previous take)', role: 'the previous take of this shot. Keep what works in it and change what the prompt asks for', fileName: 'shot-video.mp4', blobKey: shot.video.blob });
  return options;
}

/** Picks a different suggestion for each input, in suggestion order. */
export function defaultAssignments(slots: MediaSlot[], options: MediaOption[]): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const slot of slots) {
    const pick = options.find((o) => o.kind === slot.kind && !used.has(o.id)) ?? options.find((o) => o.kind === slot.kind);
    if (pick) { used.add(pick.id); result.set(`${slot.nodeId}.${slot.input}`, pick.id); }
  }
  return result;
}

export async function optionData(option: MediaOption): Promise<Blob> {
  if (option.data) return option.data;
  const data = option.blobKey ? await getBlob(option.blobKey) : undefined;
  if (!data) throw new Error(`The saved file for ${option.label} is missing.`);
  // Project imports can restore blobs without their original MIME type.
  return new Blob([data], { type: MIME[option.fileName.split('.').pop()!] ?? data.type });
}

/** Reference videos must run at least this long for Seedance; shorter previs clips aren't suggested. */
const MIN_REFERENCE_VIDEO_SEC = 1.8;

/** Fills each reference group with every suitable suggestion, up to its limit. The greyscale frame is left for fixed inputs; the previous take is opt-in. */
export function defaultReferences(groups: ReferenceGroup[], options: MediaOption[], durationSec: number): Map<string, string[]> {
  return new Map(groups.map((g) => [groupKey(g), options
    .filter((o) => o.kind === g.kind && o.id !== 'previs-frame' && o.id !== SHOT_VIDEO && (o.id !== PREVIS_CLIP || (durationSec >= MIN_REFERENCE_VIDEO_SEC && durationSec <= 15)))
    .slice(0, g.max).map((o) => o.id)]));
}

/**
 * How the prompt names each input, numbered per kind in submission order.
 * Reference-list models (Seedance) number their inputs "Image 1", "Video 1";
 * single-input workflows use the MiniMax-style "<Picture 1>".
 */
export function referenceTags(kinds: MediaKind[], style: 'reference' | 'picture'): string[] {
  const counts: Record<MediaKind, number> = { image: 0, audio: 0, video: 0 };
  const names: Record<MediaKind, string> = style === 'reference' ? { image: 'Image', audio: 'Audio', video: 'Video' } : { image: 'Picture', audio: 'Audio', video: 'Video' };
  return kinds.map((k) => {
    const label = `${names[k]} ${++counts[k]}`;
    return style === 'reference' ? label : `<${label}>`;
  });
}

export function videoPrompt(project: Project, shot: Shot, inputs: { tag: string; option: MediaOption }[], additional: string): string {
  const eff = effectiveShot(project, shot.id)!;
  const stage = project.stages.find((s) => s.id === eff.stageId);
  const characters = eff.setup.actors.map((a) => project.characters.find((c) => c.id === a.characterId)).filter((c): c is Character => Boolean(c));
  const refFor = (c: Character) => inputs.find((i) => i.option.id === `character:${c.id}`)?.tag;
  const captions = captionsOf(project, shot, eff.durationSec);
  return [
    inputs.length ? `references:\n${inputs.map((i) => `${i.tag} is ${i.option.role}.`).join('\n')}` : '',
    characters.length ? `subjects:\n${characters.map((c, i) => `<Subject ${i + 1}> is ${c.name}${refFor(c) ? ` from ${refFor(c)}` : ''}: ${describe(c)}`).join('\n')}` : '',
    `summary:\nShot ${shot.number}, one continuous ${eff.durationSec.toFixed(1)} second shot${stage ? ` in ${stage.name}` : ''}. Keep the identity, clothing and proportions of every subject consistent with the references.`,
    `camera:\n${cameraDescription(eff.camera)}`,
    `action:\n${shotLines(project, shot).filter((l) => l.type !== 'dialogue' && l.type !== 'character').map((l) => l.text).join('\n') || 'Follow the story context.'}`,
    captions.some((c) => c.speaker) ? `dialogue:\n${captions.filter((c) => c.speaker).map((c) => `${c.inSec.toFixed(1)}–${c.outSec.toFixed(1)} s, ${c.speaker}: "${c.text}"`).join('\n')}` : '',
    'audio:\nVoices and natural sound effects only. No music, no score, no soundtrack.',
    additional.trim() ? `additional direction (highest priority):\n${additional.trim()}` : '',
  ].filter(Boolean).join('\n\n');
}

function describe(c: Character): string {
  return (c.image?.prompt ?? characterImagePrompt(c)).replaceAll(CHARACTER_IMAGE_PRESENTATION, '').replaceAll(`Create a full-body character concept illustration of ${c.name}.`, '').replace(/\s+/g, ' ').trim();
}

export function cameraDescription(camera: NonNullable<ReturnType<typeof effectiveShot>>['camera']): string {
  const { start, end } = camera;
  const base = `${Math.round(start.lens)} mm lens, ${Math.abs(start.elevation) < 5 ? 'eye level' : start.elevation > 0 ? 'looking down' : 'looking up'}.`;
  if (camera.mode !== 'moving' || !end) return `Locked-off camera, ${base}`;
  const moves: string[] = [];
  const dist = end.distance - start.distance;
  if (Math.abs(dist) > 0.1 * start.distance) moves.push(dist < 0 ? 'push in' : 'pull out');
  const az = ((end.azimuth - start.azimuth + 540) % 360) - 180;
  if (Math.abs(az) > 3) moves.push(`orbit ${az > 0 ? 'right' : 'left'} about ${Math.round(Math.abs(az))}°`);
  const el = end.elevation - start.elevation;
  if (Math.abs(el) > 3) moves.push(el > 0 ? 'crane up' : 'crane down');
  if (Math.abs(end.lens - start.lens) > 2) moves.push(`zoom ${end.lens > start.lens ? 'in' : 'out'} to ${Math.round(end.lens)} mm`);
  if (Math.hypot(end.target[0] - start.target[0], end.target[2] - start.target[2]) > 0.2) moves.push('track with the action');
  return `${moves.length ? `Smooth ${moves.join(', ')} over the whole shot` : 'Subtle camera drift'}, starting on a ${base}`;
}

function clip(text: string, n: number) { return text.length > n ? `${text.slice(0, n - 1)}…` : text; }

/** Renders the shot's previs (no captions or audio) to an MP4. */
export async function renderPrevisClip(project: Project, shotId: string, signal?: AbortSignal): Promise<Blob> {
  const eff = effectiveShot(project, shotId);
  if (!eff) throw new Error('This shot no longer exists.');
  // About 0.64 MP keeps the clip inside Seedance's 409,600–927,408 pixel range for reference videos at any aspect ratio.
  const { width, height } = sizeForAspect(aspectOf(project), 640_000, 16);
  const fps = project.fps;
  const caps = await probe(width, height, fps);
  if (!caps.video) throw new Error("This browser can't encode video, so the previs clip can't be sent.");
  const renderer = new FilmRenderer(project, width, height, { captions: false, shotNumbers: false });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  try {
    const video = new CanvasSource(renderer.canvas, { codec: caps.video as never, quality: QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: fps });
    await output.start();
    const total = Math.max(1, Math.ceil(eff.durationSec * fps));
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw signal.reason;
      await renderer.renderShot(shotId, total === 1 ? 0 : i / (total - 1));
      await video.add(i / fps, 1 / fps);
    }
    video.close();
    await output.finalize();
    return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    renderer.dispose();
  }
}
