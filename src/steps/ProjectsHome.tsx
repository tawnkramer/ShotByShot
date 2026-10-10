import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createProject, type Project } from '../state/schema';
import { deleteProject, listProjects, loadProject, saveProject, type ProjectSummary } from '../storage/db';
import { duplicateProject, exportProjectFile, importProjectFile, requestPersistentStorage } from '../storage/projectIO';
import { pickFile } from '../shell/download';

const STALE_EXPORT_MS = 7 * 24 * 3600 * 1000;

export function ProjectsHome() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listProjects().then(setProjects, (e) => setError(String(e)));
  }, []);
  useEffect(refresh, [refresh]);

  const openProject = (p: Pick<Project, 'id' | 'step'>) => navigate(`/p/${p.id}/${p.step}`);

  const onNew = async () => {
    const name = window.prompt('Project name', 'Untitled film');
    if (name === null) return;
    const project = createProject(name.trim() || 'Untitled film');
    await saveProject(project);
    void requestPersistentStorage();
    openProject(project);
  };

  const onOpenFile = async () => {
    const file = await pickFile('.zip,.json,application/zip,application/json');
    if (!file) return;
    try {
      openProject(await importProjectFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onAction = async (summary: ProjectSummary, action: string) => {
    setError(null);
    if (action === 'duplicate') await duplicateProject(summary.id);
    if (action === 'export') {
      const project = await loadProject(summary.id);
      if (project) await exportProjectFile(project);
    }
    if (action === 'delete' && window.confirm(`Delete "${summary.name}" from this browser? This can't be undone.`)) {
      await deleteProject(summary.id);
    }
    refresh();
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-side" />
        <div className="header-title">
          <strong>ShotByShot</strong>
        </div>
        <div className="header-side right">
          <Link className="btn ghost" to="/settings" aria-label="Settings">
            Settings
          </Link>
        </div>
      </header>
      <main className="body">
        <div className="page">
          <div className="row gap">
            <button className="btn primary grow" onClick={onNew}>
              New project
            </button>
            <button className="btn grow" onClick={onOpenFile}>
              Open file…
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {projects === null ? (
            <p className="muted">Loading…</p>
          ) : projects.length === 0 ? (
            <div className="empty">
              <p>No projects yet.</p>
              <p className="muted small">
                Projects are saved in this browser. Use <em>Save project file</em> to keep a copy or move it to another device.
              </p>
            </div>
          ) : (
            <ul className="list">
              {projects.map((p) => {
                const stale = !p.lastExportedAt || Date.now() - p.lastExportedAt > STALE_EXPORT_MS;
                return (
                  <li key={p.id} className="card">
                    <button className="card-main" onClick={() => loadProject(p.id).then((full) => full && openProject(full))}>
                      <span className="card-title">{p.name}</span>
                      <span className="muted small">
                        {p.aspect} · edited {new Date(p.updatedAt).toLocaleString()}
                        {stale && ' · no recent backup'}
                      </span>
                    </button>
                    <select
                      className="card-menu"
                      aria-label={`Actions for ${p.name}`}
                      value=""
                      onChange={(e) => void onAction(p, e.target.value)}
                    >
                      <option value="" disabled>
                        ⋯
                      </option>
                      <option value="export">Save project file</option>
                      <option value="duplicate">Duplicate</option>
                      <option value="delete">Delete</option>
                    </select>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
