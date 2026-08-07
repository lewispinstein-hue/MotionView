import type { LogEntry, Pose, WatchEntry, Waypoint, WaypointEvent } from "../state/models";
import type { PoseStore } from "../state/poseStore";

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

export interface ViewingExportData {
  poses: Readonly<PoseStore>;
  watches: readonly WatchEntry[];
  logs: readonly LogEntry[];
  waypoints: readonly Waypoint[];
  meta?: Record<string, unknown> | null;
}

export interface ViewingData extends ViewingExportData {}

export interface ParsedLiveViewingBatch {
  poses?: readonly Partial<Pose>[];
  watches?: readonly WatchEntry[];
  logs?: readonly LogEntry[];
  waypoints?: readonly Waypoint[];
  waypointEvents?: readonly WaypointEvent[];
  meta?: Record<string, unknown> | null;
}

export interface ViewingAppendResult {
  posesAdded: number;
  watchesAdded: number;
  logsAdded: number;
  waypointsAdded: number;
  hasNewData: boolean;
}

export interface ViewingDataState {
  getPoses(): Readonly<PoseStore>;
  getWatches(): readonly WatchEntry[];
  getLogs(): readonly LogEntry[];
  getWaypoints(): readonly Waypoint[];
  getWaypointMap(): ReadonlyMap<number, Waypoint>;
  getWatchMarkers(): readonly WatchMarker[];
  getSelectedIndex(): number;
  getSelectedWatch(): Readonly<{ marker: WatchMarker }> | null;
  getSelectedLogTime(): number | null;
  getSelectedWaypointId(): string | number | null;
  getSelectedWaypointEventTime(): number | null;
  currentDisplayPose(): Readonly<Pose> | null;
  hasData(): boolean;
}

export interface ViewingDataActions {
  loadViewingData(data: unknown): void;
  clear(): void;
  appendLiveBatch(batch: ParsedLiveViewingBatch): ViewingAppendResult;
  setSelectedPose(index: number): void;
  selectWatch(marker: WatchMarker, fromUserClick?: boolean): void;
  selectWaypoint(waypoint: Waypoint, event?: WaypointEvent | null, fromUserClick?: boolean): void;
  clearTransientSelection(): void;
}

export interface ViewingRendering {
  renderLists(): void;
  renderWatchFilter(): void;
  renderWatchList(): void;
  renderLogList(): void;
  renderWaypointFilter(): void;
  renderWaypointList(): void;
  renderPoseList(): void;
  drawFieldOverlay(): void;
  drawTimeline(): void;
  updatePoseReadout(): void;
}

export interface ViewingInput {
  bindEvents(): void;
  handleKeydown(event: KeyboardEvent): boolean;
}

export interface ViewingModeController {
  data: ViewingDataState;
  actions: ViewingDataActions;
  getExportData(): Readonly<ViewingExportData>;
}
