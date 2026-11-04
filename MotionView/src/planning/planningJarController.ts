import type { PlanWaypointMotion } from "../state/models";
import type { PlanningPreviewDrivetrain } from "./planningPreviewDrivetrain";
import type { PlanningSimulationConfiguration, PreviewPIDConfiguration } from "./planningSimulationConfiguration";
import type { PreviewPose } from "./planningSimulationTypes";
import { angleError, type ControllerOutput } from "./planningSimulationControllers";
import { normalizePlanningMinSpeed } from "./planningMotionContext";

const VOLTS_PER_POWER = 12 / 127;
const degrees = (angle: number) => angle * 180 / Math.PI;
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
const SETTLE_DISTANCE = 3; // JAR odom_constants(); hidden nominal exit settings.
const SETTLE_TICKS = 31; // is_settled() uses >300 ms at 10 ms per tick.

/** JAR integrates only inside startI (zero disables I), and resets across zero.
 * Shared stored gains use motor power; JAR's editor and controller use volts.
 * https://github.com/JacksonAreaRobotics/JAR-Template/blob/main/src/JAR-Template/PID.cpp
 */
class JarPID {
  #integral = 0;
  #previous = 0;
  constructor(private readonly gains: PreviewPIDConfiguration, private readonly startI: number) {}
  update(error: number): number {
    if (Math.abs(error) < this.startI) this.#integral += error;
    if (error * this.#previous < 0) this.#integral = 0;
    const output = this.gains.kP * error + this.gains.kI * this.#integral +
      this.gains.kD * (error - this.#previous);
    this.#previous = error;
    return output * VOLTS_PER_POWER;
  }
}

/** JAR drive_to_point/drive_to_pose, including its automatic reverse choice,
 * target-plane exits, cosine scaling, voltage mixing and one-sided swings.
 * https://github.com/JacksonAreaRobotics/JAR-Template/blob/main/src/JAR-Template/drive.cpp
 */
export class PlanningJarController {
  readonly #drive: JarPID;
  readonly #heading: JarPID;
  readonly #maxVoltage: number;
  readonly #minVoltage: number;
  readonly #approach: number;
  #previousSide: boolean;
  readonly #initialCenterSide: boolean;
  #crossedCenter = false;
  #settledTicks = 0;

  constructor(
    readonly motion: Readonly<PlanWaypointMotion>, readonly target: PreviewPose,
    private readonly lead: number, speed: number, minSpeed: number,
    private readonly config: PlanningSimulationConfiguration, start: PreviewPose,
  ) {
    const angular = motion.type === "rotate" || motion.type === "swing";
    this.#drive = new JarPID(angular
      ? motion.type === "swing" ? config.swingPID : config.turnPID
      : config.lateralPID, angular ? 15 : 0);
    this.#heading = new JarPID(config.pointSteeringPID, 0);
    const maximum = Math.max(1, Math.min(127, Number.isFinite(speed) ? speed : 127));
    this.#maxVoltage = maximum * VOLTS_PER_POWER;
    this.#minVoltage = normalizePlanningMinSpeed(minSpeed, maximum) * VOLTS_PER_POWER;
    this.#approach = motion.type === "boomerang" ? target.theta : Math.atan2(target.x - start.x, target.y - start.y);
    this.#previousSide = this.sideOf(start, this.#approach);
    this.#initialCenterSide = this.sideOf(start, target.theta + Math.PI / 2);
  }

  update(pose: PreviewPose, _drivetrain: PlanningPreviewDrivetrain): ControllerOutput {
    const angular = this.motion.type === "rotate" || this.motion.type === "swing";
    if (angular) {
      const error = degrees(angleError(this.target.theta, pose.theta));
      const power = clamp(this.#drive.update(error), this.#maxVoltage) / VOLTS_PER_POWER;
      const arrived = this.settled(error, 1);
      if (this.motion.type === "rotate") return { left: power, right: -power, arrived };
      const heldSide = this.motion.lockedDriveSide ?? "left";
      return { left: heldSide === "left" ? 0 : power,
        right: heldSide === "right" ? 0 : -power, heldSide, arrived };
    }

    const side = this.sideOf(pose, this.#approach);
    const crossed = side && !this.#previousSide;
    this.#previousSide = side;
    if (crossed) return { left: 0, right: 0, arrived: true, chained: true };

    const remaining = Math.hypot(this.target.x - pose.x, this.target.y - pose.y);
    let carrot = this.target;
    if (this.motion.type === "boomerang") {
      this.#crossedCenter ||= this.sideOf(pose, this.target.theta + Math.PI / 2) !== this.#initialCenterSide;
      const offset = this.lead * remaining + this.config.jarSetback;
      carrot = { x: this.target.x - Math.sin(this.target.theta) * offset,
        y: this.target.y - Math.cos(this.target.theta) * offset, theta: this.target.theta };
    }
    let distance = Math.hypot(carrot.x - pose.x, carrot.y - pose.y);
    let headingError = angleError(Math.atan2(carrot.x - pose.x, carrot.y - pose.y), pose.theta);
    if (this.motion.type === "boomerang" &&
        (distance < SETTLE_DISTANCE || this.#crossedCenter || distance < this.config.jarSetback)) {
      headingError = angleError(this.target.theta, pose.theta);
      distance = remaining;
    }
    const scale = Math.cos(headingError);
    // JAR folds the heading into ±90° and reverses drive output automatically.
    const folded = headingError > Math.PI / 2 ? headingError - Math.PI
      : headingError < -Math.PI / 2 ? headingError + Math.PI : headingError;
    let drive = clamp(this.#drive.update(distance) * scale, Math.abs(scale) * this.#maxVoltage);
    let turn = clamp(this.#heading.update(degrees(folded)), this.config.jarHeadingMaxVoltage);
    if (this.motion.type === "forward" && remaining < SETTLE_DISTANCE) turn = 0;
    if (drive !== 0 && Math.abs(drive) < this.#minVoltage) drive = Math.sign(drive) * this.#minVoltage;
    // JAR scales the mixed wheel voltages at 12 V, not at the drive-only limit.
    const ratio = Math.max(1, (Math.abs(drive) + Math.abs(turn)) / 12);
    return { left: (drive + turn) / ratio / VOLTS_PER_POWER,
      right: (drive - turn) / ratio / VOLTS_PER_POWER,
      arrived: this.settled(distance, SETTLE_DISTANCE) };
  }

  private sideOf(pose: PreviewPose, heading: number): boolean {
    return (pose.x - this.target.x) * Math.sin(heading) + (pose.y - this.target.y) * Math.cos(heading) >= 0;
  }
  private settled(error: number, range: number): boolean {
    this.#settledTicks = Math.abs(error) < range ? this.#settledTicks + 1 : 0;
    return this.#settledTicks >= SETTLE_TICKS;
  }
}
