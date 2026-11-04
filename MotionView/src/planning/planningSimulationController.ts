import type { PlanWaypointMotion } from "../state/models";
import type { PlanningSimulationConfiguration } from "./planningSimulationConfiguration";
import type { PlanningPreviewDrivetrain } from "./planningPreviewDrivetrain";
import type { PreviewPose } from "./planningSimulationTypes";
import { PlanningMotionController, type ControllerOutput } from "./planningSimulationControllers";
import { PlanningJarController } from "./planningJarController";
import { PlanningVexcodeController } from "./planningVexcodeController";

export interface SimulationMotionController {
  update(pose: PreviewPose, drivetrain: PlanningPreviewDrivetrain): ControllerOutput;
}

/** Controllers own library semantics; every model drives the same physical plant. */
export function createPlanningSimulationController(
  motion: Readonly<PlanWaypointMotion>, target: PreviewPose, lead: number,
  forwards: boolean, speed: number, config: PlanningSimulationConfiguration,
  start: PreviewPose, drivetrain: PlanningPreviewDrivetrain, minSpeed = 0,
): SimulationMotionController {
  if (config.previewModel === "jar-template")
    return new PlanningJarController(motion, target, lead, speed, minSpeed, config, start);
  if (config.previewModel === "vexcode")
    return new PlanningVexcodeController(motion, target, speed, config, start, drivetrain);
  return new PlanningMotionController(motion, target, lead, forwards, speed, config, start, drivetrain, minSpeed);
}
