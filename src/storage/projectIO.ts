import { encodeProjectZip, decodeProjectFile, asImportedCopy, safeFileName, PROJECT_FILE_EXT, encodeProjectJson } from './projectFile';
import { getBlob, listProjects, loadProject, markExported, putBlob, saveProject } from './db';
import { saveFile } from '../shell/download';
import { newId, type Project } from '../state/schema';

/** Blob keys referenced by a project. Later milestones add assets, audio and thumbnails here. */
export function referencedBlobKeys(project: Project): string[] {
  const keys = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if ((k === 'blob' || k.endsWith('Blob')) && typeof v === 'string') keys.add(v);
        else visit(v);
      }
    }
  };
  visit(project);
  return [...keys];
}

export async function exportProjectFile(project: Project): Promise<string> {
  const assets = new Map<string, Uint8Array>();
  for (const key of referencedBlobKeys(project)) {
    const blob = await getBlob(key);
    if (blob) assets.set(key, new Uint8Array(await blob.arrayBuffer()));
  }
  const bytes = encodeProjectZip({ project, assets });
  const result = await saveFile(bytes as BlobPart, safeFileName(project.name) + PROJECT_FILE_EXT, 'application/zip');
  if (result !== 'cancelled') await markExported(project.id);
  return result;
}

export async function exportProjectJson(project: Project): Promise<void> {
  await saveFile(encodeProjectJson(project), safeFileName(project.name) + '.json', 'application/json');
}

export async function importProjectFile(file: File): Promise<Project> {
  const { project, assets } = decodeProjectFile(new Uint8Array(await file.arrayBuffer()));
  for (const [key, data] of assets) await putBlob(key, new Blob([data as BlobPart]));
  const existing = new Set((await listProjects()).map((p) => p.id));
  const imported = asImportedCopy(project, existing);
  await saveProject(imported);
  return imported;
}

export async function duplicateProject(id: string): Promise<Project | undefined> {
  const original = await loadProject(id);
  if (!original) return undefined;
  const now = Date.now();
  const copy: Project = { ...structuredClone(original), id: newId(), name: `${original.name} copy`, createdAt: now, updatedAt: now };
  await saveProject(copy);
  return copy;
}

/** Asks the browser not to evict our storage. Best effort; iOS mostly decides by Home Screen install. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
