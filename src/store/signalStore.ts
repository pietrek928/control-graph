import { create } from 'zustand'

/**
 * Live PLC values live here — not inside React Flow nodes — so updating signals
 * does not re-render the whole graph. Nodes subscribe by id when you add runtime viz.
 */
interface SignalState {
  signals: Record<string, unknown>
  updateSignal: (nodeId: string, value: unknown) => void
  clearSignals: () => void
}

export const useSignalStore = create<SignalState>((set) => ({
  signals: {},
  updateSignal: (nodeId, value) =>
    set((state) => ({
      signals: { ...state.signals, [nodeId]: value },
    })),
  clearSignals: () => set({ signals: {} }),
}))
