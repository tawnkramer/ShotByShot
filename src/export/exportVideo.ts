import { AudioBufferSource, BufferTarget, CanvasSource, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_MEDIUM } from 'mediabunny';
import { zipSync } from 'fflate';
import type { Project } from '../state/schema';
import { aspectOf, effectiveShots } from '../shots/setup';
import { FilmRenderer, frameSize, type Overlay, type Resolution } from './render';
import { mixDialogue, MIX_RATE } from './audioMix';

export interface VideoOptions extends Overlay {
  resolution: Resolution;
  fps: number;
  audio: boolean;
}

export interface Progress {
  phase: 'Preparing' | 'Mixing audio' | 'Rendering' | 'Finishing';
  done: number;
  total: number;
}

export interface Capabilities {
  video: string | null;
  audio: string | null;
}

const VIDEO_PREFERENCE = ['avc', 'hevc', 'vp9', 'av1'] as const;
const AUDIO_PREFERENCE = ['aac', 'opus'] as const;

/** Which codecs this browser can encode for the given size. H.264 and AAC play everywhere; the rest are fallbacks. */
export async function probe(width: number, height: number, fps: number): Promise<Capabilities> {
  if (typeof VideoEncoder === 'undefined') return { video: null, audio: null };
  const format = new Mp4OutputFormat();
  const video = await getFirstEncodableVideoCodec(
    VIDEO_PREFERENCE.filter((c) => format.getSupportedVideoCodecs().includes(c)),
    { width, height, frameRate: fps, quality: QUALITY_HIGH },
  );
  const audio =
    typeof AudioEncoder === 'undefined'
      ? null
      : await getFirstEncodableAudioCodec(
          AUDIO_PREFERENCE.filter((c) => format.getSupportedAudioCodecs().includes(c)),
          { numberOfChannels: 2, sampleRate: MIX_RATE, quality: QUALITY_MEDIUM },
        );
  return { video, audio };
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
  }
}

/** Renders the whole film to an MP4, frame by frame. */
export async function exportVideo(project: Project, opts: VideoOptions, onProgress: (p: Progress) => void, signal?: AbortSignal): Promise<{ blob: Blob; codecs: Capabilities }> {
  const { width, height } = frameSize(aspectOf(project), opts.resolution);
  onProgress({ phase: 'Preparing', done: 0, total: 1 });
  const caps = await probe(width, height, opts.fps);
  if (!caps.video) throw new Error("This browser can't encode video. Try a recent Chrome, Edge or Safari (iOS 16.4 or later).");

  const renderer = new FilmRenderer(project, width, height, opts);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  try {
    const video = new CanvasSource(renderer.canvas, { codec: caps.video as never, quality: QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: opts.fps });

    let mix: AudioBuffer | null = null;
    let audio: AudioBufferSource | null = null;
    if (opts.audio && caps.audio) {
      onProgress({ phase: 'Mixing audio', done: 0, total: 1 });
      mix = await mixDialogue(project);
      if (mix) {
        audio = new AudioBufferSource({ codec: caps.audio as never, quality: QUALITY_MEDIUM });
        output.addAudioTrack(audio);
      }
    }
    await output.start();

    const total = Math.max(1, Math.ceil(renderer.seq.total * opts.fps));
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new ExportCancelled();
      await renderer.renderTime(i / opts.fps);
      await video.add(i / opts.fps, 1 / opts.fps);
      if (i % 4 === 0) {
        onProgress({ phase: 'Rendering', done: i, total });
        // Let the page repaint the progress bar.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    video.close();
    if (audio && mix) {
      onProgress({ phase: 'Finishing', done: 0, total: 1 });
      await audio.add(mix);
      audio.close();
    }
    onProgress({ phase: 'Finishing', done: 1, total: 1 });
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer!;
    return { blob: new Blob([buffer], { type: 'video/mp4' }), codecs: { video: caps.video, audio: audio ? caps.audio : null } };
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    renderer.dispose();
  }
}

/** True when a shot changes during its length (camera, characters or props move). */
export function shotMoves(project: Project, shotId: string): boolean {
  const e = effectiveShots(project).get(shotId);
  if (!e) return false;
  return e.camera.mode === 'moving' || e.setup.actors.some((a) => a.motion.mode === 'moving') || e.setup.props.some((p) => p.motion.mode === 'moving');
}

export function stillName(number: string, which: 'start' | 'end'): string {
  return `S${number.padStart(3, '0')}_${which}.png`;
}

/** First frame of every shot (and last frame of shots that move) as PNGs in a zip. No captions. */
export async function exportStills(project: Project, opts: { resolution: Resolution; includeEnd: boolean }, onProgress: (p: Progress) => void, signal?: AbortSignal): Promise<Blob> {
  const { width, height } = frameSize(aspectOf(project), opts.resolution);
  const renderer = new FilmRenderer(project, width, height, { captions: false, shotNumbers: false });
  const files: Record<string, Uint8Array> = {};
  try {
    const jobs = project.shots.flatMap((s) => [{ shot: s, which: 'start' as const }, ...(opts.includeEnd && shotMoves(project, s.id) ? [{ shot: s, which: 'end' as const }] : [])]);
    for (let i = 0; i < jobs.length; i++) {
      if (signal?.aborted) throw new ExportCancelled();
      const { shot, which } = jobs[i];
      await renderer.renderShot(shot.id, which === 'start' ? 0 : 1);
      files[stillName(shot.number, which)] = new Uint8Array(await (await renderer.toBlob()).arrayBuffer());
      onProgress({ phase: 'Rendering', done: i + 1, total: jobs.length });
    }
  } finally {
    renderer.dispose();
  }
  // PNGs are already compressed.
  return new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' });
}
