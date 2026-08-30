import type { MotionViewApp } from "../MotionViewApp";
import type { TopBarView } from "../topBar";
import type { PlanningDialogs } from "../../planning";
import type { PlanningLayoutView } from "../../planning/render/PlanningLayoutView";
import type { ViewingLayoutView } from "../../viewing/render/ViewingLayoutView";
import type { FieldRenderer } from "../../render/field";
import { requestDrawAll } from "../../render/renderScheduler";
import { viewingTelemetry } from "../../telemetry/createTelemetry";
import { requiredElement } from "../../dom/elements";

/** Executes application-wide commands that coordinate more than one feature. */
export class AppCommands {
  #bound = false;
  readonly #planOverlayButton: HTMLButtonElement;
  constructor(
    private readonly app: MotionViewApp,
    private readonly field: FieldRenderer,
    private readonly topBar: TopBarView,
    private readonly planningDialogs: PlanningDialogs,
    private readonly planningLayout: PlanningLayoutView,
    private readonly viewingLayout: ViewingLayoutView,
    document: Document,
  ) { this.#planOverlayButton = requiredElement("btnTogglePlanOverlay", HTMLButtonElement, document); }

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.#planOverlayButton.addEventListener("click", () => this.togglePlanningOverlay());
    this.#planOverlayButton.classList.toggle("isOn", this.app.planning.overlayVisible);
  }

  openRoute(): void { this.topBar.openFilePicker(); }
  fitField(): void { this.field.resetFieldPosition(); }
  setViewingMode(): void { this.app.core.mode.setMode("viewing"); }
  setPlanningMode(): void { this.app.core.mode.setMode("planning"); }

  toggleTimeline(): void {
    if (this.app.core.mode.getMode() === "planning") this.planningLayout.toggleTimeline();
    else this.viewingLayout.toggleTimeline();
  }

  toggleLeftSidebar(): void {
    if (this.app.core.mode.getMode() === "viewing") this.viewingLayout.toggleLeftSidebar();
  }

  toggleRightSidebar(): void {
    if (this.app.core.mode.getMode() === "planning") this.planningLayout.toggleRightSidebar();
    else this.viewingLayout.toggleRightSidebar();
  }

  togglePlanningOverlay(): void {
    if (this.app.core.mode.getMode() !== "viewing") return;
    const visible = this.app.planning.toggleOverlay();
    this.#planOverlayButton.classList.toggle("isOn", visible);
    void viewingTelemetry.planOverlayToggled({ enabled: visible });
    requestDrawAll();
  }

  async clearCurrent(): Promise<void> {
    if (this.app.core.mode.getMode() === "planning") {
      if (!await this.confirmPlanningClear("Are you sure you want to clear Planning mode? This will remove all waypoints, objects, methods, and nodes.")) return;
      this.app.planning.clear();
      requestDrawAll();
      this.app.core.status.setStatus("Cleared Planned Path");
      return;
    }
    this.clearViewing();
    this.app.core.status.setStatus("Cleared Field");
  }

  async clearAll(): Promise<void> {
    if (!await this.confirmPlanningClear("Are you sure you want to clear the field and Planning mode? This will remove all waypoints, objects, methods, and nodes.")) return;
    this.clearViewing();
    this.app.planning.clear();
    requestDrawAll();
    this.app.core.status.setStatus("Cleared Field and Planned Path");
  }

  private clearViewing(): void {
    this.app.viewing.clear();
    this.app.live.reset();
  }

  private async confirmPlanningClear(message: string): Promise<boolean> {
    return !this.app.planning.hasData || this.planningDialogs.confirm({ message });
  }
}
