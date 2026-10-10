import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import type { Project } from './schema';

enablePatches();

/** Every change to a project, from the UI or the assistant, is a Command. */
export interface Command {
  label: string;
  source?: 'user' | 'ai';
  /**
   * Commands with the same key in quick succession (e.g. dragging a slider)
   * become a single undo step.
   */
  mergeKey?: string;
  apply: (draft: Draft<Project>) => void;
}

export const MERGE_WINDOW_MS = 1500;

export interface HistoryEntry {
  label: string;
  source: 'user' | 'ai';
  patches: Patch[];
  inverse: Patch[];
  mergeKey?: string;
  time?: number;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const MAX_HISTORY = 200;

export function emptyHistory(): History {
  return { past: [], future: [] };
}

export function runCommand(project: Project, history: History, cmd: Command): [Project, History] {
  const [next, patches, inverse] = produceWithPatches(project, (d) => {
    cmd.apply(d);
    d.updatedAt = Date.now();
  });
  // A command that only touched updatedAt changed nothing worth undoing.
  if (patches.every((p) => p.path[0] === 'updatedAt')) return [project, history];
  const now = Date.now();
  const last = history.past.at(-1);
  if (cmd.mergeKey && last?.mergeKey === cmd.mergeKey && now - (last.time ?? 0) < MERGE_WINDOW_MS && !history.future.length) {
    const merged: HistoryEntry = { ...last, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], time: now };
    return [next, { past: [...history.past.slice(0, -1), merged], future: [] }];
  }
  const entry: HistoryEntry = { label: cmd.label, source: cmd.source ?? 'user', patches, inverse, mergeKey: cmd.mergeKey, time: now };
  return [next, { past: [...history.past, entry].slice(-MAX_HISTORY), future: [] }];
}

export function undo(project: Project, history: History): [Project, History] {
  const entry = history.past.at(-1);
  if (!entry) return [project, history];
  return [
    applyPatches(project, entry.inverse),
    { past: history.past.slice(0, -1), future: [entry, ...history.future] },
  ];
}

export function redo(project: Project, history: History): [Project, History] {
  const entry = history.future[0];
  if (!entry) return [project, history];
  return [applyPatches(project, entry.patches), { past: [...history.past, entry], future: history.future.slice(1) }];
}
