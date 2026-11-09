import type { PlanWaypoint, PlanWaypointMotion } from "../state/models";
import {
  isBoomerangWaypoint,
  isSegmentForwards,
  normalizePlanningMinSpeed,
  segmentDriveHeading,
  waypointLead,
} from "./planningMotionContext";
import { angleError } from "./planningSimulationControllers";
import { createPlanningSimulationController } from "./planningSimulationController";
import { PlanningPreviewDrivetrain } from "./planningPreviewDrivetrain";
import { planningMotionsForLibrary, isVexcodePlanningLibrary, supportsPlanningMinSpeed } from "./planningTemplateCapabilities";
import { LEMLIB_PLANNING_TIMEOUT_MS, type PlanningTemplateLibrary } from "./planningTemplatePresets";
import type {
  PlanningSimulationRequest,
  PlanningSimulationResult,
  PreviewPose,
  SimulatedMotion,
  SimulatedSection,
  SimulationCompletionOffset,
  SimulationOutcome,
  SimulationSample,
} from "./planningSimulationTypes";

export const SIMULATION_TIME_STEP = 0.01;
const MAX_MOTION_STEPS = 12000; // Numerical guard, never presented as a robot timeout.
const ARRIVAL_DWELL_STEPS = 5;
const STANDSTILL_WINDOW = 100;
type MotionRunResult =
  | { outcome: Exclude<SimulationOutcome, "completed"> }
  | { outcome: "completed"; offset: SimulationCompletionOffset };
const poseOf = (p: Readonly<PlanWaypoint>): PreviewPose => ({
  x: p.x,
  y: p.y,
  theta: ((p.theta ?? 0) * Math.PI) / 180,
});
const targetErrorFor = (type: PlanWaypointMotion["type"], target: PreviewPose, pose: PreviewPose): number =>
  type === "rotate" || type === "swing"
    ? Math.abs(angleError(target.theta, pose.theta)) * 180 / Math.PI
    : Math.hypot(target.x - pose.x, target.y - pose.y);
