import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { addChat, deleteProject, listChat, listProjects, loadProject, resetDbForTests, saveProject } from '../src/storage/db';
import { createProject } from '../src/state/schema';
import { referencedBlobKeys } from '../src/storage/projectIO';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

describe('IndexedDB storage', () => {
  it('saves, lists, loads and deletes projects with their chat', async () => {
    const a = { ...createProject('Older'), updatedAt: 1 };
    const b = { ...createProject('Newer'), updatedAt: 2 };
    await saveProject(a);
    await saveProject(b);
    expect((await listProjects()).map((p) => p.name)).toEqual(['Newer', 'Older']);
    expect(await loadProject(a.id)).toEqual(a);

    await addChat({ id: 'm1', projectId: a.id, role: 'user', step: 'story', text: 'hi', createdAt: 1 });
    expect(await listChat(a.id)).toHaveLength(1);

    await deleteProject(a.id);
    expect(await loadProject(a.id)).toBeUndefined();
    expect(await listChat(a.id)).toHaveLength(0);
    expect(await listProjects()).toHaveLength(1);
  });
});

describe('referencedBlobKeys', () => {
  it('finds blob references anywhere in the project', () => {
    const p = createProject('Assets');
    p.stages.push({ objects: [{ source: { kind: 'asset', blob: 'model1' } }] });
    p.shots.push({ thumbBlob: 'thumb1', dialogue: [{ audioBlob: 'clip1' }] });
    expect(referencedBlobKeys(p).sort()).toEqual(['clip1', 'model1', 'thumb1']);
  });
});
