import { create } from 'zustand';
import { fetchStyles, type VoicevoxStyle } from './voicevox';

interface VoicevoxState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  error: string | null;
  styles: VoicevoxStyle[];
  refresh: () => Promise<void>;
}

export const useVoicevox = create<VoicevoxState>((set) => ({
  status: 'idle',
  error: null,
  styles: [],
  refresh: async () => {
    set({ status: 'loading', error: null });
    try {
      set({ status: 'ok', styles: await fetchStyles() });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
