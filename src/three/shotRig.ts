import * as THREE from 'three';
import { bodyPosition } from '../shots/body';
import type { CameraState, Project, StageObject } from '../state/schema';
import { effectiveShot, type EffectiveShot } from '../shots/setup';
import { lerpCamera, lerpPlacement, sample, sampleActor } from '../shots/timing';
import { buildStatic } from './library';
import { loadAsset } from './assets';
import { applyGrey, disposeObject } from './materials';
import { applyPose, applyWalkCycle, buildMannequin } from './mannequin';

interface Item {
  sig: string;
  object: THREE.Object3D;
  /** Last pose applied to a mannequin, to skip redundant work. */
  pose?: string;
}

/** Ids for things in a shot, used for selection: `actor:<characterId>`, `prop:<shotPropId>`, `stage:<objectId>`. */
export type RigId = `actor:${string}` | `prop:${string}` | `stage:${string}`;

const deg = THREE.MathUtils.degToRad;

/**
 * Builds and poses everything in one shot: the stage (with this shot's
 * changes), characters and props. Rebuilds only what changed between syncs,
 * so it's cheap to call on every edit. `setTime` poses everything at a point
 * in the shot and returns the camera there.
 */
export class ShotRig {
  readonly root = new THREE.Group();
  private items = new Map<RigId, Item>();
  private project: Project | null = null;
  private eff: EffectiveShot | null = null;
  private loading = 0;
  /** What the latest sync wants for each id, so late-arriving models can tell if they're stale. */
  private desired = new Map<RigId, string>();
  /** Called when an async model finishes loading. */
  onChange?: () => void;

  sync(project: Project, shotId: string): void {
    this.project = project;
    this.eff = effectiveShot(project, shotId) ?? null;
    const wanted = new Map<RigId, { sig: string; build: () => THREE.Object3D | Promise<THREE.Object3D> }>();
    const eff = this.eff;
    if (!eff) return this.prune(wanted);

    const stage = project.stages.find((s) => s.id === eff.stageId);
    for (const o of stage?.objects ?? []) {
      wanted.set(`stage:${o.id}`, { sig: JSON.stringify([o.source, o.grey]), build: () => buildObject(o.source, o.grey) });
    }
    for (const a of eff.setup.actors) {
      const c = project.characters.find((x) => x.id === a.characterId);
      if (!c) continue;
      wanted.set(`actor:${c.id}`, { sig: JSON.stringify([c.heightCm, c.sex, c.build, c.tint]), build: () => buildMannequin(c) });
    }
    for (const p of eff.setup.props) {
      const prop = project.props.find((x) => x.id === p.propId);
      if (!prop) continue;
      wanted.set(`prop:${p.id}`, { sig: JSON.stringify([prop.source, prop.grey]), build: () => buildObject(prop.source, prop.grey) });
    }

    this.desired = new Map([...wanted].map(([id, w]) => [id, w.sig]));
    for (const [id, w] of wanted) {
      const have = this.items.get(id);
      if (have?.sig === w.sig) continue;
      const built = w.build();
      if (built instanceof Promise) {
        this.loading++;
        built.then(
          (obj) => {
            this.loading--;
            if (this.desired.get(id) !== w.sig || this.items.get(id)?.sig === w.sig) return disposeObject(obj);
            this.replace(id, { sig: w.sig, object: obj });
            this.applyStatic();
            this.onChange?.();
          },
          (err) => {
            this.loading--;
            console.warn('Model failed to load', err);
          },
        );
      } else {
        this.replace(id, { sig: w.sig, object: built });
      }
    }
    this.prune(wanted);
    this.applyStatic();
  }

  /** True while imported models are still loading. */
  get busy(): boolean {
    return this.loading > 0;
  }

  /** Resolves once every model in the shot has loaded. */
  async ready(): Promise<void> {
    while (this.loading > 0) await new Promise((r) => setTimeout(r, 30));
  }

  object(id: RigId): THREE.Object3D | undefined {
    return this.items.get(id)?.object;
  }

  idOf(object: THREE.Object3D): RigId | undefined {
    for (let o: THREE.Object3D | null = object; o; o = o.parent) {
      if (o.userData.rigId) return o.userData.rigId as RigId;
    }
    return undefined;
  }

  /** Poses everything at progress u (0..1) and returns the camera there. `hold` is left alone (it's being dragged). */
  setTime(u: number, hold?: RigId | null): CameraState | null {
    const eff = this.eff;
    const project = this.project;
    if (!eff || !project) return null;
    const stage = project.stages.find((s) => s.id === eff.stageId);
    for (const a of eff.setup.actors) {
      const item = this.items.get(`actor:${a.characterId}`);
      const c = project.characters.find((x) => x.id === a.characterId);
      if (!item || !c || hold === `actor:${a.characterId}`) continue;
      const f = sampleActor(a.motion, u);
      // On the floor under them: a platform's top, or a stool's seat.
      item.object.position.set(...bodyPosition(stage, eff.setup.stageOverrides, c, f));
      item.object.rotation.set(0, deg(f.yaw), 0);
      if (f.walkPhase !== undefined) {
        applyWalkCycle(item.object, c, f.walkPhase);
        item.pose = 'walk';
      } else {
        const sig = f.joints ? `${f.pose}:${JSON.stringify(f.joints)}` : f.pose;
        if (item.pose !== sig) {
          applyPose(item.object, c, f.pose, f.joints);
          item.pose = sig;
        }
      }
    }
    for (const p of eff.setup.props) {
      const item = this.items.get(`prop:${p.id}`);
      const prop = project.props.find((x) => x.id === p.propId);
      if (!item || !prop || hold === `prop:${p.id}`) continue;
      const pl = sample(p.motion, u, lerpPlacement);
      item.object.position.set(...pl.position);
      item.object.rotation.set(0, deg(pl.yaw), 0);
      item.object.scale.setScalar(prop.defaultScale);
    }
    return sample(eff.camera, u, lerpCamera);
  }

  dispose(): void {
    this.desired.clear();
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  /** Stage objects don't move during a shot; place them once per sync. */
  private applyStatic(): void {
    const eff = this.eff;
    const project = this.project;
    if (!eff || !project) return;
    const stage = project.stages.find((s) => s.id === eff.stageId);
    for (const o of stage?.objects ?? []) {
      const item = this.items.get(`stage:${o.id}`);
      if (!item) continue;
      const ov = eff.setup.stageOverrides[o.id] ?? {};
      item.object.position.fromArray(ov.position ?? o.transform.position);
      item.object.quaternion.fromArray(ov.rotation ?? o.transform.rotation);
      item.object.scale.fromArray(ov.scale ?? o.transform.scale);
      item.object.visible = !ov.hidden;
    }
  }

  private replace(id: RigId, item: Item): void {
    this.remove(id);
    item.object.userData.rigId = id;
    this.items.set(id, item);
    this.root.add(item.object);
  }

  private remove(id: RigId): void {
    const old = this.items.get(id);
    if (!old) return;
    this.root.remove(old.object);
    disposeObject(old.object);
    this.items.delete(id);
  }

  private prune(wanted: Map<RigId, unknown>): void {
    for (const id of [...this.items.keys()]) if (!wanted.has(id)) this.remove(id);
  }
}

function buildObject(source: StageObject['source'], grey: number | undefined): THREE.Object3D | Promise<THREE.Object3D> {
  if (source.kind === 'asset') {
    return loadAsset(source.blob, source.format).then((o) => {
      applyGrey(o, grey);
      return o;
    });
  }
  const g = buildStatic(source);
  if (grey !== undefined) applyGrey(g, grey);
  return g;
}

