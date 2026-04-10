/**
 * Platform-agnostic key-value storage.
 *
 * - Electron: delegates to electron-store via preload IPC bridge
 * - Web (browser): wraps localStorage in Promises
 * - React Native: add a .native.ts variant with AsyncStorage later
 */

declare global {
  interface Window {
    desktop?: {
      platform: string;
      isDesktop: boolean;
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<void>;
      removeItem: (key: string) => Promise<void>;
    };
  }
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.desktop?.isDesktop;
}

export async function getItem(key: string): Promise<string | null> {
  if (isElectron()) {
    return window.desktop!.getItem(key);
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(key);
  }
  return null;
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isElectron()) {
    return window.desktop!.setItem(key, value);
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, value);
  }
}

export async function removeItem(key: string): Promise<void> {
  if (isElectron()) {
    return window.desktop!.removeItem(key);
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(key);
  }
}
