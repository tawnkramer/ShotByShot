import * as THREE from 'three';
import type { Project } from '../state/schema';
import { ShotRig } from '../three/shotRig';
import { applyCamera } from '../three/camera';
import { buildSequence, locate, type Sequence } from '../shots/sequence';
import { aspectOf, captionsOf, effectiveShots } from '../shots/setup';
import { captionAt, type Caption } from '../shots/timing';

export type Resolution = '720' | '1080';

/** Output size for the project's aspect ratio: the long side is 1280 or 1920, both sides even. */
export function frameSize(aspect: number, res: Resolution): { width: number; height: number } {
  const long = res === '1080' ? 1920 : 1280;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return aspect >= 1 ? { width: long, height: even(long / aspect) } : { width: even(long * aspect), height: long };
}

export interface Overlay {
  captions: boolean;
  shotNumbers: boolean;
}

/**
 * Renders any moment of the film to a 2D canvas: the 3D frame through the
 * shot camera, plus burned-in captions and shot numbers. Frame-exact, not
 * real time, so slow devices still produce smooth video.
 */
export class FilmRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly seq: Sequence;
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera();
  private rig = new ShotRig();
  private ctx: CanvasRenderingContext2D;
  private currentShot: string | null = null;
  private aspect: number;
  private captions = new Map<string, Caption[]>();

  constructor(
    private project: Project,
    readonly width: number,
    readonly height: number,
    private overlay: Overlay = { captions: true, shotNumbers: false },
  ) {
    this.aspect = aspectOf(project);
    this.seq = buildSequence(project);
    this.gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(1);
    this.gl.setSize(width, height, false);
    this.gl.shadowMap.enabled = true;
    this.scene.background = new THREE.Color('#2b2b30');
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x55555c, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 10, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.25 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground, this.rig.root);
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    const eff = effectiveShots(project);
    for (const s of project.shots) this.captions.set(s.id, captionsOf(project, s, eff.get(s.id)?.durationSec ?? 1));
  }

  /** Draws the film at time t (seconds). */
  async renderTime(t: number): Promise<void> {
    const { index, u } = locate(this.seq, t);
    if (index < 0) return;
    const item = this.seq.items[index];
    await this.renderShot(item.shotId, u, u * item.duration);
  }

  /** Draws one shot at progress u (0..1); `localSec` picks the caption. */
  async renderShot(shotId: string, u: number, localSec = -1): Promise<void> {
    if (this.currentShot !== shotId) {
      this.rig.sync(this.project, shotId);
      await this.rig.ready();
      this.currentShot = shotId;
    }
    const cam = this.rig.setTime(u);
    if (cam) applyCamera(this.camera, cam, this.aspect);
    this.gl.render(this.scene, this.camera);
    const c = this.ctx;
    c.drawImage(this.gl.domElement, 0, 0, this.width, this.height);
    if (this.overlay.shotNumbers) this.drawBadge(this.project.shots.find((s) => s.id === shotId)?.number ?? '');
    if (this.overlay.captions && localSec >= 0) {
      const cap = captionAt(this.captions.get(shotId) ?? [], localSec);
      if (cap) drawCaption(c, cap, this.width, this.height);
    }
  }

  toBlob(type = 'image/png'): Promise<Blob> {
    return new Promise((resolve, reject) => this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type));
  }

  dispose(): void {
    this.rig.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }

  private drawBadge(text: string): void {
    const c = this.ctx;
    const size = Math.round(this.height * 0.035);
    c.font = `700 ${size}px system-ui, -apple-system, sans-serif`;
    const pad = size * 0.4;
    const w = c.measureText(text).width + pad * 2;
    c.fillStyle = 'rgba(20,20,22,0.75)';
    c.fillRect(size * 0.6, size * 0.6, w, size + pad);
    c.fillStyle = '#f2b84b';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillText(text, size * 0.6 + pad, size * 0.6 + (size + pad) / 2);
  }
}

/** Lower-third caption: speaker in accent color above wrapped white text with a dark outline. */
export function drawCaption(c: CanvasRenderingContext2D, cap: Caption, width: number, height: number): void {
  const size = Math.round(Math.min(height * 0.05, width * 0.035));
  c.font = `500 ${size}px system-ui, -apple-system, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  const lines = wrap(c, cap.text, width * 0.84);
  const lineH = size * 1.25;
  let y = height * 0.93 - (lines.length - 1) * lineH;
  if (cap.speaker) {
    c.font = `700 ${Math.round(size * 0.72)}px system-ui, -apple-system, sans-serif`;
    outlined(c, cap.speaker.toUpperCase(), width / 2, y - lineH * 0.95, '#f2b84b', size);
    c.font = `500 ${size}px system-ui, -apple-system, sans-serif`;
  }
  for (const line of lines) {
    outlined(c, line, width / 2, y, '#ffffff', size);
    y += lineH;
  }
}

function outlined(c: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, size: number): void {
  c.lineJoin = 'round';
  c.lineWidth = Math.max(2, size * 0.16);
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.strokeText(text, x, y);
  c.fillStyle = fill;
  c.fillText(text, x, y);
}

export function wrap(c: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && c.measureText(next).width > maxWidth) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
