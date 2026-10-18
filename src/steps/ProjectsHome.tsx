import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createProject, type Medium, type Project } from '../state/schema';
import { deleteProject, listProjects, loadProject, saveProject, type ProjectSummary } from '../storage/db';
import { duplicateProject, exportProjectFile, importProjectFile, requestPersistentStorage } from '../storage/projectIO';
import { pickFile } from '../shell/download';
import { Overlay } from '../shell/Overlay';

const STALE_EXPORT_MS = 7 * 24 * 3600 * 1000;

export function ProjectsHome() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    listProjects().then(setProjects, (e) => setError(String(e)));
  }, []);
  useEffect(refresh, [refresh]);

  const openProject = (p: Pick<Project, 'id' | 'step'>) => navigate(`/p/${p.id}/${p.step}`);

  const onCreate = async (name: string, medium: Medium) => {
    const project = createProject(name.trim() || (medium === 'comic' ? 'Untitled comic' : 'Untitled film'), medium);
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
            <button className="btn primary grow" onClick={() => setCreating(true)}>
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
                        {p.medium === 'comic' ? 'Comic' : p.aspect} · edited {new Date(p.updatedAt).toLocaleString()}
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
      {creating && <NewProjectSheet onCreate={(name, medium) => void onCreate(name, medium)} onClose={() => setCreating(false)} />}
    </div>
  );
}

const MEDIUM_INFO: Record<Medium, { label: string; note: string; placeholder: string }> = {
  film: { label: 'Film', note: 'Shots with movement, timing and voices. Plays as previs and exports video.', placeholder: 'Untitled film' },
  comic: { label: 'Comic', note: 'Panels: one frozen moment each, with balloons and captions. No timing or sound.', placeholder: 'Untitled comic' },
};

function NewProjectSheet({ onCreate, onClose }: { onCreate: (name: string, medium: Medium) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [medium, setMedium] = useState<Medium>('film');
  return (
    <Overlay>
      <div className="scrim" onClick={onClose} />
      <form className="sheet" role="dialog" aria-label="New project" onSubmit={(e) => { e.preventDefault(); onCreate(name, medium); }}>
        <div className="sheet-head">
          <strong>New project</strong>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} placeholder={MEDIUM_INFO[medium].placeholder} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span>Kind</span>
          <div className="segmented" role="radiogroup" aria-label="Kind of project">
            {(Object.keys(MEDIUM_INFO) as Medium[]).map((m) => (
              <button type="button" key={m} role="radio" aria-checked={medium === m} className={medium === m ? 'on' : ''} onClick={() => setMedium(m)}>
                {MEDIUM_INFO[m].label}
              </button>
            ))}
          </div>
          <p className="muted small">{MEDIUM_INFO[medium].note}</p>
        </div>
        <button className="btn primary">Create</button>
      </form>
    </Overlay>
  );
}
