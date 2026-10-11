import { getSetting, setSetting } from '../storage/db';
import { newId } from '../state/schema';
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
}

export async function listWorkflows(category?: WorkflowCategory): Promise<ComfyWorkflow[]> {
  const all = (await getSetting<ComfyWorkflow[]>(COMFY_WORKFLOWS_SETTING)) ?? [];
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
