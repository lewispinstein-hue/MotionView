import type { PlanMethod, PlanNode, PlanObject, PlanWaypoint } from "../state/models";

export interface PlanningMethod extends PlanMethod {
  code: string;
}

export interface PlanningObject extends PlanObject {
  color: string;
  latestMethod: string;
  methods: PlanningMethod[];
}

export interface PlanningNode extends PlanNode {
  name?: string;
  code?: string;
}

export interface PlanningWaypoint extends PlanWaypoint {
  x: number;
  y: number;
  theta?: number;
  speed?: number;
}

export interface PlanningTelemetrySnapshot {
  plan_waypoints: number;
  plan_objects: number;
  plan_methods: number;
  plan_nodes: number;
  template_chars: number;
  [key: string]: unknown;
}

export interface PlanningExportData {
  waypoints: ReadonlyArray<PlanningWaypoint>;
  objects: ReadonlyArray<PlanningObject>;
  nodes: ReadonlyArray<PlanningNode>;
  template: string;
}

export interface PlanningHistorySnapshot {
  waypoints: PlanningWaypoint[];
  objects: PlanningObject[];
  nodes: PlanningNode[];
  selected: number[];
  selectedIndex: number;
  selectedNodeId: string | null;
  playDist: number;
  exportTemplate: string;
}

export interface PlanningState {
  /** Read planning waypoints without copying. Treat the returned array as immutable. */
  getWaypoints(): ReadonlyArray<PlanningWaypoint>;
  /** Read planning objects without copying. Treat the returned array as immutable. */
  getObjects(): ReadonlyArray<PlanningObject>;
  /** Read planning timeline nodes without copying. Treat the returned array as immutable. */
  getNodes(): ReadonlyArray<PlanningNode>;
  hasData(): boolean;
  getWaypointCount(): number;
  getObjectCount(): number;
  getNodeCount(): number;
  getSelectedWaypointIndex(): number;
  getSelectedWaypointCount(): number;
  getSelectedWaypoint(): Readonly<PlanningWaypoint> | null;
  isWaypointSelected(index: number): boolean;
  getExportTemplate(): string;
  isOverlayVisible(): boolean;
  getSelectedNodeId(): string | null;
  hasSelectedNode(): boolean;
  getTimelineDropTarget(): Readonly<unknown> | null;
  hasTimelineDropTarget(): boolean;
  getEditingObjectId(): string | null;
  getOpenColorPickerObjectId(): string | null;
  shouldSelectAllObjectEdit(): boolean;
  hasAnyMethods(): boolean;
  hasOpenObjectColorPicker(): boolean;
}

export interface PlanningActions {
  setExportTemplate(template: string): void;
  setOverlayVisible(enabled: boolean): void;
  toggleOverlay(): boolean;
  toggleObjectColorPicker(objectId: string): string | null;
  openObjectColorPicker(objectId: string): void;
  closeObjectColorPicker(): void;
  selectWaypoint(index: number): void;
  toggleWaypointSelection(index: number): void;
  clearSelection(): void;
  updateSelectedWaypointField(field: "x" | "y" | "theta" | "speed", value: number): void;
  setWaypointSelection(indices: ReadonlyArray<number>): void;
  deleteSelectedWaypoints(): void;
  moveSelectedWaypointsBy(dxInches: number, dyInches: number): void;
  undo(): void;
  redo(): void;
  pushUndo(): void;
}

export interface PlanningPlayback {
  isPlaying(): boolean;
  getPlaybackDistance(): number;
  play(): void;
  pause(): void;
  togglePlayback(): void;
  setDistance(distanceInches: number): void;
  updateControls(): void;
}

export interface PlanningRendering {
  render(): void;
  renderSidebar(): void;
  renderTimelineDom(): void;
  drawFieldOverlay(force?: boolean): void;
  drawTimeline(): void;
  hitTestField(x: number, y: number): number;
}

export interface PlanningInput {
  bindEvents(): void;
  handleKeydown(event: KeyboardEvent): boolean;
}

export interface PlanningTelemetry {
  getTelemetryProperties(extra?: Record<string, unknown>): PlanningTelemetrySnapshot;
}

export interface PlanningModeController {
  state: PlanningState;
  actions: PlanningActions;
  playback: PlanningPlayback;
  rendering: PlanningRendering;
  input: PlanningInput;
  telemetry: PlanningTelemetry;
  /** Load planning data from a MotionView JSON payload. */
  loadImportedData(data: unknown): void;
  /** Remove all planning route, object, node, playback, and modal state. */
  clear(): void;
  /** Build the persisted/exported planning payload from current state. */
  getExportData(): Readonly<PlanningExportData>;
}

export interface PlanningModeDependencies {
  scheduleSavedPathsSave(): void;
  readPlanSpeed?(value: unknown, fallback?: number): number;
  clampWaypointX?(value: number): number;
  clampWaypointY?(value: number): number;
  getPlanTotalLength?(): number;
  getPlanSpeedUnitsPerSecAtDistance?(distanceInches: number): number;
  getPlaybackRate?(): number;
  setPlayButtonLabel?(label: string): void;
  setPlanningDistanceUi?(distanceInches: number, totalInches: number, waypointCount: number): void;
  setPlanningControlsAvailability?(waypointCount: number): void;
  onPlanningDistanceChanged?(): void;
  onPlanningCleared?(): void;
  onPlanningDataLoaded?(): void;
  onPlanningChanged?(options?: { renderPlanObjects?: boolean; skipSelectionPanel?: boolean }): void;
}
