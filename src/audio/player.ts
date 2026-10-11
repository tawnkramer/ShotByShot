import { getBlob } from '../storage/db';

let ctx: AudioContext | null = null;

/** The shared audio context. Call from a tap so iOS lets it start. */
export function audioContext(): AudioContext {
  playThroughSilentSwitch();
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') void ctx.resume();
  return ctx;
}

let silence: HTMLAudioElement | null = null;

/**
 * On iPhone, Web Audio follows the ring/silent switch, so dialogue is muted when
 * the phone is on silent. Declaring a playback session (Safari 17+) fixes that;
 * older Safari switches to playback while an HTML audio element is playing, so
 * a looping silent clip is started from the same tap.
 */
function playThroughSilentSwitch(): void {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) {
    if (session.type !== 'playback') session.type = 'playback';
    return;
  }
  if (!/iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return;
  if (!silence) {
    silence = document.createElement('audio');
    silence.setAttribute('x-webkit-airplay', 'deny');
    silence.loop = true;
    silence.src = silentWav();
  }
  void silence.play().catch(() => {});
}

function silentWav(): string {
  const samples = 4410;
  const view = new DataView(new ArrayBuffer(44 + samples));
  const text = (o: number, t: string) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 44100, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
}

const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** Decodes a stored clip once. */
export function loadBuffer(blobKey: string): Promise<AudioBuffer | null> {
  let p = buffers.get(blobKey);
  if (!p) {
    p = (async () => {
      const blob = await getBlob(blobKey);
      if (!blob) return null;
      return decode(await blob.arrayBuffer());
    })().catch(() => null);
    buffers.set(blobKey, p);
  }
  return p;
}

async function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  // Decoding doesn't need a running context, so this works before any tap.
  const Offline = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  return new Offline(1, 1, 44100).decodeAudioData(data);
}

export async function decodeDuration(blob: Blob): Promise<number> {
  const buffer = await decode(await blob.arrayBuffer());
  return Math.max(0.1, Math.round(buffer.duration * 100) / 100);
}

export interface Cue {
  blob: string;
  /** Seconds on the player's timeline. */
  at: number;
}

/**
 * Plays dialogue clips in step with a timeline. `start` schedules every clip
 * from a given time (including ones already under way); `stop` silences them.
 */
export class DialoguePlayer {
  private sources: AudioBufferSourceNode[] = [];
  private token = 0;

  async start(cues: Cue[], from: number): Promise<void> {
    this.clear();
    const token = ++this.token;
    const ac = audioContext();
    const t0 = performance.now();
    const relevant = cues.filter((c) => c.at + 30 > from);
    const loaded = await Promise.all(relevant.map(async (c) => ({ c, buffer: await loadBuffer(c.blob) })));
    if (token !== this.token) return;
    // The picture kept moving while clips loaded; catch up.
    from += (performance.now() - t0) / 1000;
    const now = ac.currentTime + 0.02;
    for (const { c, buffer } of loaded) {
      if (!buffer || c.at + buffer.duration <= from) continue;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(ac.destination);
      const offset = Math.max(0, from - c.at);
      src.start(now + Math.max(0, c.at - from), offset);
      this.sources.push(src);
    }
  }

  stop(): void {
    this.clear();
    silence?.pause();
  }

  private clear(): void {
    this.token++;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
  }
}
