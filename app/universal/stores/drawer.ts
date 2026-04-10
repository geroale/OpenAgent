/**
 * Global drawer toggle state.
 * The Header sets toggleRequested, the active ResponsiveSidebar listens.
 */

import { create } from 'zustand';

interface DrawerState {
  toggleRequested: number; // increment to trigger
  requestToggle: () => void;
}

export const useDrawer = create<DrawerState>((set) => ({
  toggleRequested: 0,
  requestToggle: () => set((s) => ({ toggleRequested: s.toggleRequested + 1 })),
}));
