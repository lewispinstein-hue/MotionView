import type { ViewingDataState } from "./viewingTypes";
import type { ViewingInternalState } from "./viewingState";

export function createViewingDataState(state: ViewingInternalState): ViewingDataState {
  return {
    getPoses: () => state.poses,
    getWatches: () => state.watches,
    getLogs: () => state.logs,
    getWaypoints: () => state.waypoints,
    getWaypointMap: () => state.waypointsById,
    getWatchMarkers: () => state.watchMarkers,
    hasData: () => state.poses.length > 0 || state.watches.length > 0 || state.logs.length > 0 || state.waypoints.length > 0,
  };
}
