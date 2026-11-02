import type { PlanWaypointMotion } from "../state/models";
import type { PlanningSimulationConfiguration } from "./planningSimulationConfiguration";
import type { PreviewPose } from "./planningSimulationTypes";
import type { PlanningPreviewDrivetrain } from "./planningPreviewDrivetrain";
import { PlanningPreviewPID } from "./planningPreviewPID";

export const angleError = (target: number, current: number): number => Math.atan2(Math.sin(target - current), Math.cos(target - current));
const degrees = (angle: number) => angle * 180 / Math.PI;
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/** LemLib stable moveToPose(): carrot distance shrinks with CURRENT distance. */
export function boomerangGuidance(pose: PreviewPose, target: PreviewPose, lead: number, forwards: boolean, wasSettling = false, settlingDistance = 7.5) {
  const remaining = Math.hypot(target.x - pose.x, target.y - pose.y);
  const settling = wasSettling || remaining < settlingDistance;
  const travelHeading = target.theta + (forwards ? 0 : Math.PI);
  const offset = settling ? 0 : lead * remaining;
  const carrot = { x: target.x - Math.sin(travelHeading) * offset, y: target.y - Math.cos(travelHeading) * offset };
  const dx = carrot.x - pose.x, dy = carrot.y - pose.y;
  const carrotDistance = Math.hypot(dx, dy);
  const carrotHeading = carrotDistance > 1e-10 ? Math.atan2(dx, dy) : travelHeading;
  const alignment = Math.cos(angleError(carrotHeading, pose.theta));
  return { carrot, remaining, settling,
    angularError: angleError(settling ? travelHeading : carrotHeading, pose.theta + (forwards ? 0 : Math.PI)),
    lateralError: carrotDistance * (settling ? alignment : Math.sign(alignment)) };
}
export interface ControllerOutput {
  readonly left: number;
  readonly right: number;
  readonly heldSide?: "left" | "right";
  readonly arrived: boolean;
}

/** A fresh controller per action; the drivetrain and world pose remain continuous. */
export class PlanningMotionController {
  readonly #linear: PlanningPreviewPID;
  readonly #angular: PlanningPreviewPID;
  readonly #hold: PlanningPreviewPID;
  readonly #heldDistance: number;
  readonly #activeDistance: number;
  #settling = false;
  #previousLinear = 0;
  #maxPower: number;
  #ezMeasured = 0;
  #previousPose: PreviewPose;
  #previousCarrot: { x: number; y: number } | null = null;
  #pointToFace: { x: number; y: number } | null = null;
  readonly #initialPose: PreviewPose;
  constructor(
    readonly motion: Readonly<PlanWaypointMotion>, readonly target: PreviewPose,
    private readonly lead: number, private readonly forwards: boolean, speed: number,
    private readonly config: PlanningSimulationConfiguration,
    start: PreviewPose, drivetrain: PlanningPreviewDrivetrain,
  ) {
    this.#initialPose = start; this.#previousPose = start;
    this.#maxPower = Math.max(1, Math.min(127, Number.isFinite(speed) ? speed : 127));
    const ez = config.previewModel === "ez-template";
    const angular = !ez ? config.angularPID : motion.type === "rotate" ? config.turnPID : motion.type === "swing" ? config.swingPID :
      motion.type === "boomerang" ? config.boomerangSteeringPID : config.pointSteeringPID;
    this.#linear = new PlanningPreviewPID(config.lateralPID, ez);
    this.#angular = new PlanningPreviewPID(ez && motion.type === "rotate" ? { ...angular, windupRange: 15 } : angular, ez);
    this.#hold = new PlanningPreviewPID(config.lateralPID, ez);
    this.#activeDistance = motion.lockedDriveSide === "right" ? drivetrain.leftDistance : drivetrain.rightDistance;
    this.#heldDistance = motion.lockedDriveSide === "right" ? drivetrain.rightDistance : drivetrain.leftDistance;
  }

