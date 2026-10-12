import { create } from 'zustand';

interface ChatUI {
  expanded: boolean;
  draft: string;
  setExpanded: (v: boolean) => void;
  setDraft: (v: string) => void;
  /** Opens the chat, optionally with text ready to edit and send. */
  open: (prefill?: string) => void;
  /** A request to send as if typed, picked up by the chat bar. */
  pending: string | null;
  /** Opens the chat and sends a request as if the user typed it. */
  submit: (text: string) => void;
  /** True while the assistant is working on a request. */
  running: boolean;
  setRunning: (v: boolean) => void;
}

export const useChatUI = create<ChatUI>((set) => ({
  expanded: false,
  draft: '',
  setExpanded: (expanded) => set({ expanded }),
  setDraft: (draft) => set({ draft }),
  open: (prefill) => set((s) => ({ expanded: true, draft: prefill ?? s.draft })),
  pending: null,
  submit: (text) => set({ expanded: true, pending: text }),
  running: false,
  setRunning: (running) => set({ running }),
}));
