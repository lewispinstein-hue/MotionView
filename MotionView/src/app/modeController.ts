export type AppMode = "viewing" | "planning";

export type ModeListener = (mode: AppMode, previousMode: AppMode) => void;

export interface ModeController {
  getMode(): AppMode;
  is(mode: AppMode): boolean;
  setMode(nextMode: AppMode): void;
  subscribe(listener: ModeListener): () => void;
}

export interface CreateModeControllerOptions {
  initialMode?: AppMode;
}

export function normalizeAppMode(value: unknown): AppMode {
  return value === "planning" ? "planning" : "viewing";
}

export function createModeController(initialMode: AppMode): ModeController {
  let currentMode = initialMode;
  const listeners = new Set<ModeListener>();

  return {
    getMode() {
      return currentMode;
    },

    is(mode) {
      return currentMode === mode;
    },

    setMode(nextMode) {
      const normalizedMode = normalizeAppMode(nextMode);
      const previousMode = currentMode;
      currentMode = normalizedMode;

      for (const listener of listeners) {
        listener(currentMode, previousMode);
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
