import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useProjectStore } from '../state/store';
import { STEPS, type Step } from '../state/schema';
import { loadProject } from '../storage/db';
import { Header } from './Header';
import { ChatBar } from './ChatBar';
import { StepView } from '../steps/StepView';

export function ProjectLayout() {
  const { projectId = '', step = '' } = useParams();
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project);
  const open = useProjectStore((s) => s.open);
  const setStep = useProjectStore((s) => s.setStep);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (project?.id === projectId) return;
    let cancelled = false;
    void useProjectStore
      .getState()
      .close()
      .then(() => loadProject(projectId))
      .then((p) => {
        if (cancelled) return;
        if (p) open(p);
        else setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, project?.id, open]);

  const validStep = (STEPS as readonly string[]).includes(step);

  // Remember the current step so reopening the project lands here.
  useEffect(() => {
    if (project?.id === projectId && validStep) setStep(step as Step);
  }, [project?.id, projectId, step, validStep, setStep]);

  if (missing) return <Navigate to="/" replace />;
  if (!validStep) return <Navigate to={`/p/${projectId}/story`} replace />;
  if (!project || project.id !== projectId) return <div className="app center muted">Loading project…</div>;

  const current = step as Step;
  const goTo = (s: Step) => navigate(`/p/${projectId}/${s}`);

  return (
    <div className="app">
      <Header step={current} onStep={goTo} />
      <main className="body" key={current}>
        <StepView step={current} />
      </main>
      <ChatBar step={current} projectId={projectId} />
    </div>
  );
}
