import { create } from 'zustand';
import { useProjectStore } from '../state/store';
import { getSetting } from '../storage/db';
import { API_KEY_SETTING } from '../ai/openai';
import { DEFAULT_TTS_MODEL, TTS_MODEL_SETTING } from './tts';
import { generateDialogue } from './generate';
import { setDialogueAudio } from './commands';
import type { SpokenLine } from './clips';

interface AudioJob {
  running: boolean;
  done: number;
  total: number;
  error: string | null;
  controller: AbortController | null;
  start: (lines: SpokenLine[]) => Promise<void>;
  cancel: () => void;
}

/** One dialogue-voicing job at a time, shared by every screen so progress survives navigation. */
export const useAudioJob = create<AudioJob>((set, get) => ({
  running: false,
  done: 0,
  total: 0,
  error: null,
  controller: null,

  start: async (lines) => {
    if (get().running || !lines.length) return;
    const apiKey = await getSetting<string>(API_KEY_SETTING);
    if (!apiKey) {
      set({ error: 'Add your OpenAI API key in Settings to voice dialogue.' });
      return;
    }
    const model = (await getSetting<string>(TTS_MODEL_SETTING)) || DEFAULT_TTS_MODEL;
    const project = useProjectStore.getState().project;
    if (!project) return;
    const controller = new AbortController();
    set({ running: true, done: 0, total: lines.length, error: null, controller });
    const { error } = await generateDialogue(
      project,
      {
        apiKey,
        model,
        signal: controller.signal,
        onProgress: (done, total) => set({ done, total }),
        onBatch: (clips) => {
          // Only save into the project the job started on.
          if (useProjectStore.getState().project?.id === project.id) useProjectStore.getState().dispatch(setDialogueAudio(clips));
        },
      },
      lines,
    );
    set({ running: false, controller: null, error: error ? error.message : null });
  },

  cancel: () => {
    get().controller?.abort();
    set({ running: false, controller: null });
  },
}));
