import type { PlanningObject, PlanningWaypoint } from "./planningTypes";
import type { PlanningModeInternalState } from "./planningInternalState";

export function attachPlanningLegacyBridge(target: object, state: PlanningModeInternalState, defaultExportTemplate: string): void {
  Object.defineProperties(target, {
    waypoints: {
      get: () => state.waypoints,
      set: (next: PlanningWaypoint[]) => { state.waypoints = Array.isArray(next) ? next : []; },
    },
    selectedSet: {
      get: () => state.selectedSet,
      set: (next: Set<number>) => { state.selectedSet = next instanceof Set ? next : new Set<number>(); },
    },
    selected: {
      get: () => state.selected,
      set: (next: number) => { state.selected = Number.isFinite(next) ? next : -1; },
    },
    dragging: {
      get: () => state.dragging,
      set: (next: boolean) => { state.dragging = !!next; },
    },
    pointerId: {
      get: () => state.pointerId,
      set: (next: number | null) => { state.pointerId = next; },
    },
    pendingCanvasClick: {
      get: () => state.pendingCanvasClick,
      set: (next) => { state.pendingCanvasClick = next; },
    },
    dragStart: {
      get: () => state.dragStart,
      set: (next) => { state.dragStart = next; },
    },
    dragOrig: {
      get: () => state.dragOrig,
      set: (next) => { state.dragOrig = Array.isArray(next) ? next : []; },
    },
    selecting: {
      get: () => state.selecting,
      set: (next: boolean) => { state.selecting = !!next; },
    },
    selectRect: {
      get: () => state.selectRect,
      set: (next) => { state.selectRect = next; },
    },
    thetaDragging: {
      get: () => state.thetaDragging,
      set: (next: boolean) => { state.thetaDragging = !!next; },
    },
    thetaDragIdx: {
      get: () => state.thetaDragIdx,
      set: (next: number) => { state.thetaDragIdx = Number.isFinite(next) ? next : -1; },
    },
    thetaDragBase: {
      get: () => state.thetaDragBase,
      set: (next) => { state.thetaDragBase = next; },
    },
    thetaDragStart: {
      get: () => state.thetaDragStart,
      set: (next: number) => { state.thetaDragStart = Number.isFinite(next) ? next : 0; },
    },
    playing: {
      get: () => state.playing,
      set: (next: boolean) => { state.playing = !!next; },
    },
    raf: {
      get: () => state.raf,
      set: (next: number | null) => { state.raf = next; },
    },
    playDist: {
      get: () => state.playDist,
      set: (next: number) => { state.playDist = Number.isFinite(next) ? next : 0; },
    },
    lastWall: {
      get: () => state.lastWall,
      set: (next: number | null) => { state.lastWall = next; },
    },
    scrubbing: {
      get: () => state.scrubbing,
      set: (next: boolean) => { state.scrubbing = !!next; },
    },
    overlayVisible: {
      get: () => state.overlayVisible,
      set: (next: boolean) => { state.overlayVisible = !!next; },
    },
    objects: {
      get: () => state.objects,
      set: (next: PlanningObject[]) => { state.objects = Array.isArray(next) ? next : []; },
    },
    nodes: {
      get: () => state.nodes,
      set: (next) => { state.nodes = Array.isArray(next) ? next : []; },
    },
    selectedNodeId: {
      get: () => state.selectedNodeId,
      set: (next: string | null) => { state.selectedNodeId = next || null; },
    },
    fieldHoverNodeId: {
      get: () => state.fieldHoverNodeId,
      set: (next: string | null) => { state.fieldHoverNodeId = next || null; },
    },
    editingObjectId: {
      get: () => state.editingObjectId,
      set: (next: string | null) => { state.editingObjectId = next || null; },
    },
    editingObjectOriginalName: {
      get: () => state.editingObjectOriginalName,
      set: (next: string) => { state.editingObjectOriginalName = String(next || ""); },
    },
    objectEditSelectAll: {
      get: () => state.objectEditSelectAll,
      set: (next: boolean) => { state.objectEditSelectAll = !!next; },
    },
    templateModalState: {
      get: () => state.templateModalState,
      set: (next) => { state.templateModalState = next; },
    },
    pendingObjectRemovalId: {
      get: () => state.pendingObjectRemovalId,
      set: (next: string | null) => { state.pendingObjectRemovalId = next || null; },
    },
    pendingObjectDeleteAction: {
      get: () => state.pendingObjectDeleteAction,
      set: (next: (() => void) | null) => { state.pendingObjectDeleteAction = typeof next === "function" ? next : null; },
    },
    pendingObjectDeleteCancelAction: {
      get: () => state.pendingObjectDeleteCancelAction,
      set: (next: (() => void) | null) => { state.pendingObjectDeleteCancelAction = typeof next === "function" ? next : null; },
    },
    openColorPickerObjectId: {
      get: () => state.openColorPickerObjectId,
      set: (next: string | null) => { state.openColorPickerObjectId = next || null; },
    },
    timelineLayout: {
      get: () => state.timelineLayout,
      set: (next) => { state.timelineLayout = next; },
    },
    timelineDropTarget: {
      get: () => state.timelineDropTarget,
      set: (next) => { state.timelineDropTarget = next; },
    },
    pointerDragState: {
      get: () => state.pointerDragState,
      set: (next) => { state.pointerDragState = next; },
    },
    nodeTooltipTimer: {
      get: () => state.nodeTooltipTimer,
      set: (next: number | null) => { state.nodeTooltipTimer = next; },
    },
    nodeTooltipVisible: {
      get: () => state.nodeTooltipVisible,
      set: (next: boolean) => { state.nodeTooltipVisible = !!next; },
    },
    nodeTooltipPointer: {
      get: () => state.nodeTooltipPointer,
      set: (next) => { state.nodeTooltipPointer = next; },
    },
    undoStack: {
      get: () => state.undoStack,
      set: (next: unknown[]) => { state.undoStack = Array.isArray(next) ? next : []; },
    },
    redoStack: {
      get: () => state.redoStack,
      set: (next: unknown[]) => { state.redoStack = Array.isArray(next) ? next : []; },
    },
    undoApplying: {
      get: () => state.undoApplying,
      set: (next: boolean) => { state.undoApplying = !!next; },
    },
    exportTemplate: {
      get: () => state.exportTemplate,
      set: (next: string) => { state.exportTemplate = String(next || defaultExportTemplate); },
    },
  });
}
