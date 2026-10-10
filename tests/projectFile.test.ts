import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { asImportedCopy, decodeProjectFile, encodeProjectJson, encodeProjectZip } from '../src/storage/projectFile';
import { createProject, SCHEMA_VERSION } from '../src/state/schema';

describe('project file', () => {
  it('round-trips a project and its assets through a zip', () => {
    const project = { ...createProject('Bar Fight'), aspect: '9:16' as const };
    const assets = new Map([['abc123', new Uint8Array([1, 2, 3, 4])]]);
    const decoded = decodeProjectFile(encodeProjectZip({ project, assets }));
    expect(decoded.project).toEqual(project);
    expect([...decoded.assets.keys()]).toEqual(['abc123']);
    expect([...decoded.assets.get('abc123')!]).toEqual([1, 2, 3, 4]);
  });

  it('imports a plain JSON project', () => {
    const project = createProject('Plain');
    const decoded = decodeProjectFile(strToU8(encodeProjectJson(project)));
    expect(decoded.project).toEqual(project);
    expect(decoded.assets.size).toBe(0);
  });

  it('rejects files that are not projects', () => {
    expect(() => decodeProjectFile(strToU8('not json'))).toThrow(/valid JSON/);
    expect(() => decodeProjectFile(zipSync({ 'readme.txt': strToU8('hi') }))).toThrow(/project.json/);
    expect(() => decodeProjectFile(strToU8(JSON.stringify({ name: 'x' })))).toThrow();
  });

  it('refuses projects from a newer schema', () => {
    const future = { ...createProject('Future'), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => decodeProjectFile(strToU8(JSON.stringify(future)))).toThrow(/newer version/);
  });

  it('gives an imported copy a new id only when the id is taken', () => {
    const project = createProject('Dup');
    expect(asImportedCopy(project, new Set())).toBe(project);
    const copy = asImportedCopy(project, new Set([project.id]));
    expect(copy.id).not.toBe(project.id);
    expect(copy.name).toBe('Dup (imported)');
  });
});
