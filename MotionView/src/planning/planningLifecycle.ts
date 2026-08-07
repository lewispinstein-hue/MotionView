import type { PlanningActions } from "./planningTypes";
import type { PlanningExportData, PlanningModeDependencies } from "./planningTypes";
import type { PlanningModeInternalState } from "./planningInternalState";
import type { PlanningPlayback } from "./planningTypes";
import { normalizePlanNodes, normalizePlanObjects } from "./planningState";

export interface PlanningLifecycle {
  loadImportedData(data: unknown): void;
  clear(): void;
  getExportData(): Readonly<PlanningExportData>;
}

export interface CreatePlanningLifecycleOptions {
  defaultExportTemplate: string;
  readPlanSpeed(value: unknown, fallback?: number): number;
}

export function createPlanningLifecycle(
  state: PlanningModeInternalState,
  actions: PlanningActions,
  playback: PlanningPlayback,
  dependencies: PlanningModeDependencies,
  options: CreatePlanningLifecycleOptions,
): PlanningLifecycle {
  return {
    loadImportedData(data: unknown) {
      const obj = (data && typeof data === "object") ? data as Record<string, any> : {};
      if (Array.isArray(obj["planned-path"])) {
        state.waypoints = obj["planned-path"].map((point: any) => ({
          x: Number(point?.x) || 0,
          y: Number(point?.y) || 0,
          theta: Number(point?.theta) || 0,
          speed: options.readPlanSpeed(point?.speed, 127),
        }));
      } else {
        state.waypoints = [];
      }
      if (obj["planned-export-template"] !== undefined) {
        const savedTemplate = String(obj["planned-export-template"] || "");
        state.exportTemplate = savedTemplate.trim() ? savedTemplate : options.defaultExportTemplate;
      }
      actions.clearSelection();
      state.playDist = 0;
      state.objects = normalizePlanObjects(obj["planned-objects"] || []);
      state.nodes = normalizePlanNodes(obj["planned-nodes"] || []);
      state.selectedNodeId = null;
      dependencies.onPlanningDataLoaded?.();
    },
    clear() {
      state.waypoints = [];
      state.objects = [];
      state.nodes = [];
      actions.clearSelection();
      state.selectedNodeId = null;
      state.fieldHoverNodeId = null;
      state.editingObjectId = null;
      state.editingObjectOriginalName = "";
      state.objectEditSelectAll = false;
      state.templateModalState = null;
      state.pendingObjectRemovalId = null;
      state.pendingObjectDeleteAction = null;
      state.pendingObjectDeleteCancelAction = null;
      state.openColorPickerObjectId = null;
      state.timelineLayout = null;
      state.timelineDropTarget = null;
      state.pointerDragState = null;
      state.nodeTooltipVisible = false;
      state.nodeTooltipPointer = null;
      state.undoStack = [];
      state.redoStack = [];
      state.undoApplying = false;
      state.playDist = 0;
      state.scrubbing = false;
      playback.pause();
      dependencies.onPlanningCleared?.();
    },
    getExportData() {
      return {
        waypoints: state.waypoints,
        objects: state.objects,
        nodes: state.nodes,
        template: state.exportTemplate,
      };
    },
  };
}
