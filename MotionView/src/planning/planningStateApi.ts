import type { PlanningState } from "./planningTypes";
import type { PlanningModeInternalState } from "./planningInternalState";

export function createPlanningStateApi(state: PlanningModeInternalState): PlanningState {
  return {
    getWaypoints: () => state.waypoints,
    getObjects: () => state.objects,
    getNodes: () => state.nodes,
    hasData: () => state.waypoints.length > 0 || state.objects.length > 0 || state.nodes.length > 0,
    getWaypointCount: () => state.waypoints.length,
    getObjectCount: () => state.objects.length,
    getNodeCount: () => state.nodes.length,
    getSelectedWaypointIndex: () => state.selected,
    getSelectedWaypointCount: () => state.selectedSet.size,
    getSelectedWaypoint: () => state.waypoints[state.selected] ?? null,
    isWaypointSelected: (index) => state.selectedSet.has(index),
    getExportTemplate: () => state.exportTemplate,
    isOverlayVisible: () => state.overlayVisible,
    getSelectedNodeId: () => state.selectedNodeId,
    hasSelectedNode: () => !!state.selectedNodeId,
    getTimelineDropTarget: () => state.timelineDropTarget,
    hasTimelineDropTarget: () => !!state.timelineDropTarget,
    getEditingObjectId: () => state.editingObjectId,
    getOpenColorPickerObjectId: () => state.openColorPickerObjectId,
    shouldSelectAllObjectEdit: () => state.objectEditSelectAll,
    hasAnyMethods: () => state.objects.some((entry) => Array.isArray(entry.methods) && entry.methods.length > 0),
    hasOpenObjectColorPicker: () => !!state.openColorPickerObjectId,
  };
}
