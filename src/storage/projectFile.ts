import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { migrateProject, newId, type Project } from '../state/schema';

/**
 * Project file format (`.sbs.zip`):
 *   project.json      the project document
 *   assets/<key>      binary assets (models, images, audio), keyed by content hash
 * A bare `project.json` (or any `.json`) can also be imported.
 */

export const PROJECT_FILE_EXT = '.sbs.zip';

export interface ProjectBundle {
  project: Project;
  assets: Map<string, Uint8Array>;
}

export function encodeProjectZip({ project, assets }: ProjectBundle): Uint8Array {
  const files: Zippable = {
    'project.json': [strToU8(JSON.stringify(project, null, 2)), { level: 6 }],
  };
  // Assets are usually already compressed (GLB, MP3, PNG), so store them as-is.
  for (const [key, data] of assets) files[`assets/${key}`] = [data, { level: 0 }];
  return zipSync(files);
}

export function encodeProjectJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function decodeProjectFile(bytes: Uint8Array): ProjectBundle {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  if (!isZip) {
    return { project: parseProjectJson(strFromU8(bytes)), assets: new Map() };
  }
  const entries = unzipSync(bytes);
  const json = entries['project.json'];
  if (!json) throw new Error('This zip has no project.json, so it isn\'t a ShotByShot project file.');
  const assets = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    if (path.startsWith('assets/') && path.length > 'assets/'.length) assets.set(path.slice(7), data);
  }
  return { project: parseProjectJson(strFromU8(json)), assets };
}

function parseProjectJson(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The file isn\'t valid JSON.');
  }
  return migrateProject(raw);
}

/** Gives an imported project a fresh id so it never overwrites an existing one. */
export function asImportedCopy(project: Project, existingIds: Set<string>): Project {
  if (!existingIds.has(project.id)) return project;
  return { ...project, id: newId(), name: `${project.name} (imported)`, updatedAt: Date.now() };
}

export function safeFileName(name: string): string {
  return name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'project';
}
