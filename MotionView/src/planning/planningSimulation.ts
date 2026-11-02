import type { PlanWaypoint, PlanWaypointMotion } from "../state/models";
import { isBoomerangWaypoint, isSegmentForwards, waypointLead } from "./planningMotionContext";
import { PlanningMotionController } from "./planningSimulationControllers";
import { PlanningPreviewDrivetrain } from "./planningPreviewDrivetrain";
import type { PlanningSimulationRequest, PlanningSimulationResult, PreviewPose, SimulatedMotion, SimulatedSection, SimulationOutcome, SimulationSample } from "./planningSimulationTypes";

export const SIMULATION_TIME_STEP = 0.01;
const MAX_MOTION_STEPS = 12000; // Numerical guard, never presented as a robot timeout.
const ARRIVAL_DWELL_STEPS = 5;
const STANDSTILL_WINDOW = 100;
const poseOf = (p: Readonly<PlanWaypoint>): PreviewPose => ({ x: p.x, y: p.y, theta: (p.theta ?? 0) * Math.PI / 180 });
function motionsOf(point: Readonly<PlanWaypoint>, index: number): readonly Readonly<PlanWaypointMotion>[] {
  return point.motions?.length ? point.motions : [{ id: `legacy-${index}`, type: isBoomerangWaypoint(point) ? "boomerang" : "forward" }];
}
export function simulationSectionKey(request: PlanningSimulationRequest, index: number): string {
  const start = request.waypoints[index]!, end = request.waypoints[index + 1]!;
  return JSON.stringify([start.x, start.y, start.theta ?? 0, start.speed ?? 127,
    isSegmentForwards(start, end), motionsOf(start, index).some(m => m.type === "boomerang") ? waypointLead(start) : 0, end.x, end.y, end.theta ?? 0,
    index === request.waypoints.length - 2, motionsOf(start, index).map(m => [m.id, m.type, m.lockedDriveSide ?? "left"]), request.configuration]);
}
/** Pure deterministic engine, used in a worker in the app and directly by tests. */
export function simulatePlanningRoute(request: PlanningSimulationRequest, previous?: PlanningSimulationResult): PlanningSimulationResult {
  if (request.waypoints.length < 2) return { sections: [], duration: 0, complete: true };
  let pose = poseOf(request.waypoints[0]!);
  let time = 0, distance = 0;
  const sections: SimulatedSection[] = [];
  let index = 0;
  // Reuse only a matching PREFIX: changing a preceding motion affects every
  // downstream starting state even when those waypoint coordinates are unchanged.
  for (; index < request.waypoints.length - 1; index++) {
    const section = previous?.sections[index];
    if (!section || section.key !== simulationSectionKey(request, index)) break;
    sections.push(section);
    const last = section.samples.at(-1)!;
    pose = last; time = last.time; distance = last.distance;
    if (section.outcome === "incomplete") return { sections, duration: time, complete: false };
  }
  const drivetrain = new PlanningPreviewDrivetrain(request.configuration, sections.at(-1)?.drivetrainState);
  const sample = (): SimulationSample => ({ ...pose, time, distance,
    linearVelocity: drivetrain.linearVelocity, angularVelocity: drivetrain.angularVelocity });
  for (; index < request.waypoints.length - 1; index++) {
    const start = request.waypoints[index]!, target = poseOf(request.waypoints[index + 1]!);
    const samples: SimulationSample[] = [sample()];
    const motions: SimulatedMotion[] = [];
    let sectionOutcome: SimulationOutcome = "reached";
    for (const motion of motionsOf(start, index)) {
      const controller = new PlanningMotionController(motion, target, waypointLead(start),
        isSegmentForwards(start, request.waypoints[index + 1]), start.speed ?? 127, request.configuration, pose, drivetrain);
      const startTime = time;
      let outcome: SimulationOutcome = "incomplete", dwell = 0;
      const movement: number[] = [], rotation: number[] = [];
      let moved = 0, turned = 0;
      for (let step = 0; step < MAX_MOTION_STEPS; step++) {
        const output = controller.update(pose, drivetrain);
        if (![output.left, output.right, pose.x, pose.y, pose.theta].every(Number.isFinite)) break;
        // A fast crossing is not a settled arrival: ending the controller there
        // creates an exaggerated coast even for an otherwise well-tuned PID.
        const angularMotion = motion.type === "rotate" || motion.type === "swing";
        const settledVelocity = angularMotion ? Math.abs(drivetrain.angularVelocity) < 0.15 :
          Math.abs(drivetrain.linearVelocity) < 3 && (motion.type !== "boomerang" || Math.abs(drivetrain.angularVelocity) < 0.15);
        dwell = output.arrived && settledVelocity ? dwell + 1 : 0;
        const finished = dwell >= ARRIVAL_DWELL_STEPS;
        const delta = drivetrain.step(finished ? 0 : output.left, finished ? 0 : output.right, finished ? undefined : output.heldSide);
        const mid = pose.theta + delta.turn / 2;
        pose = { x: pose.x + Math.sin(mid) * delta.travel, y: pose.y + Math.cos(mid) * delta.travel, theta: pose.theta + delta.turn };
        if (![pose.x, pose.y, pose.theta].every(Number.isFinite)) break;
        distance += Math.abs(delta.travel); time += SIMULATION_TIME_STEP;
        moved += Math.abs(delta.travel); turned += Math.abs(delta.turn);
        movement.push(Math.abs(delta.travel)); rotation.push(Math.abs(delta.turn));
        if (movement.length > STANDSTILL_WINDOW) { moved -= movement.shift()!; turned -= rotation.shift()!; }
        if (step % 3 === 0) samples.push(sample());
        if (finished) {
          outcome = motion.type === "rotate" || motion.type === "swing" || Math.hypot(target.x - pose.x, target.y - pose.y) <= 1 ? "reached" : "missed";
          break;
        }
        if (movement.length === STANDSTILL_WINDOW && moved < 0.05 && turned < Math.PI / 720) { outcome = "stalled"; break; }
      }
      // Motion boundaries always have exact timestamps, including standstill.
      if (samples.at(-1)!.time !== time) samples.push(sample());
      const targetError = motion.type === "rotate" || motion.type === "swing"
        ? Math.abs(Math.atan2(Math.sin(target.theta - pose.theta), Math.cos(target.theta - pose.theta))) * 180 / Math.PI
        : Math.hypot(target.x - pose.x, target.y - pose.y);
      motions.push({ motionId: motion.id, type: motion.type, startTime, endTime: time, outcome, targetError });
      if (outcome !== "reached") sectionOutcome = outcome;
      if (outcome === "incomplete") break;
    }
    // Once the final command ends, show the nominal coast to rest too. Earlier
    // boundaries immediately hand their velocity to the next controller.
    if (index === request.waypoints.length - 2 && sectionOutcome !== "incomplete") {
      for (let step = 0; step < MAX_MOTION_STEPS && (Math.abs(drivetrain.linearVelocity) > 0.01 || Math.abs(drivetrain.angularVelocity) > 0.001); step++) {
        const delta = drivetrain.step(0, 0);
        const mid = pose.theta + delta.turn / 2;
        pose = { x: pose.x + Math.sin(mid) * delta.travel, y: pose.y + Math.cos(mid) * delta.travel, theta: pose.theta + delta.turn };
        distance += Math.abs(delta.travel); time += SIMULATION_TIME_STEP;
        if (step % 3 === 0) samples.push(sample());
      }
      if (samples.at(-1)!.time !== time) samples.push(sample());
      if (Math.abs(drivetrain.linearVelocity) > 0.01 || Math.abs(drivetrain.angularVelocity) > 0.001) sectionOutcome = "incomplete";
    }
    sections.push({ key: simulationSectionKey(request, index), samples, motions, outcome: sectionOutcome, drivetrainState: drivetrain.state });
    if (sectionOutcome === "incomplete") return { sections, duration: time, complete: false };
  }
  return { sections, duration: time, complete: true };
}
