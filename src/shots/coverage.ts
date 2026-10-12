import type { CameraState, Project, Shot } from '../state/schema';
import { lensToVFov, SHOT_SIZES, type ShotSize } from '../three/camera';
import { speakerOf } from '../story/classify';
import { aspectOf, effectiveShots, poseHeight, sceneLineOf, shotLines, type EffectiveShot } from './setup';
import { keyOf } from './timing';
import { LIBRARY, resolveParams } from '../three/library';

/**
 * Checks a scene's coverage against the measurable rules of film grammar
 * (Katz, "Shot by Shot"): the line of action (C1/C2), changing at least two
 * things on a cut (C3), jump cuts (C4), matched reverses (C7) and lens by
 * size (C11). Pure: works from the saved and derived shots.
 */

export const SIZE_ORDER: ShotSize[] = ['EWS', 'WS', 'MS', 'MCU', 'CU', 'ECU'];

/** Thresholds, from the plan in docs/SHOT_BY_SHOT_SKILL.md. */
export const COVERAGE = {
  /** Within this distance of the line (m), the camera is on it: either side may follow. */
  onLine: 0.35,
  /** A lead moving this far (m) redraws the line. */
  redraw: 0.75,
  angle: 30,
  height: 10,
  lensRatio: 1.4,
  /** Reverse shots count as matched within these. */
  match: { size: 0, lensRatio: 1.25, height: 8 },
};

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  /** "1.4→1.5" for a cut, "1.4/1.7" for a pair of reverses, or "1.4" for one shot. */
  at: string;
  rule: 'view' | 'C1' | 'C3' | 'C4' | 'C7' | 'C11';
  severity: Severity;
  message: string;
}

export interface ShotCoverage {
  shotId: string;
  number: string;
  /** Characters whose head or chest is in frame. */
  visible: string[];
  /** The character the shot is on (nearest the camera's aim), if any. */
  subject?: string;
  /** Single (only the subject), over-the-shoulder (others only in the foreground), group, or insert (nobody). */
  kind: 'single' | 'ots' | 'group' | 'insert';
  /** The camera's own direction (azimuth), degrees. */
  azimuth: number;
  size: ShotSize;
  /** Bearing of the camera around the subject (or the aim point), degrees. */
  bearing: number;
  elevation: number;
  height: 'eye' | 'high' | 'low';
  lens: number;
  moving: boolean;
  /** Side of the line of action: 1 or -1, 0 on the line, undefined when there's no line. */
  side?: number;
  /** For a moving camera, the side at its end. */
  endSide?: number;
  /** The two leads, when both are in the shot. */
  line?: [string, string];
  /** A wall between the camera and what it aims at. */
  blockedBy?: string;
}

type Vec = [number, number, number];

