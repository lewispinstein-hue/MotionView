import type { ViewingDataState } from "./viewingTypes";
import type { ViewingInternalState } from "./viewingState";

export function createViewingDataState(state: ViewingInternalState): ViewingDataState {
  return {
    getPoses: () => state.poses,
    getWatches: () => state.watches,
    getLogs: () => state.logs,
    getWaypoints: () => state.waypoints,
    getWatchMarkers: () => state.watchMarkers,
    getSelectedIndex: () => state.selectedIndex,
    getSelectedWatch: () => state.selectedWatch,
    getSelectedLogTime: () => state.selectedLogTime,
    getSelectedWaypointId: () => state.selectedWaypointId,
    getSelectedWaypointEventTime: () => state.selectedWaypointEventTime,
    currentDisplayPose: () => state.poses[state.selectedIndex] ?? null,
    hasData: () => state.poses.length > 0 || state.watches.length > 0 || state.logs.length > 0 || state.waypoints.length > 0,
  };
}