  update(pose: PreviewPose, drivetrain: PlanningPreviewDrivetrain): ControllerOutput {
    const { motion, target, config } = this;
    const ez = config.previewModel === "ez-template";
    const dx = target.x - pose.x, dy = target.y - pose.y;
    const remaining = Math.hypot(dx, dy);
    if (motion.type === "rotate" || motion.type === "swing") {
      const error = degrees(angleError(target.theta, pose.theta));
      const angularTravel = Math.abs(degrees(pose.theta - this.#initialPose.theta));
      // EZ's distance/angle-based slew differs from LemLib's power-per-tick slew.
      const slewTravel = motion.type === "swing" ? Math.abs((motion.lockedDriveSide === "right" ? drivetrain.leftDistance : drivetrain.rightDistance) - this.#activeDistance) : angularTravel;
      const floor = motion.type === "swing" ? 80 : 70;
      const limit = ez ? Math.min(this.#maxPower, floor + (this.#maxPower - floor) * Math.min(1, slewTravel / 3)) : this.#maxPower;
      let power = clamp(this.#angular.update(error, degrees(pose.theta)), limit);
      if (ez && (motion.type === "swing" ? config.swingPID : config.turnPID).kI !== 0 && Math.abs(error) < 15)
        power = clamp(power, 30);
      const arrived = Math.abs(error) <= 1;
      if (motion.type === "rotate") return { left: power, right: -power, arrived };
      const heldSide = motion.lockedDriveSide ?? "left";
      const position = heldSide === "left" ? drivetrain.leftDistance : drivetrain.rightDistance;
      const hold = ez ? clamp(this.#hold.update(this.#heldDistance - position, position), this.#maxPower) : 0;
      return { left: heldSide === "left" ? hold : power, right: heldSide === "right" ? hold : -power,
        heldSide: ez ? undefined : heldSide, arrived };
    }

    let guidance = boomerangGuidance(pose, target, this.lead, this.forwards, this.#settling);
    if (ez) {
      const close = remaining < config.lookAheadDistance / 2;
      const offset = motion.type === "boomerang" && !close ? Math.min(this.lead * remaining, config.maxCarrotDistance) : 0;
      const heading = target.theta + (this.forwards ? 0 : Math.PI);
      const carrot = { x: target.x - Math.sin(heading) * offset, y: target.y - Math.cos(heading) * offset };
      const cx = carrot.x - pose.x, cy = carrot.y - pose.y;
      const distance = Math.hypot(cx, cy);
      if (!this.#previousCarrot || carrot.x !== this.#previousCarrot.x || carrot.y !== this.#previousCarrot.y) {
        const bearing = distance > 1e-10 ? Math.atan2(cx, cy) : pose.theta;
        // EZ extends the line from the current position through its target. The
        // robot's reverse heading is applied to steering, not this projection.
        this.#pointToFace = { x: pose.x + Math.sin(bearing) * (distance + config.lookAheadDistance),
          y: pose.y + Math.cos(bearing) * (distance + config.lookAheadDistance) };
        this.#previousCarrot = carrot;
      }
      const bearing = Math.atan2(this.#pointToFace!.x - pose.x, this.#pointToFace!.y - pose.y);
      const projected = cx * Math.sin(bearing) + cy * Math.cos(bearing);
      guidance = { carrot, remaining, settling: close,
        angularError: angleError(bearing + (this.forwards ? 0 : Math.PI), pose.theta),
        lateralError: projected * (this.forwards ? 1 : -1) };
    } else if (motion.type === "forward") {
      // LemLib moveToPoint uses projected lateral error and disables steering
      // only after it has entered its close-range phase.
      const bearing = remaining > 1e-10 ? Math.atan2(dx, dy) : pose.theta;
      const close = this.#settling || remaining < 7.5;
      guidance = { carrot: target, remaining, settling: close,
        angularError: close ? 0 : angleError(bearing + (this.forwards ? 0 : Math.PI), pose.theta),
        lateralError: remaining * Math.cos(angleError(bearing, pose.theta)) };
    }
    if (!ez && motion.type === "boomerang" && guidance.settling && !this.#settling)
      this.#maxPower = Math.max(Math.abs(this.#previousLinear), 60);
    this.#settling = guidance.settling;
    const angular = clamp(this.#angular.update(degrees(guidance.angularError), degrees(pose.theta)), this.#maxPower);
    // EZ differentiates measured displacement rather than changes of moving carrot.
    this.#ezMeasured += Math.hypot(pose.x - this.#previousPose.x, pose.y - this.#previousPose.y) * Math.sign(guidance.lateralError);
    this.#previousPose = pose;
    const displacement = this.#ezMeasured;
    let linear = clamp(this.#linear.update(guidance.lateralError, displacement), this.#maxPower);
    if (!this.#settling && config.lateralSlew > 0) linear = this.#previousLinear + clamp(linear - this.#previousLinear, config.lateralSlew);
    if (!ez) {
      if (motion.type === "boomerang") {
        const cx = guidance.carrot.x - pose.x, cy = guidance.carrot.y - pose.y;
        const offset = Math.abs(Math.cos(pose.theta) * cx - Math.sin(pose.theta) * cy);
        const radius = offset > 1e-10 ? (cx * cx + cy * cy) / (2 * offset) : Infinity;
        const slipLimit = config.horizontalDrift > 0 ? Math.sqrt(config.horizontalDrift * radius * 9.8) : 0;
        linear = clamp(linear, slipLimit);
        const excess = Math.abs(angular) + Math.abs(linear) - this.#maxPower;
        if (excess > 0) linear -= Math.sign(linear) * excess;
      }
      if (!this.#settling) linear = this.forwards ? Math.max(0, linear) : Math.min(0, linear);
    } else linear *= 1 - (1 - Math.cos(guidance.angularError)) / config.turnBias;
    this.#previousLinear = linear;
    const slewDistance = Math.hypot(pose.x - this.#initialPose.x, pose.y - this.#initialPose.y);
    const limit = ez && config.ezSlewDistance > 0
      ? Math.min(this.#maxPower, 70 + (this.#maxPower - 70) * Math.min(1, slewDistance / config.ezSlewDistance)) : this.#maxPower;
    const ratio = Math.max(1, (Math.abs(linear) + Math.abs(angular)) / limit);
    const arrived = motion.type === "forward" ? remaining <= 0.5 : guidance.settling &&
      Math.abs(guidance.lateralError) <= 0.5 && Math.abs(degrees(guidance.angularError)) <= 1;
    return { left: (linear + angular) / ratio, right: (linear - angular) / ratio, arrived };
  }
}