function cameraPos(s: CameraState): Vec {
  const az = (s.azimuth * Math.PI) / 180, el = (s.elevation * Math.PI) / 180;
  return [s.target[0] + s.distance * Math.sin(az) * Math.cos(el), s.target[1] + s.distance * Math.sin(el), s.target[2] + s.distance * Math.cos(az) * Math.cos(el)];
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec): Vec => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const deg = (r: number) => (r * 180) / Math.PI;
/** Smallest difference between two bearings, 0–180. */
export const angleDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** Whether a point is in the camera's frame (with a small margin). */
function inFrame(cam: CameraState, aspect: number, p: Vec): boolean {
  const pos = cameraPos(cam);
  const f = norm(sub(cam.target as Vec, pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const v = sub(p, pos);
  const z = dot(v, f);
  if (z < 0.1) return false;
  const tv = Math.tan(((lensToVFov(cam.lens, aspect) * Math.PI) / 180) / 2);
  const x = dot(v, r) / z / (tv * aspect), y = dot(v, u) / z / tv;
  return Math.abs(x) <= 1.02 && Math.abs(y) <= 1.02;
}

/** Signed distance (m) of the camera from the line a→b on the floor: + on the left looking from a to b. */
export function lineSide(a: Vec, b: Vec, cam: Vec): number {
  const ab: Vec = [b[0] - a[0], 0, b[2] - a[2]];
  const ac: Vec = [cam[0] - a[0], 0, cam[2] - a[2]];
  const len = Math.hypot(ab[0], ab[2]) || 1;
  // Y component of ab × ac. Facing +X with Y up, +Z is on the right, so positive means left.
  return (ab[2] * ac[0] - ab[0] * ac[2]) / len;
}

/** Wall slabs on the shot's stage as floor rectangles with a height: room walls (open at the front) and walls. */
function walls(project: Project, eff: EffectiveShot): { name: string; local: (p: Vec) => Vec; rects: { minX: number; maxX: number; minZ: number; maxZ: number; h: number; label: string }[] }[] {
  const stage = project.stages.find((s) => s.id === eff.stageId);
  const out: ReturnType<typeof walls> = [];
  for (const o of stage?.objects ?? []) {
    if (eff.setup.stageOverrides[o.id]?.hidden || o.source.kind !== 'library' || (o.source.item !== 'room' && o.source.item !== 'wall')) continue;
    const pr = resolveParams(LIBRARY[o.source.item], o.source.params);
    const pos = (eff.setup.stageOverrides[o.id]?.position ?? o.transform.position) as Vec;
    const [qx, qy, qz, qw] = o.transform.rotation;
    const yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qx * qx));
    const [sx, sy, sz] = o.transform.scale;
    // Into the object's own frame (unrotated, unscaled).
    const local = (p: Vec): Vec => {
      const dx = p[0] - pos[0], dz = p[2] - pos[2];
      return [(dx * Math.cos(yaw) - dz * Math.sin(yaw)) / sx, (p[1] - pos[1]) / sy, (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / sz];
    };
    const t = 0.12;
    if (o.source.item === 'room') {
      const w = pr.width / 2, d = pr.depth / 2;
      out.push({ name: o.name, local, rects: [
        { minX: -w - t, maxX: w + t, minZ: -d - t, maxZ: -d, h: pr.height, label: 'back wall' },
        { minX: -w - t, maxX: -w, minZ: -d, maxZ: d, h: pr.height, label: 'left wall' },
        { minX: w, maxX: w + t, minZ: -d, maxZ: d, h: pr.height, label: 'right wall' },
      ] });
    } else out.push({ name: o.name, local, rects: [{ minX: -pr.width / 2, maxX: pr.width / 2, minZ: -0.06, maxZ: 0.06, h: pr.height, label: 'wall' }] });
  }
  return out;
}

/** What blocks the camera's view of its aim point, if anything ("the back wall of Cafe"). */
export function viewBlocker(project: Project, eff: EffectiveShot, cam: CameraState): string | undefined {
  const from = cameraPos(cam), to = cam.target as Vec;
  for (const w of walls(project, eff)) {
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      const p = w.local([from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, from[2] + (to[2] - from[2]) * u]);
      const hit = w.rects.find((r) => p[0] >= r.minX && p[0] <= r.maxX && p[2] >= r.minZ && p[2] <= r.maxZ && p[1] <= r.h && p[1] >= 0);
      if (hit) return hit.label === 'wall' ? w.name : `the ${hit.label} of ${w.name}`;
    }
  }
  return undefined;
}

interface Person {
  id: string;
  start: Vec;
  end: Vec;
  height: number;
}

function people(project: Project, eff: EffectiveShot): Person[] {
  return eff.setup.actors.map((a) => {
    const c = project.characters.find((x) => x.id === a.characterId);
    const k = a.motion.start;
    return { id: a.characterId, start: k.position as Vec, end: keyOf(a.motion, 'end').position as Vec, height: poseHeight(c?.heightCm, k.pose) };
  });
}

