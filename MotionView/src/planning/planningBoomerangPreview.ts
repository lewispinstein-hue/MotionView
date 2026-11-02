/**
 * LemLib guidance reference:
 * https://github.com/LemLib/LemLib/blob/stable/src/lemlib/chassis/motions/moveToPose.cpp
 *
 * The moving carrot, reverse-heading adjustment, settling transition, and power
 * restrictions follow that controller. EZ uses capped-carrot/projected-point
 * steering instead. Both are approximate: nominal motor envelopes and a square
 * body cannot reproduce measured traction, mass distribution, or firmware.
 */
import {
  DEFAULT_BOOMERANG_PREVIEW_CONFIGURATION,
  type BoomerangPreviewConfiguration,
} from "./planningBoomerangConfiguration";
import { PlanningPreviewPID } from "./planningPreviewPID";
import { PlanningPreviewDrivetrain } from "./planningPreviewDrivetrain";

export interface PreviewPose {
  readonly x: number;
  readonly y: number;
  /** Clockwise radians from +Y, rather than LemLib's internal standard angle. */
  readonly theta: number;
}

// Safety limit, not robot tuning. Degenerate requests must not hang rendering.
const MAX_STEPS = 20000;

function angleError(target: number, current: number): number {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** Recompute from the CURRENT position, not the initial waypoint distance. */
export function boomerangGuidance(
  pose: PreviewPose,
  target: PreviewPose,
  lead: number,
  forwards: boolean,
  wasSettling = false,
  settlingDistance = DEFAULT_BOOMERANG_PREVIEW_CONFIGURATION.settlingDistance,
) {
  const remaining = Math.hypot(target.x - pose.x, target.y - pose.y);
  const settling = wasSettling || remaining < settlingDistance;
  const travelHeading = target.theta + (forwards ? 0 : Math.PI);
  const offset = settling ? 0 : lead * remaining;
  const carrot = {
    x: target.x - Math.sin(travelHeading) * offset,
    y: target.y - Math.cos(travelHeading) * offset,
  };
  const dx = carrot.x - pose.x;
  const dy = carrot.y - pose.y;
  const carrotDistance = Math.hypot(dx, dy);
  const carrotHeading = carrotDistance > 1e-10 ? Math.atan2(dx, dy) : travelHeading;
  const alignment = Math.cos(angleError(carrotHeading, pose.theta));
  return {
    carrot,
    remaining,
    settling,
    angularError: angleError(
      settling ? travelHeading : carrotHeading,
      pose.theta + (forwards ? 0 : Math.PI),
    ),
    lateralError: carrotDistance * (settling ? alignment : Math.sign(alignment)),
  };
}

export function previewBoomerangMotion(
  start: PreviewPose,
  target: PreviewPose,
  lead: number,
  forwards: boolean,
  speed: number,
  config: BoomerangPreviewConfiguration = DEFAULT_BOOMERANG_PREVIEW_CONFIGURATION,
): Readonly<{ poses: readonly PreviewPose[]; converged: boolean }> {
  const poses: PreviewPose[] = [{ ...start }];
  let pose = start;
  let settling = false;
  let previousLateralPower = 0;
  let maxPower = Math.max(1, Math.min(127, Number(speed) || 127));
  let idleSteps = 0;
  let settledFor = 0;
  const lateralPID = new PlanningPreviewPID(config.lateralPID);
  const angularPID = new PlanningPreviewPID(config.angularPID);
  const drivetrain = new PlanningPreviewDrivetrain(config);
  let previousCarrot: { x: number; y: number } | null = null;
  let pointToFace = { x: target.x, y: target.y };
  const steps = Math.min(MAX_STEPS, Math.ceil(config.maxDurationSeconds / config.timeStepSeconds));
  for (let step = 0; step < steps; step += 1) {
    let guidance = boomerangGuidance(pose, target, lead, forwards, settling, config.settlingDistance);
    if (config.previewModel === "ez-template") {
      const remaining = Math.hypot(target.x - pose.x, target.y - pose.y);
      const close = remaining < config.lookAheadDistance / 2;
      const offset = close ? 0 : Math.min(lead * remaining, config.maxCarrotDistance);
      const travelHeading = target.theta + (forwards ? 0 : Math.PI);
      const carrot = { x: target.x - Math.sin(travelHeading) * offset, y: target.y - Math.cos(travelHeading) * offset };
      const dx = carrot.x - pose.x;
      const dy = carrot.y - pose.y;
      const distance = Math.hypot(dx, dy);
      // EZ projects the steering target beyond each updated point to avoid
      // flipping heading when passing it. Keep that projection when it settles.
      if (!previousCarrot || carrot.x !== previousCarrot.x || carrot.y !== previousCarrot.y) {
        const bearing = distance > 1e-10 ? Math.atan2(dx, dy) + (forwards ? 0 : Math.PI) : pose.theta;
        pointToFace = {
          x: pose.x + Math.sin(bearing) * (distance + config.lookAheadDistance),
          y: pose.y + Math.cos(bearing) * (distance + config.lookAheadDistance),
        };
        previousCarrot = carrot;
      }
      const bearing = Math.atan2(pointToFace.x - pose.x, pointToFace.y - pose.y);
      guidance = {
        carrot, remaining, settling: close,
        angularError: angleError(bearing, pose.theta),
        lateralError: dx * Math.sin(bearing) + dy * Math.cos(bearing),
      };
    }
    if (![guidance.remaining, guidance.angularError, guidance.lateralError].every(Number.isFinite)) break;
    const angularErrorDegrees = guidance.angularError * 180 / Math.PI;
    // Controller settlement is based on controller errors, not Euclidean
    // distance. A robot can settle with lateral offset from the requested pose.
    const errorsInRange = guidance.settling && Math.abs(guidance.lateralError) <= config.lateralTolerance &&
      Math.abs(angularErrorDegrees) <= config.angularTolerance;
    settledFor = errorsInRange ? settledFor + config.timeStepSeconds : 0;
    if (errorsInRange && settledFor >= config.settleTimeSeconds) {
      poses.push(pose);
      return { poses, converged: true };
    }
    if (config.previewModel === "lemlib" && guidance.settling && !settling)
      maxPower = Math.max(Math.abs(previousLateralPower), config.settlingMinSpeed);
    settling = guidance.settling;
    const angularPower = clamp(angularPID.update(angularErrorDegrees), maxPower);
    let lateralPower = clamp(lateralPID.update(guidance.lateralError), maxPower);
    if (!settling && config.lateralSlew > 0)
      lateralPower = previousLateralPower + clamp(lateralPower - previousLateralPower, config.lateralSlew);

    if (config.previewModel === "lemlib") {
      const dx = guidance.carrot.x - pose.x;
      const dy = guidance.carrot.y - pose.y;
      const lateralOffset = Math.abs(Math.cos(pose.theta) * dx - Math.sin(pose.theta) * dy);
      const radius = lateralOffset > 1e-10 ? (dx ** 2 + dy ** 2) / (2 * lateralOffset) : Infinity;
      const slipLimit = config.horizontalDrift > 0 ? Math.sqrt(config.horizontalDrift * radius * 9.8) : 0;
      lateralPower = clamp(lateralPower, slipLimit);
      const excess = Math.abs(angularPower) + Math.abs(lateralPower) - maxPower;
      if (excess > 0) lateralPower -= Math.sign(lateralPower) * excess;
      if (!settling) lateralPower = forwards ? Math.max(0, lateralPower) : Math.min(0, lateralPower);
    } else {
      lateralPower *= 1 - (1 - Math.cos(guidance.angularError)) / config.turnBias;
    }
    previousLateralPower = lateralPower;

    const ratio = Math.max(1, (Math.abs(lateralPower) + Math.abs(angularPower)) / maxPower);
    const { turn, travel } = drivetrain.step((lateralPower + angularPower) / ratio, (lateralPower - angularPower) / ratio);
    const midpointHeading = pose.theta + turn / 2;
    const next = {
      x: pose.x + Math.sin(midpointHeading) * travel,
      y: pose.y + Math.cos(midpointHeading) * travel,
      theta: pose.theta + turn,
    };
    if (![next.x, next.y, next.theta].every(Number.isFinite)) break;
    pose = next;
    // Bound both computation and storage for stalled/ill-conditioned requests.
    idleSteps = Math.abs(turn) + Math.abs(travel) < 1e-10 ? idleSteps + 1 : 0;
    if (step % 3 === 0) poses.push(pose);
    if (idleSteps >= 30) break;
  }
  poses.push(pose);
  // Do not invent a final straight connection when the model fails to settle.
  return { poses, converged: false };
}
