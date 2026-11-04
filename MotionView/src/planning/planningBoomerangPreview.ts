/** Standalone Boomerang adapter for focused controller tests and diagnostics. */
import {
  DEFAULT_PLANNING_SIMULATION_CONFIGURATION,
  type PlanningSimulationConfiguration,
} from "./planningSimulationConfiguration";
import { simulatePlanningRoute } from "./planningSimulation";
import type { PreviewPose } from "./planningSimulationTypes";
export type { PreviewPose } from "./planningSimulationTypes";
export { boomerangGuidance } from "./planningSimulationControllers";

export function previewBoomerangMotion(
  start: PreviewPose,
  target: PreviewPose,
  lead: number,
  forwards: boolean,
  speed: number,
  configuration: PlanningSimulationConfiguration = DEFAULT_PLANNING_SIMULATION_CONFIGURATION,
) {
  const result = simulatePlanningRoute({
    configuration,
    waypoints: [
      {
        ...start,
        theta: (start.theta * 180) / Math.PI,
        lead,
        forwards,
        speed,
        motions: [{ id: "preview", type: "boomerang" }],
      },
      { ...target, theta: (target.theta * 180) / Math.PI },
    ],
  });
  const section = result.sections[0]!;
  return {
    poses: section.samples.map(({ x, y, theta }) => ({ x, y, theta })),
    converged: section.outcome === "reached" || section.outcome === "completed",
  };
}