/** The two characters with the most dialogue in each scene (by scene heading line id, '' before any heading). */
export function sceneLeads(project: Project): Map<string, [string, string] | undefined> {
  const byName = new Map(project.characters.map((c) => [c.name.toUpperCase(), c.id]));
  const speakers = speakerOf(project.script);
  const counts = new Map<string, Map<string, number>>();
  for (const shot of project.shots) {
    const scene = sceneLineOf(project, shot)?.id ?? '';
    const m = counts.get(scene) ?? new Map<string, number>();
    counts.set(scene, m);
    for (const l of shotLines(project, shot)) {
      const id = byName.get(speakers.get(l.id) ?? '');
      if (id && !/^\(.*\)$/.test(l.text.trim())) m.set(id, (m.get(id) ?? 0) + 1);
    }
  }
  const out = new Map<string, [string, string] | undefined>();
  for (const [scene, m] of counts) {
    const top = [...m.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    out.set(scene, top.length >= 2 ? [top[0], top[1]] : undefined);
  }
  return out;
}

function sizeFor(extent: number): ShotSize {
  let best: ShotSize = 'MS';
  let err = Infinity;
  for (const s of SIZE_ORDER) {
    const e = Math.abs(Math.log(extent / SHOT_SIZES[s].extent));
    if (e < err) (best = s), (err = e);
  }
  return best;
}

/** What a shot shows: who, how big, from where, on which side of the line. */
export function classifyShot(project: Project, shot: Shot, eff: EffectiveShot, leads?: [string, string]): ShotCoverage {
  const aspect = aspectOf(project);
  const cam = eff.camera.start;
  const pos = cameraPos(cam);
  const ps = people(project, eff);
  const visible = ps.filter((p) => [0.92, 0.65].some((f) => inFrame(cam, aspect, [p.start[0], p.height * f, p.start[2]]))).map((p) => p.id);
  const target = cam.target as Vec;
  const tv = Math.tan(((lensToVFov(cam.lens, aspect) * Math.PI) / 180) / 2);
  const fromAim = (p: Person) => Math.hypot(p.start[0] - target[0], p.start[2] - target[2]);
  const nearest = ps.filter((p) => visible.includes(p.id)).sort((a, b) => fromAim(a) - fromAim(b))[0];
  // A small frame aimed at something nobody is standing on is an insert, whoever shows behind it.
  const insert = 2 * cam.distance * tv < 0.6 && (!nearest || fromAim(nearest) > 0.45);
  const subj = insert ? undefined : nearest;
  let size: ShotSize;
  let bearing: number;
  if (subj) {
    const head: Vec = [subj.start[0], subj.height * 0.8, subj.start[2]];
    const d = Math.max(0.2, dot(sub(head, pos), norm(sub(target, pos))));
    size = sizeFor((2 * d * tv) / subj.height);
    bearing = deg(Math.atan2(pos[0] - subj.start[0], pos[2] - subj.start[2]));
  } else {
    // An insert: size by how much of a 0.5 m object the frame holds.
    size = sizeFor((2 * cam.distance * tv) / 1.7);
    bearing = cam.azimuth;
  }
  const camDist = (q: Person) => Math.hypot(q.start[0] - pos[0], q.start[2] - pos[2]);
  const others = subj ? ps.filter((q) => visible.includes(q.id) && q.id !== subj.id) : [];
  const kind = !subj ? 'insert' : !others.length ? 'single' : others.every((q) => camDist(q) < camDist(subj) - 0.3) ? 'ots' : 'group';
  const out: ShotCoverage = {
    shotId: shot.id, number: shot.number, visible, subject: subj?.id, kind, azimuth: ((cam.azimuth % 360) + 360) % 360, size, bearing: ((bearing % 360) + 360) % 360,
    elevation: cam.elevation, height: cam.elevation > 10 ? 'high' : cam.elevation < -5 ? 'low' : 'eye',
    lens: cam.lens, moving: eff.camera.mode === 'moving' && !!eff.camera.end,
    blockedBy: viewBlocker(project, eff, cam) ?? (eff.camera.mode === 'moving' && eff.camera.end ? viewBlocker(project, eff, eff.camera.end) : undefined),
  };
  const a = leads && ps.find((p) => p.id === leads[0]), b = leads && ps.find((p) => p.id === leads[1]);
  if (a && b) {
    out.line = leads;
    const side = (c: Vec, which: 'start' | 'end') => {
      const d = lineSide(a[which], b[which], c);
      return Math.abs(d) < COVERAGE.onLine ? 0 : Math.sign(d);
    };
    out.side = side(pos, 'start');
    if (out.moving) out.endSide = side(cameraPos(eff.camera.end!), 'end');
  }
  return out;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** The elements that change on a cut (C3). */
export function changes(a: ShotCoverage, b: ShotCoverage): string[] {
  const out: string[] = [];
  if (a.subject !== b.subject || !sameSet(a.visible, b.visible)) out.push('subject');
  if (SIZE_ORDER.indexOf(a.size) !== SIZE_ORDER.indexOf(b.size)) out.push('size');
  // Around the same subject, how far the camera moved; on a new subject, how far it turned.
  if (a.subject === b.subject ? angleDiff(a.bearing, b.bearing) >= COVERAGE.angle : angleDiff(a.azimuth, b.azimuth) >= COVERAGE.angle) out.push('angle');
  if (Math.abs(a.elevation - b.elevation) >= COVERAGE.height || a.height !== b.height) out.push('height');
  if (Math.max(a.lens, b.lens) / Math.min(a.lens, b.lens) >= COVERAGE.lensRatio) out.push('lens');
  if (a.moving !== b.moving) out.push('movement');
  return out;
}

/** Shots in scenes, in order, with their scene heading id. */
function shotsWithScene(project: Project, shotIds?: string[]) {
  const ids = shotIds && new Set(shotIds);
  return project.shots.filter((s) => !ids || ids.has(s.id)).map((s) => ({ shot: s, scene: sceneLineOf(project, s)?.id ?? '' }));
}

const name = (project: Project, id?: string) => project.characters.find((c) => c.id === id)?.name ?? '?';

export function checkCoverage(project: Project, shotIds?: string[]): { shots: ShotCoverage[]; findings: Finding[] } {
  const eff = effectiveShots(project);
  const leads = sceneLeads(project);
  const list = shotsWithScene(project, shotIds);
  const shots = list.map(({ shot, scene }) => classifyShot(project, shot, eff.get(shot.id)!, leads.get(scene)));
  const findings: Finding[] = [];
  const sceneOf = new Map(list.map(({ shot, scene }) => [shot.id, scene]));

  for (const c of shots) {
    if (c.blockedBy) findings.push({ at: c.number, rule: 'view', severity: 'error', message: `${c.blockedBy} is between the camera and the shot. There's no room for this angle: choose another, or restage.` });
    const big = SIZE_ORDER.indexOf(c.size);
    if (big <= 1 && c.lens > 40) findings.push({ at: c.number, rule: 'C11', severity: 'info', message: `${c.size} at ${Math.round(c.lens)} mm; wide shots usually use 24–35 mm.` });
    if (big >= 3 && c.subject && c.lens < 40) findings.push({ at: c.number, rule: 'C11', severity: 'info', message: `${c.size} at ${Math.round(c.lens)} mm; closeups usually use 50–85 mm.` });
  }

  // C1/C2: hold the side of the line from the last shot that set it, unless something in between allows a crossing.
  let established: ShotCoverage | undefined;
  let bridge = '';
  for (const [i, c] of shots.entries()) {
    const prev = shots[i - 1];
    if (prev && sceneOf.get(prev.shotId) !== sceneOf.get(c.shotId)) (established = undefined), (bridge = '');
    if (c.side === undefined || c.side === 0 || c.kind === 'insert') {
      if (c.kind === 'insert') bridge ||= `${c.number} is an insert`;
      else if (c.side === 0) bridge ||= `${c.number} sits on the line`;
      continue;
    }
    if (established && established.side !== c.side) {
      const e = eff.get(established.shotId)!, n = eff.get(c.shotId)!;
      const moved = c.line && c.line.some((id) => {
        const before = people(project, e).find((p) => p.id === id), after = people(project, n).find((p) => p.id === id);
        return !before || !after || Math.hypot(before.end[0] - after.start[0], before.end[2] - after.start[2]) > COVERAGE.redraw || Math.hypot(before.start[0] - before.end[0], before.start[2] - before.end[2]) > COVERAGE.redraw;
      });
      if (!bridge && !moved) {
        const [a, b] = c.line!.map((id) => name(project, id));
        findings.push({ at: `${established.number}→${c.number}`, rule: 'C1', severity: 'error', message: `crosses the line between ${a} and ${b} with no shot on the line, insert or movement between.` });
      }
    }
    established = c.moving && c.endSide ? { ...c, side: c.endSide } : c;
    bridge = c.moving && c.endSide !== undefined && c.endSide !== c.side ? `${c.number} moves across` : '';
  }

  for (const [i, b] of shots.entries()) {
    const a = shots[i - 1];
    if (!a || sceneOf.get(a.shotId) !== sceneOf.get(b.shotId)) continue;
    const at = `${a.number}→${b.number}`;
    const changed = changes(a, b);
    const sizeSteps = Math.abs(SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
    if (a.subject && a.subject === b.subject && sameSet(a.visible, b.visible) && angleDiff(a.bearing, b.bearing) < COVERAGE.angle && sizeSteps < 2) {
      findings.push({ at, rule: 'C4', severity: 'error', message: `jump cut: same framing of ${name(project, a.subject)} (${a.size}→${b.size}, ${Math.round(angleDiff(a.bearing, b.bearing))}° apart). Change the angle by 30° or more, or the size by two steps.` });
    } else if (changed.length < 2) {
      findings.push({ at, rule: 'C3', severity: 'warning', message: `only ${changed.length ? changed.join(' and ') : 'nothing'} changes; change at least two of subject, size, angle, height, lens, movement (or say why not).` });
    }
  }

  // C7: a single (or over-the-shoulder) of one lead should match the latest one of the other lead
  // at about the same size (an establishing wide and a closeup aren't a pair).
  for (const [i, b] of shots.entries()) {
    if (!b.line || (b.kind !== 'single' && b.kind !== 'ots') || !b.line.includes(b.subject!)) continue;
    const other = b.line.find((id) => id !== b.subject);
    const a = shots.slice(0, i).reverse().find((x) => sceneOf.get(x.shotId) === sceneOf.get(b.shotId) && x.kind === b.kind && x.subject === other && Math.abs(SIZE_ORDER.indexOf(x.size) - SIZE_ORDER.indexOf(b.size)) <= 1);
    if (!a) continue;
    const diffs: string[] = [];
    if (a.size !== b.size) diffs.push(`size ${a.size}/${b.size}`);
    if (Math.max(a.lens, b.lens) / Math.min(a.lens, b.lens) > COVERAGE.match.lensRatio) diffs.push(`lens ${Math.round(a.lens)}/${Math.round(b.lens)} mm`);
    if (Math.abs(a.elevation - b.elevation) > COVERAGE.match.height) diffs.push(`height ${Math.round(a.elevation)}°/${Math.round(b.elevation)}°`);
    if (diffs.length) findings.push({ at: `${a.number}/${b.number}`, rule: 'C7', severity: 'info', message: `the ${b.kind === 'ots' ? 'over-the-shoulder' : 'single'} reverses don't match (${diffs.join(', ')}); fine if the imbalance is deliberate (tension rising, a power shift).` });
  }
  const order: Severity[] = ['error', 'warning', 'info'];
  return { shots, findings: findings.sort((x, y) => order.indexOf(x.severity) - order.indexOf(y.severity)) };
}

/** One line per shot, for the model: "MCU single on Ben, left of Nora→Ben, eye 3°, 50 mm, fixed". */
export function describeCoverage(project: Project, c: ShotCoverage): string {
  const rest = c.visible.filter((v) => v !== c.subject).map((v) => name(project, v)).join(', ');
  const who = c.kind === 'insert' ? `${c.size} insert, nobody in frame` : c.kind === 'single' ? `${c.size} single on ${name(project, c.subject)}` : c.kind === 'ots' ? `${c.size} on ${name(project, c.subject)} over ${rest}` : `${c.size} on ${name(project, c.subject)} with ${rest}`;
  const side = c.side === undefined ? '' : c.side === 0 ? ', on the line' : `, ${c.side > 0 ? 'left' : 'right'} of ${c.line!.map((id) => name(project, id)).join('→')}`;
  const end = c.moving && c.endSide !== undefined && c.endSide !== c.side ? ` (ends ${c.endSide === 0 ? 'on the line' : c.endSide > 0 ? 'left' : 'right'})` : '';
  return `${who}${side}${end}, ${c.height} ${Math.round(c.elevation)}°, ${Math.round(c.lens)} mm, ${c.moving ? 'moving' : 'fixed'}`;
}

export function formatFindings(findings: Finding[]): string {
  return findings.map((f) => `${f.at} ${f.rule} ${f.severity}: ${f.message}`).join('\n');
}