function motionsOf(
  point: Readonly<PlanWaypoint>,
  index: number,
  library: PlanningTemplateLibrary = "custom",
  model?: PlanningSimulationRequest["configuration"]["previewModel"],
): readonly Readonly<PlanWaypointMotion>[] {
  return planningMotionsForLibrary(point.motions?.length
    ? point.motions
    : [
        {
          id: `legacy-${index}`,
          type: isBoomerangWaypoint(point) ? "boomerang" : "forward",
          overrideCode: point.overrideCode,
        },
      ], model === "vexcode" ? "vexcode-cpp" : library);
}
function motionTimeoutMs(request: PlanningSimulationRequest, motion: Readonly<PlanWaypointMotion>): number | undefined {
  // The built-in LemLib command has a known timeout. Overrides can use a
  // different one, and their source is intentionally opaque to the preview.
  if (request.configuration.previewModel === "lemlib" && request.templateLibrary === "lemlib" &&
      motion.overrideCode === undefined) {
    return LEMLIB_PLANNING_TIMEOUT_MS[motion.type];
  }
  return undefined;
}
export function simulationSectionKey(
  request: PlanningSimulationRequest,
  index: number,
): string {
  const start = request.waypoints[index]!,
    end = request.waypoints[index + 1]!;
  return JSON.stringify([
    start.x,
    start.y,
    start.theta ?? 0,
    start.speed ?? 127,
    normalizePlanningMinSpeed(start.minSpeed, start.speed),
    isSegmentForwards(start, end),
    motionsOf(start, index, request.templateLibrary, request.configuration.previewModel).some((m) => m.type === "boomerang")
      ? waypointLead(start)
      : 0,
    end.x,
    end.y,
    end.theta ?? 0,
    index === request.waypoints.length - 2,
    motionsOf(start, index, request.templateLibrary, request.configuration.previewModel).map((m) => [
      m.id,
      m.type,
      motionTimeoutMs(request, m),
      m.lockedDriveSide ?? "left",
      supportsPlanningMinSpeed(request.templateLibrary ?? "custom", m.type),
    ]),
    request.configuration,
    isVexcodePlanningLibrary(request.templateLibrary ?? "custom") ? "turn-then-drive" : false,
  ]);
}
/** Pure deterministic engine, used in a worker in the app and directly by tests. */
export function simulatePlanningRoute(
  request: PlanningSimulationRequest,
  previous?: PlanningSimulationResult,
): PlanningSimulationResult {
  if (request.waypoints.length < 2)
    return { sections: [], duration: 0, complete: true };
  let pose = poseOf(request.waypoints[0]!);
  let time = 0,
    distance = 0;
  const sections: SimulatedSection[] = [];
  let index = 0;
  // Reuse only a matching PREFIX: changing a preceding motion affects every
  // downstream starting state even when those waypoint coordinates are unchanged.
  for (; index < request.waypoints.length - 1; index++) {
    const section = previous?.sections[index];
    if (!section || section.key !== simulationSectionKey(request, index)) break;
    sections.push(section);
    const last = section.samples.at(-1)!;
    pose = last;
    time = last.time;
    distance = last.distance;
    if (section.outcome === "incomplete")
      return { sections, duration: time, complete: false };
  }
  const model = request.configuration.previewModel;
  const vexcodeTemplate = isVexcodePlanningLibrary(request.templateLibrary ?? "custom");
  const drivetrain = new PlanningPreviewDrivetrain(
    request.configuration,
    sections.at(-1)?.drivetrainState,
    model === "lemlib" && !vexcodeTemplate,
  );
  const controllerSettles = ["lemlib", "jar-template", "vexcode"].includes(model);
  const sample = (): SimulationSample => ({
    ...pose,
    time,
    distance,
    linearVelocity: drivetrain.linearVelocity,
    angularVelocity: drivetrain.angularVelocity,
  });
  const runMotion = (
    motion: Readonly<PlanWaypointMotion>,
    target: PreviewPose,
    lead: number,
    forwards: boolean,
    speed: number,
    samples: SimulationSample[],
    minSpeed = 0,
  ): MotionRunResult => {
    const controller = createPlanningSimulationController(
      motion, target, lead, forwards, speed, request.configuration, pose, drivetrain, minSpeed,
    );
    let result: MotionRunResult = { outcome: "incomplete" };
    let dwell = 0;
    const movement: number[] = [], rotation: number[] = [];
    let moved = 0, turned = 0;
    const timeout = motionTimeoutMs(request, motion);
    for (let step = 0; step < MAX_MOTION_STEPS; step++) {
      if (timeout !== undefined && step * SIMULATION_TIME_STEP * 1000 >= timeout) {
        result = { outcome: "missed" };
        break;
      }
      const output = controller.update(pose, drivetrain);
      if (![output.left, output.right, pose.x, pose.y, pose.theta].every(Number.isFinite)) break;
      // A fast crossing is not a settled arrival: ending the controller there
      // creates an exaggerated coast even for an otherwise well-tuned PID.
      const angularMotion = motion.type === "rotate" || motion.type === "swing";
      const settledVelocity = angularMotion
        ? Math.abs(drivetrain.angularVelocity) < 0.15
        : Math.abs(drivetrain.linearVelocity) < 3 &&
          (motion.type !== "boomerang" || Math.abs(drivetrain.angularVelocity) < 0.15);
      dwell = output.arrived && settledVelocity ? dwell + 1 : 0;
      // These controllers apply their own exit windows rather than the generic
      // velocity/XY gate used by the EZ and combined Custom approximation.
      const finished = output.chained || (controllerSettles ? output.arrived : dwell >= ARRIVAL_DWELL_STEPS);
      const delta = drivetrain.step(
        finished ? 0 : output.left,
        finished ? 0 : output.right,
        finished ? undefined : output.heldSide,
      );
      const mid = pose.theta + delta.turn / 2;
      pose = {
        x: pose.x + Math.sin(mid) * delta.travel,
        y: pose.y + Math.cos(mid) * delta.travel,
        theta: pose.theta + delta.turn,
      };
      if (![pose.x, pose.y, pose.theta].every(Number.isFinite)) break;
      distance += Math.abs(delta.travel);
      time += SIMULATION_TIME_STEP;
      moved += Math.abs(delta.travel);
      turned += Math.abs(delta.turn);
      movement.push(Math.abs(delta.travel));
      rotation.push(Math.abs(delta.turn));
      if (movement.length > STANDSTILL_WINDOW) {
        moved -= movement.shift()!;
        turned -= rotation.shift()!;
      }
      if (step % 3 === 0) samples.push(sample());
      if (finished) {
        const error = targetErrorFor(motion.type, target, pose);
        if (error <= 1 || (!controllerSettles && angularMotion)) {
          result = { outcome: "reached" };
        } else if (controllerSettles) {
          const reason = output.chained
            ? model === "jar-template" ? "target-plane" : "minimum-speed"
            : "settling";
          result = { outcome: "completed", offset: { reason, motionType: motion.type, error } };
        } else {
          result = { outcome: "missed" };
        }
        break;
      }
      if (movement.length === STANDSTILL_WINDOW && moved < 0.05 && turned < Math.PI / 720) {
        result = { outcome: "stalled" };
        break;
      }
    }
    // Include stage boundaries too, so the VEXcode alignment turn consumes time.
    if (samples.at(-1)!.time !== time) samples.push(sample());
    return result;
  };
  for (; index < request.waypoints.length - 1; index++) {
    const start = request.waypoints[index]!,
      target = poseOf(request.waypoints[index + 1]!);
    const samples: SimulationSample[] = [sample()];
    const motions: SimulatedMotion[] = [];
    let sectionOutcome: SimulationOutcome = "reached";
    let completionOffset: SimulationCompletionOffset | undefined;
    for (const motion of motionsOf(start, index, request.templateLibrary, request.configuration.previewModel)) {
      const forwards = isSegmentForwards(start, request.waypoints[index + 1]);
      const startTime = time;
      const vexcodeStraight = (vexcodeTemplate || model === "vexcode") && motion.type === "forward";
      const driveDistance = Math.hypot(target.x - start.x, target.y - start.y) * (forwards ? 1 : -1);
      let result: MotionRunResult = { outcome: "reached" };
      if (vexcodeStraight && Math.abs(driveDistance) > 1e-10) {
        result = runMotion(
          { id: motion.id, type: "rotate" },
          { ...target, theta: segmentDriveHeading(start, request.waypoints[index + 1]) * Math.PI / 180 },
          0, forwards, start.speed ?? 127, samples,
        );
      }
      if (result.outcome !== "incomplete") {
        // Match turnToHeading + driveFor: keep the actual pose after alignment,
        // then drive the exported distance along its heading without snapping.
        const motionTarget = vexcodeStraight
          ? { x: pose.x + Math.sin(pose.theta) * driveDistance, y: pose.y + Math.cos(pose.theta) * driveDistance, theta: pose.theta }
          : target;
        const drive = runMotion(motion, motionTarget, waypointLead(start), forwards, start.speed ?? 127, samples,
          supportsPlanningMinSpeed(request.templateLibrary ?? "custom", motion.type)
            ? normalizePlanningMinSpeed(start.minSpeed, start.speed) : 0);
        if (result.outcome === "reached" || (result.outcome === "completed" && drive.outcome !== "reached") || drive.outcome === "incomplete")
          result = drive;
        if (result.outcome === "reached" && motion.type === "forward") {
          const error = targetErrorFor(motion.type, target, pose);
          if (error > 1) {
            result = model === "lemlib"
              ? { outcome: "completed", offset: { reason: "distance-drive", motionType: motion.type, error } }
              : { outcome: "missed" };
          }
        }
      }
      const { outcome } = result;
      const targetError = targetErrorFor(motion.type, target, pose);
      motions.push({
        motionId: motion.id,
        type: motion.type,
        startTime,
        endTime: time,
        outcome,
        targetError,
      });
      if (outcome !== "reached" && (outcome !== "completed" || sectionOutcome === "reached")) {
        sectionOutcome = outcome;
        completionOffset = result.outcome === "completed" ? result.offset : undefined;
      } else if (
        result.outcome === "completed" &&
        completionOffset?.reason === "minimum-speed" &&
        result.offset.reason !== "minimum-speed"
      ) {
        // An expected chain should not hide an offset in a later motion.
        completionOffset = result.offset;
      }
      if (outcome === "incomplete") break;
    }
    // Once the final command ends, show the nominal coast to rest too. Earlier
    // boundaries immediately hand their velocity to the next controller.
    if (
      index === request.waypoints.length - 2 &&
      sectionOutcome !== "incomplete"
    ) {
      for (
        let step = 0;
        step < MAX_MOTION_STEPS &&
        (Math.abs(drivetrain.linearVelocity) > 0.01 ||
          Math.abs(drivetrain.angularVelocity) > 0.001);
        step++
      ) {
        const delta = drivetrain.step(0, 0);
        const mid = pose.theta + delta.turn / 2;
        pose = {
          x: pose.x + Math.sin(mid) * delta.travel,
          y: pose.y + Math.cos(mid) * delta.travel,
          theta: pose.theta + delta.turn,
        };
        distance += Math.abs(delta.travel);
        time += SIMULATION_TIME_STEP;
        if (step % 3 === 0) samples.push(sample());
      }
      if (samples.at(-1)!.time !== time) samples.push(sample());
      if (
        Math.abs(drivetrain.linearVelocity) > 0.01 ||
        Math.abs(drivetrain.angularVelocity) > 0.001
      )
        sectionOutcome = "incomplete";
      const finalMotion = motions.at(-1);
      if (controllerSettles && sectionOutcome === "reached" && finalMotion) {
        const error = targetErrorFor(finalMotion.type, target, pose);
        if (error > 1) {
          sectionOutcome = "completed";
          completionOffset = { reason: "coast", motionType: finalMotion.type, error };
        }
      }
    }
    sections.push({
      key: simulationSectionKey(request, index),
      samples,
      motions,
      outcome: sectionOutcome,
      ...(sectionOutcome === "completed" && completionOffset ? { completionOffset } : {}),
      drivetrainState: drivetrain.state,
    });
    if (sectionOutcome === "incomplete")
      return { sections, duration: time, complete: false };
  }
  return { sections, duration: time, complete: true };
}
