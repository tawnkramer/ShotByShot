import { getSetting, setSetting } from '../storage/db';
import { newId } from '../state/schema';
import seedance from './presets/seedance25_reference.json';
import { analyzeWorkflow, parseWorkflow, type InputRef, type WorkflowCategory, type WorkflowGraph } from './workflow';

export const COMFY_WORKFLOWS_SETTING = 'comfy.workflows';

/** An imported workflow. Kept in this browser's settings, never in project files. */
export interface ComfyWorkflow {
  id: string;
  name: string;
  category: WorkflowCategory;
  graph: WorkflowGraph;
  /** Chosen prompt input; the analysis default is used when unset. */
  promptTarget?: InputRef;
  importedAt: number;
  /** Ships with the app; can't be renamed or removed. */
  builtin?: boolean;
}

/** Seedance 2.5 reference-to-video, a Comfy partner node billed in Comfy credits. Accepts image, video and audio references. */
export const BUILTIN_WORKFLOWS: ComfyWorkflow[] = [
  { id: 'builtin:seedance-2.5-reference', name: 'Seedance 2.5 reference to video', category: 'video', graph: seedance as unknown as WorkflowGraph, importedAt: 0, builtin: true },
];

/** Imported workflows only; pass `withBuiltins` to include the ones that ship with the app first. */
export async function listWorkflows(category?: WorkflowCategory, withBuiltins = false): Promise<ComfyWorkflow[]> {
  const all = [...(withBuiltins ? BUILTIN_WORKFLOWS : []), ...(await getSetting<ComfyWorkflow[]>(COMFY_WORKFLOWS_SETTING)) ?? []];
  return category ? all.filter((w) => w.category === category) : all;
}

export async function saveWorkflows(workflows: ComfyWorkflow[]): Promise<void> {
  await setSetting(COMFY_WORKFLOWS_SETTING, workflows);
}

export function importWorkflow(text: string, fileName: string, category: WorkflowCategory): ComfyWorkflow {
  const graph = parseWorkflow(text);
  analyzeWorkflow(graph);
  return { id: newId(), name: fileName.replace(/\.json$/i, '') || 'Workflow', category, graph, importedAt: Date.now() };
}
