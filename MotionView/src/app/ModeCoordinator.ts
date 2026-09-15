import type { MotionViewApp } from "./MotionViewApp";
import type { FieldRenderer } from "../render/field";
import type { PlanningLayoutView } from "../planning/render/PlanningLayoutView";
import type { ViewingLayoutView } from "../viewing/render/ViewingLayoutView";
import { appTelemetry } from "../telemetry/createTelemetry";

export class ModeCoordinator {
  #bound = false;
  constructor(private readonly app: MotionViewApp, private readonly field: FieldRenderer, private readonly planning: PlanningLayoutView, private readonly viewing: ViewingLayoutView) {}
  bind(): void {
    if (this.#bound) return; this.#bound = true;
    this.app.core.mode.subscribeMode((mode) => {
      document.body.classList.toggle("mode-planning", mode === "planning");
      if (mode === "planning") { this.app.viewing.playback.pause(); this.planning.activate(); }
      else { this.app.planning.playback.pause(); this.viewing.activate(); }
      this.app.planning.selection.clear(); this.field.updateFieldLayout(true); this.app.planning.playback.setDistance(this.app.planning.playback.distance);
      void appTelemetry.modeChanged({ mode });
    });
  }
}
