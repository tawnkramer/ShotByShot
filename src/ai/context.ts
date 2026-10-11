import type { Project, Step } from '../state/schema';
import { ASPECT_RATIOS, PROP_ITEMS, SET_ITEMS, PRIMITIVE_SHAPES } from '../state/schema';
import { buildSequence } from '../shots/sequence';
import { effectiveShots, shotLines, summaryLine } from '../shots/setup';
import { keyOf } from '../shots/timing';
import { eulerDegrees } from '../staging/commands';
import { worldRect } from '../staging/placement';
import { LIBRARY, PRIMITIVES, resolveParams } from '../three/library';
import { spokenLines, linesNeedingAudio } from '../audio/clips';

const r = (n: number) => Math.round(n * 100) / 100;
const MAX_LINES = 600;

export const STEP_GUIDE: Record<Step, string> = {
  story: 'The user is labelling script lines and breaking the script into shots. Fix labels with set_line_types. For a breakdown, think like an editor: group quick dialogue exchanges, cut on speaker changes for weight, give action beats their own shots, start each scene with an establishing shot. Then call set_shot_breaks.',
  staging: 'The user is building grey-box sets. Lay out realistic rooms with real dimensions (a bar counter ~1.05 m high, tables ~0.75 m, doors ~2.1 m). Keep walkways clear. If given a photo or sketch, estimate the room size first, then place objects in room coordinates. Check your work with snapshot when placing many things.',
  characters: 'The user is defining characters: sex, height, build, age, notes, and voice. Choose voices that fit each character, and describe a speaking style when useful.',
  props: 'The user is making props. To model a prop, build it from simple shapes with model_prop at real-world size, front facing +Z, resting on the floor; combine several parts for recognizable silhouettes.',
  shots: 'The user is working on shots. In the shot editor, block characters (place_characters), frame the camera (frame_camera / set_camera), and make things move by setting an "end" keyframe. Keep characters out of furniture: check the stage objects and their footprints.',
  previs: 'The user is watching the whole film in sequence. Offer to adjust shots (open_shot) or the breakdown.',
  export: 'The user is exporting the film. Help with settings questions; open shots to fix problems they notice.',
};

/** A compact description of what the user is looking at, for the system prompt. */
export function describeContext(project: Project, step: Step, opts: { shotId?: string; stageId?: string }): string {
  const aspect = ASPECT_RATIOS.find((a) => a.id === project.aspect)!;
  const out: string[] = [`Project "${project.name}", aspect ${aspect.label}. Current step: ${step}${opts.shotId ? ' (shot editor)' : ''}.`];
  const seq = buildSequence(project);
  out.push(`Counts: ${project.script.length} lines, ${project.shots.length} shots (${Math.round(seq.total)} s), ${project.stages.length} stages, ${project.characters.length} characters, ${project.props.length} props.`);

  if (step === 'story') {
    out.push('Script (line number [type] text):');
    for (const [i, l] of project.script.slice(0, MAX_LINES).entries()) out.push(`${i + 1} [${l.type}] ${l.text.slice(0, 160)}`);
    if (project.script.length > MAX_LINES) out.push(`… ${project.script.length - MAX_LINES} more lines not shown.`);
    out.push('Shots (number: first-last line):');
    const index = new Map(project.script.map((l, i) => [l.id, i + 1]));
    out.push(project.shots.map((s) => `${s.number}: ${index.get(s.lineIds[0])}-${index.get(s.lineIds.at(-1)!)}`).join(', '));
  }

  if (step === 'staging') {
    out.push(`Stages: ${project.stages.map((s) => `"${s.name}"${s.id === opts.stageId ? ' (current)' : ''}`).join(', ') || 'none'}.`);
    const stage = project.stages.find((s) => s.id === opts.stageId) ?? project.stages[0];
    if (stage) out.push(describeStage(stage));
    out.push(libraryText());
    const scenes = project.script.map((l, i) => (l.type === 'scene' ? `${i + 1}: ${l.text}` : '')).filter(Boolean);
    if (scenes.length) out.push(`Scene headings (line: text): ${scenes.join(' | ')}`);
  }

  if (step === 'characters' || step === 'shots') {
    out.push('Characters: ' + (project.characters.map((c) => `${c.name} (${c.sex}, ${c.heightCm} cm, ${c.build}${c.ageBand ? `, ${c.ageBand}` : ''}, voice ${c.voice.voiceId}${c.voice.instructions ? ` "${c.voice.instructions}"` : ''}${c.attributes.length ? `, notes: ${c.attributes.join('; ')}` : ''})`).join('; ') || 'none') + '.');
    const { unassigned } = spokenLines(project);
    const needed = linesNeedingAudio(project).length;
    if (needed || unassigned) out.push(`Dialogue audio: ${needed} lines need voicing; ${unassigned} lines are spoken by names that aren't characters.`);
  }

  if (step === 'props' || step === 'shots') {
    out.push('Props: ' + (project.props.map((p) => `${p.name} (${p.source.kind === 'library' ? p.source.item : p.source.kind}${p.defaultScale !== 1 ? `, ×${p.defaultScale}` : ''})`).join(', ') || 'none') + '.');
    if (step === 'props') out.push(`Library props: ${PROP_ITEMS.join(', ')}.`);
  }

  if (step === 'shots' && opts.shotId) {
    const shot = project.shots.find((s) => s.id === opts.shotId);
    const eff = shot && effectiveShots(project).get(shot.id);
    if (shot && eff) {
      const stage = project.stages.find((s) => s.id === eff.stageId);
      out.push(`Open shot ${shot.number}, ${eff.durationSec.toFixed(1)} s${shot.durationLocked ? ' (set by hand)' : ''}, stage "${stage?.name ?? 'none'}".`);
      out.push('Script lines in this shot:\n' + shotLines(project, shot).map((l) => `[${l.type}] ${l.text}`).join('\n'));
      if (stage) out.push(describeStage(stage, eff.setup.stageOverrides));
      out.push('Characters in shot: ' + (eff.setup.actors.map((a) => {
        const c = project.characters.find((x) => x.id === a.characterId);
        const s = a.motion.start, e = a.motion.mode === 'moving' ? keyOf(a.motion, 'end') : null;
        const fmt = (k: typeof s) => `x=${r(k.position[0])} z=${r(k.position[2])} yaw=${Math.round(k.yaw)} ${k.pose}`;
        return `${c?.name}: start ${fmt(s)}${e ? `; end ${fmt(e)}` : ''}`;
      }).join('; ') || 'none') + '.');
      if (eff.setup.props.length) out.push('Props in shot: ' + eff.setup.props.map((p) => `${project.props.find((x) => x.id === p.propId)?.name} at x=${r(p.motion.start.position[0])} y=${r(p.motion.start.position[1])} z=${r(p.motion.start.position[2])}`).join('; ') + '.');
      const cam = (k: typeof eff.camera.start) => `target [${k.target.map(r).join(', ')}], orbit ${Math.round(k.azimuth)}°, tilt ${Math.round(k.elevation)}°, distance ${r(k.distance)} m, lens ${Math.round(k.lens)} mm`;
      out.push(`Camera (${eff.camera.mode === 'moving' ? 'moving' : 'fixed'}): start ${cam(eff.camera.start)}${eff.camera.end && eff.camera.mode === 'moving' ? `; end ${cam(eff.camera.end)}` : ''}.`);
      out.push(`Stages available: ${project.stages.map((s) => s.name).join(', ')}.`);
    }
  } else if (step === 'shots' || step === 'previs' || step === 'export') {
    const eff = effectiveShots(project);
    out.push('Shots: ' + project.shots.map((s) => {
      const e = eff.get(s.id)!;
      return `${s.number} [${project.stages.find((x) => x.id === e.stageId)?.name ?? 'no stage'}, ${e.durationSec.toFixed(1)} s] ${summaryLine(project, s).slice(0, 70)}`;
    }).join('\n'));
  }
  return out.join('\n');
}

