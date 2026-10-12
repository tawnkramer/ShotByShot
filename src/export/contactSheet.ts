import type { CameraState, Project } from '../state/schema';
import { aspectOf, effectiveShot } from '../shots/setup';
import { lensToVFov } from '../three/camera';
import { isContainer, worldRect } from '../staging/placement';

export const SHEET_MOMENTS = ['start', 'middle', 'end'] as const;
export type SheetMoment = (typeof SHEET_MOMENTS)[number];
/** Through each shot's camera, or from high above the front of the set to check blocking. */
export type SheetView = 'camera' | 'overhead';

const PROGRESS: Record<SheetMoment, number> = { start: 0, middle: 0.5, end: 1 };
const GAP = 4;
const LABEL = 18;

export interface SheetLayout {
  width: number;
  height: number;
  frame: { width: number; height: number };
  /** Top-left of each frame, by row (shot) then column (moment). */
  cells: { x: number; y: number }[][];
}

/** A grid of frames under a header row naming the moments. */
export function sheetLayout(rows: number, cols: number, frameWidth: number, aspect: number): SheetLayout {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const frame = { width: even(frameWidth), height: even(frameWidth / aspect) };
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ x: GAP + c * (frame.width + GAP), y: LABEL + GAP + r * (frame.height + GAP) })));
  return { width: GAP + cols * (frame.width + GAP), height: LABEL + GAP + rows * (frame.height + GAP), frame, cells };
}

/** What the sheet needs from a renderer; FilmRenderer fits. */
export interface FrameSource {
  readonly canvas: HTMLCanvasElement;
  renderShot(shotId: string, u: number, localSec?: number, view?: CameraState): Promise<void>;
  dispose(): void;
}

export type FrameSourceFactory = (project: Project, width: number, height: number, aspect: number) => FrameSource | Promise<FrameSource>;

const filmRenderer: FrameSourceFactory = async (project, width, height, aspect) => {
  const { FilmRenderer } = await import('./render');
  return new FilmRenderer(project, width, height, { captions: false, shotNumbers: true, aspect });
};

/** Overhead frames are 4:3 whatever the film's aspect, so a set fits without shrinking. */
const OVERHEAD = { elevation: 55, lens: 24, aspect: 4 / 3 };

/** A high view from the front that takes in the shot's furniture and everyone in it (not the whole room shell). */
export function overheadCamera(project: Project, shotId: string, aspect = OVERHEAD.aspect): CameraState | undefined {
  const eff = effectiveShot(project, shotId);
  if (!eff) return undefined;
  const stage = project.stages.find((s) => s.id === eff.stageId);
  const xs: number[] = [], zs: number[] = [];
  for (const o of stage?.objects ?? []) {
    if (isContainer(o.source) || eff.setup.stageOverrides[o.id]?.hidden) continue;
    const r = worldRect({ source: o.source, transform: { ...o.transform, position: eff.setup.stageOverrides[o.id]?.position ?? o.transform.position } });
    xs.push(r.minX, r.maxX);
    zs.push(r.minZ, r.maxZ);
  }
  for (const a of eff.setup.actors) for (const k of [a.motion.start, a.motion.end]) if (k) (xs.push(k.position[0]), zs.push(k.position[2]));
  if (!xs.length) return undefined;
  const pad = 0.6;
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad];
  const vfov = (lensToVFov(OVERHEAD.lens, aspect) * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const el = (OVERHEAD.elevation * Math.PI) / 180;
  // Depth foreshortens with the tilt; leave room for people's height.
  const tall = (maxZ - minZ) * Math.sin(el) + 1.8 * Math.cos(el);
  const distance = 1.1 * Math.max((maxX - minX) / 2 / Math.tan(hfov / 2), tall / 2 / Math.tan(vfov / 2));
  return { target: [(minX + maxX) / 2, 0.6, (minZ + maxZ) / 2], azimuth: 0, elevation: OVERHEAD.elevation, distance, lens: OVERHEAD.lens, roll: 0 };
}

/**
 * Renders shots through their cameras into one JPEG: a row per shot, a
 * column per moment. Frees the WebGL context afterwards (iOS allows few).
 */
export async function renderContactSheet(project: Project, shotIds: string[], moments: readonly SheetMoment[] = SHEET_MOMENTS, opts: { view?: SheetView; frameWidth?: number; makeRenderer?: FrameSourceFactory } = {}): Promise<string | null> {
  const aspect = opts.view === 'overhead' ? OVERHEAD.aspect : aspectOf(project);
  const layout = sheetLayout(shotIds.length, moments.length, opts.frameWidth ?? 384, aspect);
  const sheet = document.createElement('canvas');
  sheet.width = layout.width;
  sheet.height = layout.height;
  const c = sheet.getContext('2d');
  if (!c) return null;
  let renderer: FrameSource;
  try {
    renderer = await (opts.makeRenderer ?? filmRenderer)(project, layout.frame.width, layout.frame.height, aspect);
  } catch {
    return null;
  }
  try {
    c.fillStyle = '#141416';
    c.fillRect(0, 0, layout.width, layout.height);
    c.fillStyle = '#d8d8dc';
    c.font = `600 ${LABEL - 6}px system-ui, sans-serif`;
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    moments.forEach((m, col) => c.fillText(m.toUpperCase(), layout.cells[0][col].x + layout.frame.width / 2, LABEL / 2 + 2));
    for (const [row, id] of shotIds.entries()) {
      const view = opts.view === 'overhead' ? overheadCamera(project, id) : undefined;
      for (const [col, m] of moments.entries()) {
        await renderer.renderShot(id, PROGRESS[m], -1, view);
        const { x, y } = layout.cells[row][col];
        c.drawImage(renderer.canvas, x, y, layout.frame.width, layout.frame.height);
      }
    }
    return sheet.toDataURL('image/jpeg', 0.75);
  } finally {
    renderer.dispose();
  }
}
