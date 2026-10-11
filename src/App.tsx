import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProjectsHome } from './steps/ProjectsHome';
import { ProjectLayout } from './shell/ProjectLayout';
import { SettingsPage } from './shell/SettingsPage';
import { UpdateBanner } from './shell/UpdateBanner';
import { ErrorBoundary } from './shell/ErrorBoundary';

// HashRouter: GitHub Pages has no SPA fallback, so path URLs would 404 on reload.
export function App() {
  return (
    <HashRouter>
      <UpdateBanner />
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<ProjectsHome />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/p/:projectId/:step/:sub?" element={<ProjectLayout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </HashRouter>
  );
}