function describeStage(stage: Project['stages'][number], overrides: Record<string, { position?: [number, number, number]; hidden?: boolean }> = {}): string {
  if (!stage.objects.length) return `Stage "${stage.name}" is empty.`;
  const lines = stage.objects.map((o) => {
    const ov = overrides[o.id];
    const pos = ov?.position ?? o.transform.position;
    const rect = worldRect({ source: o.source, transform: { ...o.transform, position: pos } });
    const kind = o.source.kind === 'library' ? o.source.item : o.source.kind === 'primitive' ? o.source.shape : o.source.kind;
    const params = o.source.kind === 'library' || o.source.kind === 'primitive' ? Object.entries(resolveParams(o.source.kind === 'library' ? LIBRARY[o.source.item] : PRIMITIVES[o.source.shape], o.source.params)).map(([k, v]) => `${k}=${r(v)}`).join(' ') : '';
    const yaw = Math.round(eulerDegrees(o.transform)[1]);
    return `- ${o.name} (${kind}${params ? `; ${params}` : ''}) at x=${r(pos[0])} z=${r(pos[2])}${pos[1] ? ` y=${r(pos[1])}` : ''} yaw=${yaw}${o.transform.scale[0] !== 1 ? ` scale=${r(o.transform.scale[0])}` : ''}; footprint x ${r(rect.minX)}…${r(rect.maxX)}, z ${r(rect.minZ)}…${r(rect.maxZ)}${ov?.hidden ? ' (hidden in this shot)' : ''}`;
  });
  return `Stage "${stage.name}" objects:\n${lines.join('\n')}`;
}

function libraryText(): string {
  const item = (key: string, def: { label: string; params: { key: string; default: number }[] }) => `${key}${def.params.length ? ` (${def.params.map((p) => `${p.key}=${p.default}`).join(', ')})` : ''}`;
  return [
    `Set pieces: ${SET_ITEMS.map((k) => item(k, LIBRARY[k])).join('; ')}.`,
    `Props: ${PROP_ITEMS.map((k) => item(k, LIBRARY[k])).join('; ')}.`,
    `Shapes: ${PRIMITIVE_SHAPES.map((k) => item(k, PRIMITIVES[k])).join('; ')}.`,
    'Sizes are meters. Objects sit on the floor at their position; a room spans x ±width/2 and z ±depth/2 with walls at the back (-Z) and sides.',
  ].join('\n');
}

export function systemPrompt(project: Project, step: Step, opts: { shotId?: string; stageId?: string }): string {
  return [
    'You are the assistant inside ShotByShot, a mobile app for shot breakdown and previs: script → stages (grey-box sets) → characters → props → shots → previs → export.',
    'You change the project only with the tools given. Every change can be undone by the user. Prefer one tool call with many items over many calls. If a tool returns an error, fix the arguments and try again.',
    'World: meters, Y up. +Z is the front of the stage (where the audience/camera usually is), -Z is the back. +X is to the right when looking from the front. Yaw 0 faces +Z; 90 faces +X.',
    'Refer to lines by number, shots by number (1A), and everything else by its exact name.',
    "After acting, reply in one or two short sentences saying what you did. If the request needs another step's tools, use go_to_step or open_shot and say so. Don't invent features the app lacks.",
    STEP_GUIDE[step],
    '--- Current state ---',
    describeContext(project, step, opts),
  ].join('\n\n');
}
