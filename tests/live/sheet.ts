/**
 * A page for live tests: renders contact sheets with the app's own renderer
 * in a real browser (WebGL), driven from node by tests/live/browser.ts.
 */
import type { Project } from '../../src/state/schema';
import { renderContactSheet, type SheetMoment, type SheetView } from '../../src/export/contactSheet';

declare global {
  interface Window {
    renderSheet: (project: Project, shotIds: string[], moments: SheetMoment[], view?: SheetView) => Promise<string | null>;
  }
}

window.renderSheet = (project, shotIds, moments, view) => renderContactSheet(project, shotIds, moments, { view });
document.title = 'ready';
