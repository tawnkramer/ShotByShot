import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STEPS, STEP_LABELS, type Step } from '../state/schema';
import { useProjectStore } from '../state/store';
import { exportProjectFile } from '../storage/projectIO';
import { ProjectSettingsSheet } from './ProjectSettingsSheet';

interface Props {
  step: Step;
  onStep: (step: Step) => void;
  /** Replaces Next, e.g. Done in the shot editor. */
  primary?: { label: string; onClick: () => void };
  /** Replaces the back chevron's default (previous step). */
  onBack?: () => void;
}

export function Header({ step, onStep, primary, onBack }: Props) {
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project)!;
  const canUndo = useProjectStore((s) => s.history.past.length > 0);
  const canRedo = useProjectStore((s) => s.history.future.length > 0);
  const saving = useProjectStore((s) => s.saving);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const index = STEPS.indexOf(step);
  const prev = STEPS[index - 1];
  const next = STEPS[index + 1];

  const menu = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <header className="header">
      <div className="header-side">
        <button
          className="btn ghost icon"
          aria-label={prev ? `Back to ${STEP_LABELS[prev]}` : 'All projects'}
          onClick={() => (onBack ? onBack() : prev ? onStep(prev) : navigate('/'))}
        >
          ‹
        </button>
      </div>
      <div className="header-title">
        <strong>{STEP_LABELS[step]}</strong>
        <nav className="dots" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button
              key={s}
              className={`dot ${s === step ? 'current' : i < index ? 'done' : ''}`}
              aria-label={STEP_LABELS[s]}
              aria-current={s === step ? 'step' : undefined}
              onClick={() => onStep(s)}
            />
          ))}
        </nav>
      </div>
      <div className="header-side right">
        <button className="btn ghost icon" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          ⋯
        </button>
        {primary ? (
          <button className="btn primary" onClick={primary.onClick}>
            {primary.label}
          </button>
        ) : next ? (
          <button
            className="btn primary"
            disabled={step === 'story' && project.shots.length === 0}
            title={step === 'story' && project.shots.length === 0 ? 'Import a script first' : undefined}
            onClick={() => onStep(next)}
          >
            Next
          </button>
        ) : null}
      </div>
      {menuOpen && (
        <>
          <div className="scrim" onClick={() => setMenuOpen(false)} />
          <div className="menu" role="menu">
            <div className="menu-caption muted small">
              {project.name} · {saving === 'pending' ? 'Saving…' : saving === 'error' ? 'Save failed' : 'Saved in this browser'}
            </div>
            <button role="menuitem" disabled={!canUndo} onClick={menu(useProjectStore.getState().undo)}>
              Undo
            </button>
            <button role="menuitem" disabled={!canRedo} onClick={menu(useProjectStore.getState().redo)}>
              Redo
            </button>
            <button role="menuitem" onClick={menu(() => setSettingsOpen(true))}>
              Project settings
            </button>
            <button role="menuitem" onClick={menu(() => void useProjectStore.getState().flush().then(() => exportProjectFile(useProjectStore.getState().project!)))}>
              Save project file
            </button>
            <button role="menuitem" onClick={menu(() => navigate('/settings'))}>
              App settings
            </button>
            <button role="menuitem" onClick={menu(() => navigate('/'))}>
              All projects
            </button>
          </div>
        </>
      )}
      {settingsOpen && <ProjectSettingsSheet onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
