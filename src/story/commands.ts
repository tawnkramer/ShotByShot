import { current } from 'immer';
import type { Command } from '../state/commands';
import { newId, type BreakdownMode, type LineType, type ScriptLine, type Shot } from '../state/schema';
import { classifyScript } from './classify';
import type { ShotNumbering } from './numbering';
import { breakdownScript, isFrontMatter, numberShots, reconcileShots, toggleBreakBefore } from './breakdown';

export function importScript(text: string): Command {
  return {
    label: 'Import script',
    apply: (d) => {
      d.script = classifyScript(text).map((l, i) => ({ id: newId(), index: i, text: l.text, type: l.type, confidence: l.confidence, ...(l.sceneNumber ? { sceneNumber: l.sceneNumber } : {}) }));
      d.shots = breakdownScript(d.script, d.breakdownMode, newId, d.shotNumbering);
    },
  };
}

export function applyBreakdown(mode: BreakdownMode): Command {
  return {
    label: 'Break down shots',
    apply: (d) => {
      d.breakdownMode = mode;
      d.shots = breakdownScript(d.script, mode, newId, d.shotNumbering);
    },
  };
}

export function setLineTypes(ids: string[], type: LineType): Command {
  const set = new Set(ids);
  return {
    label: ids.length > 1 ? `Mark ${ids.length} lines as ${type}` : `Mark line as ${type}`,
    apply: (d) => {
      for (const l of d.script) {
        if (set.has(l.id)) {
          l.type = type;
          l.confidence = 1;
        }
      }
      d.shots = attachOrphans(d.script, d.shots, d.shotNumbering);
    },
  };
}

export function editLineText(id: string, text: string): Command {
  return {
    label: 'Edit line',
    apply: (d) => {
      const line = d.script.find((l) => l.id === id);
      if (line) line.text = text;
    },
  };
}

export function deleteLines(ids: string[]): Command {
  const set = new Set(ids);
  return {
    label: ids.length > 1 ? `Delete ${ids.length} lines` : 'Delete line',
    apply: (d) => {
      d.script = d.script.filter((l) => !set.has(l.id)).map((l, i) => ({ ...l, index: i }));
      d.shots = reconcileShots(d.script, d.shots, d.shotNumbering);
    },
  };
}

export function toggleBreak(lineId: string): Command {
  return {
    label: 'Change shot break',
    apply: (d) => {
      d.shots = numberShots(d.script, toggleBreakBefore(current(d.shots), lineId, newId), d.shotNumbering);
    },
  };
}

/**
 * Story lines that aren't in any shot (for example a description relabelled as
 * action) join the nearest shot: the one that follows them, else the last one.
 */
export function attachOrphans(lines: ScriptLine[], shots: Shot[], style: ShotNumbering = 'scene.shot'): Shot[] {
  const inShot = new Set(shots.flatMap((s) => s.lineIds));
  const orphans = lines.filter((l) => !isFrontMatter(l) && !inShot.has(l.id));
  if (!orphans.length) return numberShots(lines, shots, style);
  const order = new Map(lines.map((l, i) => [l.id, i]));
  let result = shots.map((s) => ({ ...s, lineIds: [...s.lineIds] }));
  if (!result.length) result = [{ id: newId(), number: '', lineIds: [] }];
  for (const o of orphans) {
    const pos = order.get(o.id)!;
    const target = result.find((s) => s.lineIds.length && order.get(s.lineIds[0])! > pos) ?? result[result.length - 1];
    target.lineIds.push(o.id);
  }
  return reconcileShots(lines, result, style);
}

/** Switches the numbering style and renumbers every shot. */
export function setShotNumbering(style: ShotNumbering): Command {
  return {
    label: 'Change shot numbering',
    apply: (d) => {
      d.shotNumbering = style;
      // Start fresh so numbers from the old style aren't reused.
      d.shots = numberShots(current(d.script), current(d.shots).map((s) => ({ ...s, number: '' })), style) as typeof d.shots;
    },
  };
}
