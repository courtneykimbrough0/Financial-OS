import { useSyncExternalStore } from 'react';

/**
 * A new version of the app that's downloaded and waiting. It's applied only
 * when the person chooses (or the next time the app opens), never mid-entry.
 */
let applyUpdate: (() => void) | null = null;
const listeners = new Set<() => void>();

export function announceUpdate(apply: () => void) {
  applyUpdate = apply;
  listeners.forEach((l) => l());
}

export function useWaitingUpdate(): (() => void) | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => applyUpdate,
  );
}
