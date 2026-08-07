import type { PlanningActions, PlanningModeDependencies } from "./planningTypes";
import type { PlanningModeInternalState } from "./planningInternalState";
import type { PlanningPlayback } from "./planningTypes";

export interface CreatePlanningActionsOptions {
  defaultExportTemplate: string;
  maxUndoSteps: number;
  readPlanSpeed(value: unknown, fallback?: number): number;
}

export function createPlanningActions(
  state: PlanningModeInternalState,
  playback: PlanningPlayback,
  dependencies: PlanningModeDependencies,
  options: CreatePlanningActionsOptions,
): PlanningActions {
  function cloneStateSnapshot() {
    return {
      waypoints: state.waypoints.map((point) => ({
        x: point.x,
        y: point.y,
        theta: point.theta ?? 0,
        speed: options.readPlanSpeed(point.speed, 127),
      })),
      selected: Array.from(state.selectedSet),
      selectedIndex: state.selected,
      playDist: state.playDist,
    };
  }

  function stateSnapshotsEqual(a: any, b: any) {
    if (!a || !b) return false;
    if ((a.playDist ?? 0) !== (b.playDist ?? 0)) return false;
    if (a.selectedIndex !== b.selectedIndex) return false;
    if ((a.selected?.length || 0) !== (b.selected?.length || 0)) return false;
    for (let index = 0; index < (a.selected?.length || 0); index += 1) {
      if (a.selected[index] !== b.selected[index]) return false;
    }
    if ((a.waypoints?.length || 0) !== (b.waypoints?.length || 0)) return false;
    for (let index = 0; index < a.waypoints.length; index += 1) {
      const left = a.waypoints[index];
      const right = b.waypoints[index];
      if (!right) return false;
      if (
        left.x !== right.x ||
        left.y !== right.y ||
        (left.theta ?? 0) !== (right.theta ?? 0) ||
        options.readPlanSpeed(left.speed, 127) !== options.readPlanSpeed(right.speed, 127)
      ) {
        return false;
      }
    }
    return true;
  }

  function setWaypointSelection(indices: ReadonlyArray<number>) {
    const sorted = Array.from(indices)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < state.waypoints.length)
      .sort((a, b) => a - b);
    state.selectedSet = new Set(sorted);
    state.selected = sorted[0] ?? -1;
  }

  function applyStateSnapshot(snapshot: any) {
    if (!snapshot) return;
    state.undoApplying = true;
    state.waypoints = snapshot.waypoints.map((point: any) => ({
      x: point.x,
      y: point.y,
      theta: point.theta ?? 0,
      speed: options.readPlanSpeed(point.speed, 127),
    }));
    setWaypointSelection(snapshot.selected || []);
    state.playDist = Number.isFinite(snapshot.playDist) ? snapshot.playDist : 0;
    playback.pause();
    dependencies.onPlanningChanged?.();
    dependencies.requestDrawAll();
    state.undoApplying = false;
  }

  return {
    setExportTemplate(template: string) {
      const next = String(template || "");
      state.exportTemplate = next.trim() ? next : options.defaultExportTemplate;
    },
    setOverlayVisible(enabled: boolean) {
      state.overlayVisible = !!enabled;
    },
    toggleOverlay() {
      state.overlayVisible = !state.overlayVisible;
      return state.overlayVisible;
    },
    toggleObjectColorPicker(objectId: string) {
      state.openColorPickerObjectId = state.openColorPickerObjectId === objectId ? null : objectId;
      return state.openColorPickerObjectId;
    },
    openObjectColorPicker(objectId: string) {
      state.openColorPickerObjectId = objectId || null;
    },
    closeObjectColorPicker() {
      state.openColorPickerObjectId = null;
    },
    selectWaypoint(index: number) {
      state.selectedSet = index >= 0 ? new Set([index]) : new Set<number>();
      state.selected = index >= 0 ? index : -1;
    },
    toggleWaypointSelection(index: number) {
      if (index < 0) return;
      const next = new Set(state.selectedSet);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      const indices = Array.from(next).sort((a, b) => a - b);
      state.selectedSet = next;
      state.selected = next.has(index) ? index : (indices[0] ?? -1);
    },
    clearSelection() {
      state.selectedSet.clear();
      state.selected = -1;
    },
    updateSelectedWaypointField(field, value) {
      const waypoint = state.waypoints[state.selected];
      if (!waypoint) return;
      waypoint[field] = value;
    },
    setWaypointSelection,
    deleteSelectedWaypoints() {
      const selected = Array.from(state.selectedSet).sort((a, b) => b - a);
      for (const index of selected) {
        if (index >= 0 && index < state.waypoints.length) state.waypoints.splice(index, 1);
      }
      state.selectedSet.clear();
      state.selected = -1;
    },
    moveSelectedWaypointsBy(dxInches, dyInches) {
      for (const index of state.selectedSet) {
        const waypoint = state.waypoints[index];
        if (!waypoint) continue;
        const nextX = waypoint.x + dxInches;
        const nextY = waypoint.y + dyInches;
        waypoint.x = dependencies.clampWaypointX ? dependencies.clampWaypointX(nextX) : nextX;
        waypoint.y = dependencies.clampWaypointY ? dependencies.clampWaypointY(nextY) : nextY;
      }
    },
    undo() {
      if (dependencies.getAppMode() !== "planning") return;
      if (!state.undoStack.length) return;
      state.redoStack.push(cloneStateSnapshot());
      applyStateSnapshot(state.undoStack.pop());
    },
    redo() {
      if (dependencies.getAppMode() !== "planning") return;
      if (!state.redoStack.length) return;
      state.undoStack.push(cloneStateSnapshot());
      applyStateSnapshot(state.redoStack.pop());
    },
    pushUndo() {
      if (dependencies.getAppMode() !== "planning" || state.undoApplying) return;
      const snapshot = cloneStateSnapshot();
      const last = state.undoStack[state.undoStack.length - 1];
      if (last && stateSnapshotsEqual(last, snapshot)) return;
      state.undoStack.push(snapshot);
      if (state.undoStack.length > options.maxUndoSteps) state.undoStack.shift();
      state.redoStack.length = 0;
    },
  };
}
