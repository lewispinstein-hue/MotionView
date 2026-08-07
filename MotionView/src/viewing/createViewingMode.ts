import { createPoseStore } from "../state/poseStore";
import {
  createViewingActions,
  defaultLogLevelNormalizer,
  defaultNumberParser,
  type LogLevelNormalizer,
  type NumberParser,
} from "./viewingActions";
import { createViewingDataState } from "./viewingData";
import { createViewingInternalState } from "./viewingState";
import type { ViewingModeController, ViewingExportData } from "./viewingTypes";
import type { WatchEntry } from "../state/models";

export interface CreateViewingModeOptions {
  createPoseStore?: typeof createPoseStore;
  toNumMaybe?: NumberParser;
  normalizeLogLevel?: LogLevelNormalizer;
  getWatchVisibility?: (watch: WatchEntry) => boolean;
}

export function createViewingMode(options: CreateViewingModeOptions = {}): ViewingModeController {
  const makePoseStore = options.createPoseStore ?? createPoseStore;
  const state = createViewingInternalState(makePoseStore);
  const data = createViewingDataState(state);
  const actions = createViewingActions(state, {
    makePoseStore,
    toNumMaybe: options.toNumMaybe ?? defaultNumberParser,
    normalizeLogLevel: options.normalizeLogLevel ?? defaultLogLevelNormalizer,
    getWatchVisibility: options.getWatchVisibility,
  });

  const controller = {
    data,
    actions,
    getExportData(): Readonly<ViewingExportData> {
      return {
        poses: state.poses,
        watches: state.watches,
        logs: state.logs,
        waypoints: state.waypoints,
        meta: state.meta,
      };
    },
  };

  return controller;
}
