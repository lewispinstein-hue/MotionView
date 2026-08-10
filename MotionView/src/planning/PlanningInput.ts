import { getMode } from "../app/modeController";
import type { FieldRenderer } from "../render/createFieldRenderer";
import { requestDrawAll } from "../render/renderScheduler";
import { currentUnitsToInches } from "../shared/units";
import { planningTelemetry } from "../telemetry/createTelemetry";
import type { PlanningDialogs } from "./PlanningDialogs";
import type { PlanningFeature } from "./PlanningFeature";

/** Translates Planning keyboard intent into domain commands. */
export class PlanningInput {
  #bound = false;

  constructor(
    private readonly planning: PlanningFeature,
    private readonly field: FieldRenderer,
    private readonly dialogs: PlanningDialogs,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    document.addEventListener("keydown", (event) => {
      if (this.handleKeydown(event)) event.stopImmediatePropagation();
    });
  }

  handleKeydown(event: KeyboardEvent): boolean {
    if (getMode() !== "planning" || event.defaultPrevented) return false;
    const target = event.target;
    const visibleTypingTarget = target instanceof HTMLElement
      && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
      && target.isConnected
      && target.closest("[hidden]") == null;
    if (visibleTypingTarget) {
      return false;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      const undo = key === "z" && !event.shiftKey;
      const redo = (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
      if (undo || redo) {
        event.preventDefault();
        if (undo) this.planning.history.undo();
        else this.planning.history.redo();
        return true;
      }
    }
    if (event.code === "Space") {
      event.preventDefault();
      this.planning.playback.toggle();
      return true;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      const nodeId = this.planning.selection.selectedNodeId;
      if (nodeId && !this.dialogs.isOpen) {
        event.preventDefault();
        const node = this.planning.timeline.get(nodeId);
        if (node) {
          this.planning.timeline.remove(nodeId);
          void planningTelemetry.timelineNodeRemoved(this.planning.telemetryProperties({ before_waypoint: node.beforeWaypoint }));
        }
        return true;
      }
      if (this.planning.selection.waypointIndices.size) {
        event.preventDefault();
        this.planning.route.remove(this.planning.selection.waypointIndices);
        return true;
      }
    }
    if (!this.planning.selection.waypointIndices.size) return false;
    const moveInput = document.getElementById("settingsPlanMoveStep") as HTMLInputElement | null;
    const configuredStep = currentUnitsToInches(Number(moveInput?.value));
    const step = Number.isFinite(configuredStep) && configuredStep > 0 ? configuredStep : 1;
    const amount = event.shiftKey ? step * 5 : step;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -amount;
    else if (event.key === "ArrowRight") dx = amount;
    else if (event.key === "ArrowDown") dy = -amount;
    else if (event.key === "ArrowUp") dy = amount;
    else return false;
    event.preventDefault();
    const angle = this.field.getFieldRotationDeg() * Math.PI / 180;
    const rotatedX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const rotatedY = dx * Math.sin(angle) + dy * Math.cos(angle);
    this.planning.route.move(
      this.planning.selection.waypointIndices,
      rotatedX,
      rotatedY,
      (point) => this.planning.projection.constrain(point),
    );
    requestDrawAll();
    return true;
  }
}
