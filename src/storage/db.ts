import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '../state/schema';

export interface ProjectSummary {
  id: string;
  name: string;
  aspect: string;
  updatedAt: number;
  lastExportedAt?: number;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  role: 'user' | 'assistant' | 'system';
  step: string;
  text: string;
  createdAt: number;
  /** Labels of the changes the assistant made in this reply. */
  actions?: string[];
  /** Tag on those changes in the undo history, so they can be undone together. */
  tag?: string;
  undone?: boolean;
  hasImage?: boolean;
  error?: boolean;
}

interface SbsDB extends DBSchema {
  projects: { key: string; value: Project };
  summaries: { key: string; value: ProjectSummary };
  blobs: { key: string; value: Blob };
  chat: { key: string; value: ChatMessage; indexes: { byProject: string } };
  settings: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<SbsDB>> | null = null;

export function db(): Promise<IDBPDatabase<SbsDB>> {
  dbPromise ??= openDB<SbsDB>('shotbyshot', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' });
      d.createObjectStore('summaries', { keyPath: 'id' });
      d.createObjectStore('blobs');
      d.createObjectStore('chat', { keyPath: 'id' }).createIndex('byProject', 'projectId');
      d.createObjectStore('settings');
    },
  });
  return dbPromise;
}

/** Test hook: forget the cached connection (used with fake-indexeddb). */
export function resetDbForTests(): void {
  dbPromise = null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await (await db()).getAll('summaries');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return (await db()).get('projects', id);
}

export async function saveProject(project: Project): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'summaries'], 'readwrite');
  const prev = await tx.objectStore('summaries').get(project.id);
  await tx.objectStore('projects').put(project);
  await tx.objectStore('summaries').put({
    id: project.id,
    name: project.name,
    aspect: project.aspect,
    updatedAt: project.updatedAt,
    lastExportedAt: prev?.lastExportedAt,
  });
  await tx.done;
}

export async function markExported(id: string): Promise<void> {
  const d = await db();
  const s = await d.get('summaries', id);
  if (s) await d.put('summaries', { ...s, lastExportedAt: Date.now() });
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'summaries', 'chat'], 'readwrite');
  await tx.objectStore('projects').delete(id);
  await tx.objectStore('summaries').delete(id);
  const chatIndex = tx.objectStore('chat').index('byProject');
  for await (const cursor of chatIndex.iterate(id)) await cursor.delete();
  await tx.done;
  // Blobs are content-addressed and may be shared between projects; orphaned
  // blobs are collected by a later cleanup pass rather than here.
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('settings', key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', value, key);
}

export async function deleteSetting(key: string): Promise<void> {
  await (await db()).delete('settings', key);
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await (await db()).put('blobs', blob, key);
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await db()).get('blobs', key);
}

export async function listChat(projectId: string): Promise<ChatMessage[]> {
  const all = await (await db()).getAllFromIndex('chat', 'byProject', projectId);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addChat(message: ChatMessage): Promise<void> {
  await (await db()).put('chat', message);
}
