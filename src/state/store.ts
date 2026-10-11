import { create } from 'zustand';
import { emptyHistory, redo, runCommand, undo, type Command, type History } from './commands';
import type { Project, Step } from './schema';
import { saveProject } from '../storage/db';

const AUTOSAVE_MS = 500;

interface ProjectState {
  project: Project | null;
  history: History;
  saving: 'idle' | 'pending' | 'saved' | 'error';
  open: (project: Project) => void;
  close: () => Promise<void>;
  dispatch: (cmd: Command) => void;
  /** Records the current step. Saved, but not part of undo history. */
  setStep: (step: Step) => void;
  undo: () => void;
  redo: () => void;
  /** Undoes every most-recent entry carrying `tag`. Returns how many were undone. */
  undoTag: (tag: string) => number;
  flush: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useProjectStore = create<ProjectState>((set, get) => {
  const scheduleSave = () => {
    set({ saving: 'pending' });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flush(), AUTOSAVE_MS);
  };

  return {
    project: null,
    history: emptyHistory(),
    saving: 'idle',

    open: (project) => {
      clearTimeout(saveTimer);
      set({ project, history: emptyHistory(), saving: 'idle' });
    },

    close: async () => {
      await get().flush();
      set({ project: null, history: emptyHistory(), saving: 'idle' });
    },

    dispatch: (cmd) => {
      const { project, history } = get();
      if (!project) return;
      const [next, nextHistory] = runCommand(project, history, cmd);
      if (next === project) return;
      set({ project: next, history: nextHistory });
      scheduleSave();
    },

    setStep: (step) => {
      const { project } = get();
      if (!project || project.step === step) return;
      set({ project: { ...project, step } });
      scheduleSave();
    },

    undo: () => {
      const { project, history } = get();
      if (!project || !history.past.length) return;
      const [next, h] = undo(project, history);
      set({ project: next, history: h });
      scheduleSave();
    },

    undoTag: (tag) => {
      let n = 0;
      while (get().history.past.at(-1)?.tag === tag) {
        get().undo();
        n++;
      }
      return n;
    },

    redo: () => {
      const { project, history } = get();
      if (!project || !history.future.length) return;
      const [next, h] = redo(project, history);
      set({ project: next, history: h });
      scheduleSave();
    },

    flush: async () => {
      clearTimeout(saveTimer);
      const { project, saving } = get();
      if (!project || saving !== 'pending') return;
      try {
        await saveProject(project);
        if (get().project === project) set({ saving: 'saved' });
      } catch (err) {
        console.error('Autosave failed', err);
        set({ saving: 'error' });
      }
    },
  };
});

// Save before the tab is hidden or closed (mobile browsers may kill it without warning).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void useProjectStore.getState().flush();
  });
}
