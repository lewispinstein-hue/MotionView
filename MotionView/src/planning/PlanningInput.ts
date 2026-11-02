import { getMode } from "../app/modeController";
import {
  isTypingTarget,
  hasOpenModal,
  matchesShortcut,
  PLANNING_SHORTCUTS,
} from "../app/input";
import type { FieldRenderer } from "../render/field";
import { requestDrawAll } from "../render/renderScheduler";
import { currentUnitsToInches } from "../shared/units";
import { planningTelemetry } from "../telemetry/createTelemetry";
import type { PlanningDialogs } from "./PlanningDialogs";
import type { PlanningFeature } from "./PlanningFeature";

/** Translates Planning keyboard and background-click intent into domain commands. */
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
    document.addEventListener("click", (event) => this.handleClick(event));
  }

  handleClick(event: MouseEvent): void {
    if (getMode() !== "planning" || event.button !== 0 || hasOpenModal()) return;
    if (!this.planning.selection.waypointIndices.size || !(event.target instanceof Element)) return;
    if (!event.target.closest("#rightPlanning, #planningTimelineBar")) return;
    // Waypoint rows/markers and their editing controls retain their selection.
    if (event.target.closest(".planItem, .planningTimelineWaypointConnector")) return;
    if (event.target.closest(".planSelectedPanel") && event.target.closest("input, button, label")) return;
    this.planning.selection.selectWaypoint(-1);
  }

  handleKeydown(event: KeyboardEvent): boolean {
    if (getMode() !== "planning" || event.defaultPrevented) return false;
    if (hasOpenModal() || isTypingTarget(event.target)) return false;
    if (matchesShortcut(event, PLANNING_SHORTCUTS.undo)) {
      event.preventDefault();
      this.planning.history.undo();
      return true;
    }
    if (matchesShortcut(event, PLANNING_SHORTCUTS.redo)) {
      event.preventDefault();
      this.planning.history.redo();
      return true;
    }
    if (matchesShortcut(event, PLANNING_SHORTCUTS.playback)) {
      event.preventDefault();
      this.planning.playback.toggle();
      return true;
    }
    if (matchesShortcut(event, PLANNING_SHORTCUTS.remove)) {
      const nodeId = this.planning.selection.selectedNodeId;
      if (nodeId && !this.dialogs.isOpen) {
        event.preventDefault();
        const node = this.planning.timeline.get(nodeId);
        if (node) {
          this.planning.timeline.remove(nodeId);
          void planningTelemetry.timelineNodeRemoved(
            this.planning.telemetryProperties(),
          );
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
    const moveInput = document.getElementById(
      "settingsPlanMoveStep",
    ) as HTMLInputElement | null;
    const configuredStep = currentUnitsToInches(Number(moveInput?.value));
    const step =
      Number.isFinite(configuredStep) && configuredStep > 0
        ? configuredStep
        : 1;
    const fast = matchesShortcut(event, PLANNING_SHORTCUTS.nudgeFast);
    if (!fast && !matchesShortcut(event, PLANNING_SHORTCUTS.nudge))
      return false;
    const amount = fast ? step * 5 : step;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -amount;
    else if (event.key === "ArrowRight") dx = amount;
    else if (event.key === "ArrowDown") dy = -amount;
    else if (event.key === "ArrowUp") dy = amount;
    else return false;
    event.preventDefault();
    const angle = (this.field.getFieldRotationDeg() * Math.PI) / 180;
    const rotatedX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const rotatedY = dx * Math.sin(angle) + dy * Math.cos(angle);
    // Keyboard steps are explicit; grid snapping can round smaller nudges away.
    this.planning.route.move(
      this.planning.selection.waypointIndices,
      rotatedX,
      rotatedY,
      (point) => this.planning.projection.constrainToBounds(point),
    );
    requestDrawAll();
    return true;
  }
}
