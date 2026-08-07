import type { LogEntry, WatchEntry, Waypoint } from "../state/models";
import { createPoseStore, type PoseStore } from "../state/poseStore";
import type { WatchMarker } from "./viewingTypes";

export interface ViewingInternalState {
  poses: PoseStore;
  watches: WatchEntry[];
  logs: LogEntry[];
  waypoints: Waypoint[];
  waypointsById: Map<number, Waypoint>;
  watchMarkers: WatchMarker[];
  meta: Record<string, unknown> | null;
}

export function createViewingInternalState(makePoseStore: typeof createPoseStore): ViewingInternalState {
  return {
    poses: makePoseStore(),
    watches: [],
    logs: [],
    waypoints: [],
    waypointsById: new Map<number, Waypoint>(),
    watchMarkers: [],
    meta: null,
  };
}
