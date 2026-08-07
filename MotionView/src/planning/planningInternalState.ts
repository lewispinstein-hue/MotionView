import type { PlanningObject, PlanningWaypoint } from "./planningTypes";

export interface PlanningModeInternalState {
  waypoints: PlanningWaypoint[];
  selectedSet: Set<number>;
  selected: number;
  dragging: boolean;
  pointerId: number | null;
  pendingCanvasClick: { world: { x: number; y: number }; clearMultiSelection?: boolean } | null;
  dragStart: { x: number; y: number };
  dragOrig: Array<{ i: number; x: number; y: number }>;
  selecting: boolean;
  selectRect: { x0: number; y0: number; x1: number; y1: number } | null;
  thetaDragging: boolean;
  thetaDragIdx: number;
  thetaDragBase: Array<{ i: number; theta: number }> | null;
  thetaDragStart: number;
  playing: boolean;
  raf: number | null;
  playDist: number;
  lastWall: number | null;
  scrubbing: boolean;
  overlayVisible: boolean;
  objects: PlanningObject[];
  nodes: any[];
  selectedNodeId: string | null;
  fieldHoverNodeId: string | null;
  editingObjectId: string | null;
  editingObjectOriginalName: string;
  objectEditSelectAll: boolean;
  templateModalState: any;
  pendingObjectRemovalId: string | null;
  pendingObjectDeleteAction: (() => void) | null;
  pendingObjectDeleteCancelAction: (() => void) | null;
  openColorPickerObjectId: string | null;
  timelineLayout: any;
  timelineDropTarget: any;
  pointerDragState: any;
  nodeTooltipTimer: number | null;
  nodeTooltipVisible: boolean;
  nodeTooltipPointer: { x: number; y: number } | null;
  undoStack: any[];
  redoStack: any[];
  undoApplying: boolean;
  exportTemplate: string;
}

export function createPlanningInternalState(defaultExportTemplate: string): PlanningModeInternalState {
  return {
    waypoints: [],
    selectedSet: new Set<number>(),
    selected: -1,
    dragging: false,
    pointerId: null,
    pendingCanvasClick: null,
    dragStart: { x: 0, y: 0 },
    dragOrig: [],
    selecting: false,
    selectRect: null,
    thetaDragging: false,
    thetaDragIdx: -1,
    thetaDragBase: null,
    thetaDragStart: 0,
    playing: false,
    raf: null,
    playDist: 0,
    lastWall: null,
    scrubbing: false,
    overlayVisible: false,
    objects: [],
    nodes: [],
    selectedNodeId: null,
    fieldHoverNodeId: null,
    editingObjectId: null,
    editingObjectOriginalName: "",
    objectEditSelectAll: false,
    templateModalState: null,
    pendingObjectRemovalId: null,
    pendingObjectDeleteAction: null,
    pendingObjectDeleteCancelAction: null,
    openColorPickerObjectId: null,
    timelineLayout: null,
    timelineDropTarget: null,
    pointerDragState: null,
    nodeTooltipTimer: null,
    nodeTooltipVisible: false,
    nodeTooltipPointer: null,
    undoStack: [],
    redoStack: [],
    undoApplying: false,
    exportTemplate: defaultExportTemplate,
  };
}
