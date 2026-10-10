import * as THREE from 'three';
import type { Draft } from 'immer';
import type { Command } from '../state/commands';
import { newId, type ObjectSource, type Project, type ScriptLine, type Stage, type StageObject, type Transform } from '../state/schema';
import { itemDef } from '../three/library';

export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };

function findStage(d: Draft<Project>, stageId: string) {
  return d.stages.find((s) => s.id === stageId);
}

/** "INT. DOCKSIDE BAR - NIGHT" → "Dockside Bar" */
export function stageNameFromScene(heading: string): string {
  const core = heading
    .replace(/^(INT\.?\/EXT|EXT\.?\/INT|INT|EXT|EST|I\/E)[.\s]+/i, '')
    .split(/\s+[-–—]\s+/)[0]
    .trim();
  return core.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) || 'Stage';
}

/** Scene headings grouped by location, so "INT. BAR - NIGHT" and "INT. BAR - LATER" share a stage. */
export function scenesByLocation(script: ScriptLine[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const l of script) {
    if (l.type !== 'scene') continue;
    const name = stageNameFromScene(l.text);
    map.set(name, [...(map.get(name) ?? []), l.id]);
  }
  return map;
}

export function createStage(name: string, sceneLineIds: string[] = [], id = newId()): Command {
  return {
    label: `Create stage ${name}`,
    apply: (d) => {
      // A scene belongs to one stage.
      const taken = new Set(sceneLineIds);
      for (const s of d.stages) s.sceneLineIds = s.sceneLineIds.filter((l) => !taken.has(l));
      d.stages.push({ id, name, sceneLineIds, objects: [] });
    },
  };
}

/** One stage per location that doesn't have a stage yet. Returns the command and the new stage ids. */
export function createStagesForScenes(project: Project): { command: Command; ids: string[] } {
  const used = new Set(project.stages.flatMap((s) => s.sceneLineIds));
  const existingNames = new Map(project.stages.map((s) => [s.name.toLowerCase(), s.id]));
  const toCreate: Stage[] = [];
  const toLink: [string, string[]][] = [];
  for (const [name, lineIds] of scenesByLocation(project.script)) {
    const fresh = lineIds.filter((id) => !used.has(id));
    if (!fresh.length) continue;
    const existing = existingNames.get(name.toLowerCase());
    if (existing) toLink.push([existing, fresh]);
    else toCreate.push({ id: newId(), name, sceneLineIds: fresh, objects: [] });
  }
  return {
    ids: toCreate.map((s) => s.id),
    command: {
      label: 'Create stages for scenes',
      apply: (d) => {
        for (const [id, lines] of toLink) findStage(d, id)?.sceneLineIds.push(...lines);
        d.stages.push(...toCreate);
      },
    },
  };
}

export function renameStage(stageId: string, name: string): Command {
  return {
    label: 'Rename stage',
    apply: (d) => {
      const stage = findStage(d, stageId);
      if (stage) stage.name = name;
    },
  };
}

export function deleteStage(stageId: string): Command {
  return {
    label: 'Delete stage',
    apply: (d) => {
      d.stages = d.stages.filter((s) => s.id !== stageId);
      for (const shot of d.shots) if (shot.stageId === stageId) delete shot.stageId;
    },
  };
}

export function duplicateStage(stageId: string, newStageId = newId()): Command {
  return {
    label: 'Duplicate stage',
    apply: (d) => {
      const i = d.stages.findIndex((s) => s.id === stageId);
      if (i < 0) return;
      const src = d.stages[i];
      d.stages.splice(i + 1, 0, {
        id: newStageId,
        name: `${src.name} copy`,
        sceneLineIds: [],
        objects: src.objects.map((o) => ({ ...(JSON.parse(JSON.stringify(o)) as StageObject), id: newId() })),
      });
    },
  };
}

export function defaultName(source: ObjectSource): string {
  if (source.kind === 'asset') return source.fileName?.replace(/\.[^.]+$/, '') || 'Model';
  return itemDef(source).label;
}

/** Name with a number if the stage already has one: "Chair", "Chair 2", … */
export function uniqueName(objects: { name: string }[], base: string): string {
  const names = new Set(objects.map((o) => o.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

export function addObject(stageId: string, source: ObjectSource, transform: Transform = IDENTITY, id = newId(), name?: string): Command {
  return {
    label: `Add ${name ?? defaultName(source)}`,
    apply: (d) => {
      const stage = findStage(d, stageId);
      if (!stage) return;
      stage.objects.push({ id, name: uniqueName(stage.objects, name ?? defaultName(source)), transform: structuredClone(transform), source });
    },
  };
}

export type ObjectPatch = Partial<Pick<StageObject, 'name' | 'grey'>> & {
  transform?: Partial<Transform>;
  params?: Record<string, number>;
};

export function updateObject(stageId: string, objectId: string, patch: ObjectPatch, label = 'Edit object', mergeKey?: string): Command {
  return {
    label,
    mergeKey,
    apply: (d) => {
      const obj = findStage(d, stageId)?.objects.find((o) => o.id === objectId);
      if (!obj) return;
      if (patch.name !== undefined) obj.name = patch.name;
      if ('grey' in patch) {
        if (patch.grey === undefined) delete obj.grey;
        else obj.grey = patch.grey;
      }
      if (patch.transform) Object.assign(obj.transform, patch.transform);
      if (patch.params && obj.source.kind !== 'asset') obj.source.params = { ...obj.source.params, ...patch.params };
    },
  };
}

export function removeObject(stageId: string, objectId: string): Command {
  return {
    label: 'Delete object',
    apply: (d) => {
      const stage = findStage(d, stageId);
      if (stage) stage.objects = stage.objects.filter((o) => o.id !== objectId);
    },
  };
}

/** Copies an object, offset so the copy is visible next to the original. */
export function duplicateObject(stageId: string, objectId: string, newObjectId = newId()): Command {
  return {
    label: 'Duplicate object',
    apply: (d) => {
      const stage = findStage(d, stageId);
      const src = stage?.objects.find((o) => o.id === objectId);
      if (!stage || !src) return;
      const copy = JSON.parse(JSON.stringify(src)) as StageObject;
      copy.id = newObjectId;
      copy.name = uniqueName(stage.objects, src.name.replace(/ \d+$/, ''));
      copy.transform.position = [src.transform.position[0] + 0.5, src.transform.position[1], src.transform.position[2] + 0.5];
      stage.objects.push(copy);
    },
  };
}

// --- Transform helpers for the inspector (degrees, Y-up) ---

export function eulerDegrees(t: Transform): [number, number, number] {
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(t.rotation), 'YXZ');
  // "+ 0" turns -0 into 0.
  return [e.x, e.y, e.z].map((r) => round(THREE.MathUtils.radToDeg(r), 1) + 0) as [number, number, number];
}

export function quatFromDegrees([x, y, z]: [number, number, number]): Transform['rotation'] {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z), 'YXZ'));
  return [q.x, q.y, q.z, q.w];
}

export function round(v: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
