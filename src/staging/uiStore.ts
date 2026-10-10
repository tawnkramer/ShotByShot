import { create } from 'zustand';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

interface StagingUI {
  stageId: string | null;
  selectedId: string | null;
  mode: GizmoMode;
  snap: boolean;
  setStage: (id: string | null) => void;
  select: (id: string | null) => void;
  setMode: (mode: GizmoMode) => void;
  toggleSnap: () => void;
}

/** View state for the Staging step. Not saved with the project. */
export const useStagingUI = create<StagingUI>((set) => ({
  stageId: null,
  selectedId: null,
  mode: 'translate',
  snap: true,
  setStage: (stageId) => set({ stageId, selectedId: null }),
  select: (selectedId) => set({ selectedId }),
  setMode: (mode) => set({ mode }),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
}));
