import type { LogEntry, Pose, WatchEntry, Waypoint, WaypointEvent } from "../state/models";

export interface WatchMarker {
  watch: WatchEntry;
  t: number;
  ok: boolean;
  dt: number | null;
  pose: Pose | null;
  idx: number | null;
}

export interface WaypointVisibleEvent {
  waypoint: Waypoint;
  event: WaypointEvent;
}

export interface ViewingData {
  poses: Pose[];
  watches: WatchEntry[];
  logs: LogEntry[];
  waypoints: Waypoint[];
  meta?: Record<string, unknown> | null;
}

export interface ViewingModeController {
  loadViewingData(data: unknown): void;
  clear(): void;
  renderLists(): void;
  renderWatchList(): void;
  renderLogList(): void;
  renderWaypointList(): void;
  renderPoseList(): void;
  selectPose(index: number): void;
  selectWatch(marker: WatchMarker): void;
  selectWaypoint(waypoint: Waypoint, event?: WaypointEvent | null): void;
  updatePoseReadout(): void;
  currentDisplayPose(): Pose | null;
  getExportData(): ViewingData;
  hasData(): boolean;
  bindEvents(): void;
}
