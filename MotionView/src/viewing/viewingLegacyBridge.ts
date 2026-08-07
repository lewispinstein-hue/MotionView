import type { PoseStore } from "../state/poseStore";
import type { ViewingInternalState } from "./viewingState";

export function createViewingLegacyBridge(state: ViewingInternalState) {
  const bridge: Record<string, unknown> = {};
  const define = (name: keyof ViewingInternalState) => {
    Object.defineProperty(bridge, name, {
      enumerable: true,
      get: () => state[name],
      set: (next) => { (state as any)[name] = next; },
    });
  };

  for (const name of [
    "poses",
    "watches",
    "logs",
    "waypoints",
    "waypointsById",
    "watchMarkers",
    "selectedWatch",
    "selectedLogTime",
    "selectedWaypointId",
    "selectedWaypointEventTime",
    "selectedIndex",
    "hoverTimelineTime",
    "trackHover",
    "trackHoverSavedIndex",
    "trackLockActive",
    "trackLockPose",
    "trackLockIndex",
    "watchMarkersByTime",
    "renderedWatchIndexByTime",
    "watchListVirtual",
    "poseListVirtual",
    "watchGraphPanelOpen",
    "watchGraphPanelKey",
    "watchGraphCompareKey",
    "watchGraphChart",
    "watchGraphMarkersForKey",
    "watchGraphCompareMarkersForKey",
    "watchGraphZoomRange",
    "watchGraphFollowLatest",
    "isWatchGraphDragging",
    "isWatchGraphResizing",
    "watchGraphDragStart",
    "watchGraphHoverSaved",
    "meta",
  ] as Array<keyof ViewingInternalState>) {
    define(name);
  }

  Object.defineProperty(bridge, "rawPoses", {
    enumerable: true,
    get: () => state.poses,
    set: (next) => { state.poses = next as PoseStore; },
  });

  return bridge;
}
