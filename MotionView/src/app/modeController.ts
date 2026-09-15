export type AppMode = "viewing" | "planning";

export type ModeListener = (mode: AppMode, previousMode: AppMode) => void;

let currentMode: AppMode = "viewing";
const listeners = new Set<ModeListener>();

export function normalizeAppMode(value: unknown): AppMode {
  return value === "planning" ? "planning" : "viewing";
}

export function getMode(): AppMode {
  return currentMode;
}

export function isMode(mode: AppMode): boolean {
  return currentMode === mode;
}

export function setMode(nextMode: AppMode): void {
  const normalizedMode = normalizeAppMode(nextMode);
  const previousMode = currentMode;
  currentMode = normalizedMode;

  for (const listener of listeners) {
    listener(currentMode, previousMode);
  }
}

export function subscribeMode(listener: ModeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
