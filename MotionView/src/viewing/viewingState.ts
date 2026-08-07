import type { LogEntry, Pose, WatchEntry, Waypoint } from "../state/models";
import { createPoseStore, type PoseStore } from "../state/poseStore";
import type { WatchMarker } from "./viewingTypes";

export interface ViewingInternalState {
  poses: PoseStore;
  watches: WatchEntry[];
  logs: LogEntry[];
  waypoints: Waypoint[];
  waypointsById: Map<number, Waypoint>;
  watchMarkers: WatchMarker[];
  selectedWatch: { marker: WatchMarker } | null;
  selectedLogTime: number | null;
  selectedWaypointId: string | number | null;
  selectedWaypointEventTime: number | null;
  selectedIndex: number;
  hoverTimelineTime: number | null;
  trackHover: unknown;
  trackHoverSavedIndex: number | null;
  trackLockActive: boolean;
  trackLockPose: Pose | null;
  trackLockIndex: number | null;
  watchMarkersByTime: WatchMarker[];
  renderedWatchIndexByTime: Map<number, number>;
  watchListVirtual: unknown;
  poseListVirtual: unknown;
  watchGraphPanelOpen: boolean;
  watchGraphPanelKey: string | null;
  watchGraphCompareKey: string;
  watchGraphChart: unknown;
  watchGraphMarkersForKey: WatchMarker[];
  watchGraphCompareMarkersForKey: WatchMarker[];
  watchGraphZoomRange: { min: number; max: number } | null;
  watchGraphFollowLatest: boolean;
  isWatchGraphDragging: boolean;
  isWatchGraphResizing: boolean;
  watchGraphDragStart: { x: number; y: number };
  watchGraphHoverSaved: unknown;
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
    selectedWatch: null,
    selectedLogTime: null,
    selectedWaypointId: null,
    selectedWaypointEventTime: null,
    selectedIndex: 0,
    hoverTimelineTime: null,
    trackHover: null,
    trackHoverSavedIndex: null,
    trackLockActive: false,
    trackLockPose: null,
    trackLockIndex: null,
    watchMarkersByTime: [],
    renderedWatchIndexByTime: new Map<number, number>(),
    watchListVirtual: null,
    poseListVirtual: null,
    watchGraphPanelOpen: false,
    watchGraphPanelKey: null,
    watchGraphCompareKey: "",
    watchGraphChart: null,
    watchGraphMarkersForKey: [],
    watchGraphCompareMarkersForKey: [],
    watchGraphZoomRange: null,
    watchGraphFollowLatest: false,
    isWatchGraphDragging: false,
    isWatchGraphResizing: false,
    watchGraphDragStart: { x: 0, y: 0 },
    watchGraphHoverSaved: null,
    meta: null,
  };
}
