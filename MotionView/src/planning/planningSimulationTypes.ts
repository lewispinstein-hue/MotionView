import type { PreviewDrivetrainState } from "./planningPreviewDrivetrain";
import type { PlanWaypoint, PlanWaypointMotion } from "../state/models";
import type { PlanningSimulationConfiguration } from "./planningSimulationConfiguration";
import type { PlanningTemplateLibrary } from "./planningTemplatePresets";

export interface PreviewPose {
  readonly x: number;
  readonly y: number;
  /** Clockwise radians from +Y. Stored waypoints and UI headings use degrees. */
  readonly theta: number;
}
export interface SimulationSample extends PreviewPose {
  readonly time: number;
  readonly distance: number;
  readonly linearVelocity: number;
  readonly angularVelocity: number;
}
/** Completed means a motion finished with a remaining target offset. */
export type SimulationOutcome = "reached" | "completed" | "missed" | "stalled" | "incomplete";
export interface SimulationCompletionOffset {
  readonly reason: "settling" | "minimum-speed" | "target-plane" | "distance-drive" | "coast";
  readonly motionType: PlanWaypointMotion["type"];
  /** Inches for translation, degrees for rotation. */
  readonly error: number;
}
export interface SimulatedMotion {
  readonly motionId: string;
  readonly type: PlanWaypointMotion["type"];
  readonly startTime: number;
  readonly endTime: number;
  readonly outcome: SimulationOutcome;
  readonly targetError: number;
}
export interface SimulatedSection {
  readonly key: string;
  readonly drivetrainState: PreviewDrivetrainState;
  readonly samples: readonly SimulationSample[];
  readonly motions: readonly SimulatedMotion[];
  readonly outcome: SimulationOutcome;
  readonly completionOffset?: SimulationCompletionOffset;
}
export interface PlanningSimulationResult {
  readonly sections: readonly SimulatedSection[];
  readonly duration: number;
  readonly complete: boolean;
}
export interface PlanningSimulationRequest {
  readonly waypoints: readonly PlanWaypoint[];
  readonly configuration: PlanningSimulationConfiguration;
  readonly templateLibrary?: PlanningTemplateLibrary;
}
