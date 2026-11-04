import type { PlanWaypointMotion } from "../state/models";
import type { PlanningPreviewDrivetrain } from "./planningPreviewDrivetrain";
import type { PlanningSimulationConfiguration } from "./planningSimulationConfiguration";
import type { PreviewPose } from "./planningSimulationTypes";
import { angleError, type ControllerOutput } from "./planningSimulationControllers";

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
const TICK = .01;
const METRES_PER_INCH = .0254;
const KG_PER_POUND = .45359237;
// Nominal motor response plus the normalized velocity loop's tracking delay.
const VELOCITY_RESPONSE_SECONDS = .06;

function stoppingVelocity(distance: number, acceleration: number): number {
  const lag = acceleration * VELOCITY_RESPONSE_SECONDS;
  return Math.sqrt(lag * lag + 2 * acceleration * distance) - lag;
}

/** Approximation of VEXcode's built-in distance/heading and velocity loops.
 * The firmware's internal gains are not user PID tuning. A bounded velocity
 * servo feeds the same motor/traction/mass model as every other library.
 * https://api.vex.com/v5/home/python/Drivetrain.html
 */
export class PlanningVexcodeController {
  readonly #startDistance: number;
  readonly #distance: number;
  readonly #heading: number;
  readonly #maxWheelSpeed: number;
  readonly #acceleration: number;
  readonly #feedbackScale: number;
  #leftIntegral = 0;
  #rightIntegral = 0;
  #leftVelocity: number;
  #rightVelocity: number;
  #settledTicks = 0;

  constructor(
    readonly motion: Readonly<PlanWaypointMotion>, readonly target: PreviewPose,
    speed: number, private readonly config: PlanningSimulationConfiguration,
    start: PreviewPose, drivetrain: PlanningPreviewDrivetrain,
  ) {
    this.#startDistance = (drivetrain.leftDistance + drivetrain.rightDistance) / 2;
    this.#heading = start.theta;
    this.#leftVelocity = drivetrain.linearVelocity + drivetrain.angularVelocity * config.trackWidth / 2;
    this.#rightVelocity = drivetrain.linearVelocity - drivetrain.angularVelocity * config.trackWidth / 2;
    this.#distance = (target.x - start.x) * Math.sin(start.theta) + (target.y - start.y) * Math.cos(start.theta);
    const fraction = Math.max(1, Math.min(127, Number.isFinite(speed) ? speed : 127)) / 127;
    this.#maxWheelSpeed = config.maxSpeedInchesPerSecond * fraction;
    // Nominal available wheel power / speed estimates force; traction bounds it.
    const force = config.motorWatts * .85 / (config.maxSpeedInchesPerSecond * METRES_PER_INCH);
    this.#acceleration = Math.min(.8 * 9.81, force / (config.robotWeightPounds * KG_PER_POUND)) / METRES_PER_INCH;
    // Motor-command acceleration scales with power / (geared speed × mass).
    // Normalize feedback around the nominal robot so a stronger drivetrain
    // does not acquire a different low-speed settling response from fixed gains.
    this.#feedbackScale = (66 / config.motorWatts) *
      (config.maxSpeedInchesPerSecond / 60) * (config.robotWeightPounds / 15);
  }

  update(pose: PreviewPose, drivetrain: PlanningPreviewDrivetrain): ControllerOutput {
    const turning = this.motion.type === "rotate" || this.motion.type === "swing";
    let desiredLinear = 0, desiredAngular = 0;
    let close: boolean;
    if (turning) {
      const error = angleError(this.target.theta, pose.theta);
      const threshold = this.config.vexTurnThreshold * Math.PI / 180;
      const remaining = Math.max(0, Math.abs(error) - threshold / 4);
      const maxAngular = 2 * this.#maxWheelSpeed / this.config.trackWidth;
      const braking = stoppingVelocity(remaining, 2 * this.#acceleration / this.config.trackWidth);
      desiredAngular = Math.sign(error) * Math.min(maxAngular, braking,
        Math.abs(error) * 5 * this.config.vexTurnConstant);
      close = Math.abs(error) <= threshold && Math.abs(drivetrain.angularVelocity) < .08;
    } else {
      // driveFor measures signed wheel travel; lateral position is not a target.
      const traveled = (drivetrain.leftDistance + drivetrain.rightDistance) / 2 - this.#startDistance;
      const error = this.#distance - traveled;
      desiredLinear = Math.sign(error) * Math.min(this.#maxWheelSpeed,
        stoppingVelocity(Math.abs(error), this.#acceleration), Math.abs(error) * 10);
      // Inside the existing position tolerance, request a stop instead of
      // spending additional time creeping toward a zero-error asymptote.
      if (Math.abs(error) <= .25) desiredLinear = 0;
      desiredAngular = clamp(angleError(this.#heading, pose.theta) * 5,
        2 * this.#maxWheelSpeed / this.config.trackWidth);
      close = Math.abs(error) <= .25 && Math.abs(drivetrain.linearVelocity) < .5 &&
        Math.abs(drivetrain.angularVelocity) < .08;
    }
    const halfWidth = this.config.trackWidth / 2;
    let leftTarget = desiredLinear + desiredAngular * halfWidth;
    let rightTarget = desiredLinear - desiredAngular * halfWidth;
    const targetRatio = Math.max(1, Math.max(Math.abs(leftTarget), Math.abs(rightTarget)) / this.#maxWheelSpeed);
    leftTarget /= targetRatio; rightTarget /= targetRatio;
    // The native controller plans acceleration as well as velocity. Keeping its
    // reference continuous prevents a stronger motor from braking against an
    // instantaneous target jump and then spending longer correcting the result.
    this.#leftVelocity += clamp(leftTarget - this.#leftVelocity, this.#acceleration * TICK);
    this.#rightVelocity += clamp(rightTarget - this.#rightVelocity, this.#acceleration * TICK);
    leftTarget = this.#leftVelocity; rightTarget = this.#rightVelocity;
    const leftError = leftTarget - (drivetrain.linearVelocity + drivetrain.angularVelocity * halfWidth);
    const rightError = rightTarget - (drivetrain.linearVelocity - drivetrain.angularVelocity * halfWidth);
    this.#leftIntegral = leftTarget === 0 ? 0 : clamp(this.#leftIntegral + leftError * TICK, 2);
    this.#rightIntegral = rightTarget === 0 ? 0 : clamp(this.#rightIntegral + rightError * TICK, 2);
    // The shared motor curve uses a 1.6 no-load/free-speed ratio. Feed-forward
    // accounts for that curve rather than equating velocity percent to voltage.
    const feedForward = 127 / (this.config.maxSpeedInchesPerSecond * 1.6);
    const left = leftTarget * feedForward + (leftError * 3 + this.#leftIntegral * 2) * this.#feedbackScale;
    const right = rightTarget * feedForward + (rightError * 3 + this.#rightIntegral * 2) * this.#feedbackScale;
    this.#settledTicks = close ? this.#settledTicks + 1 : 0;
    // BRAKE is VEXcode's default: wait for the native servo to settle before
    // returning, while retaining the actual small residual drivetrain state.
    const ratio = Math.max(1, Math.max(Math.abs(left), Math.abs(right)) / 127);
    return { left: left / ratio, right: right / ratio,
      arrived: this.#settledTicks >= 5 };
  }
}
