import { create } from 'zustand';

interface ChatUI {
  expanded: boolean;
  draft: string;
  setExpanded: (v: boolean) => void;
  setDraft: (v: string) => void;
  /** Opens the chat, optionally with text ready to edit and send. */
  open: (prefill?: string) => void;
}

export const useChatUI = create<ChatUI>((set) => ({
  expanded: false,
  draft: '',
  setExpanded: (expanded) => set({ expanded }),
  setDraft: (draft) => set({ draft }),
  open: (prefill) => set((s) => ({ expanded: true, draft: prefill ?? s.draft })),
}));
