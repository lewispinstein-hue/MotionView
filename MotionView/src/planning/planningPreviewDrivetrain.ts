import {
  normalizePlanningMotorWatts,
  type PlanningSimulationConfiguration,
} from "./planningSimulationConfiguration";

const METRES_PER_INCH = 0.0254;
const KG_PER_POUND = 0.45359237;
// Nominal hidden assumptions; these are deliberately not document configuration.
const EFFICIENCY = 0.85;
const TRACTION = 0.8;
const ROLLING_RESISTANCE = 0.025;
const STATIC_RESISTANCE = 0.035;
const SUBSTEP = 0.002;
const MOTOR_RESPONSE_SECONDS = 0.02;
// Nominal response for LemLib's open-loop motor commands. Yaw includes the
// rotating drivetrain load and wheel scrub in addition to chassis inertia.
const LEMLIB_MOTOR_RESPONSE_SECONDS = 0.085;
const LEMLIB_YAW_INERTIA_MULTIPLIER = 3;
const LEMLIB_YAW_DAMPING = 3;

/** Maximize pairs of 11W motors, then fill the remaining power with 5.5W motors. */
export function inferPlanningDriveMotors(watts: number) {
  const total = normalizePlanningMotorWatts(watts);
  const elevenWatt = Math.floor(total / 22) * 2;
  return {
    elevenWatt,
    fivePointFiveWatt: Math.round((total - elevenWatt * 11) / 5.5),
  };
}

function motorForce(
  torque: number,
  ratedRPM: number,
  watts: number,
  velocity: number,
  power: number,
  maxSpeed: number,
  openLoop: boolean,
): number {
  if (power === 0) return 0; // Coast, rather than applying an invented zero-command electrical brake.
  const command = Math.max(-1, Math.min(1, power / 127));
  const normalizedSpeed = velocity / maxSpeed;
  const freeSpeedRatio = 1.6;
  // For a voltage command, back EMF reduces the available torque as the
  // wheel approaches the requested speed.
  const torqueRequest = openLoop
    ? command - normalizedSpeed
    : (command - normalizedSpeed / freeSpeedRatio) / (1 - 1 / freeSpeedRatio);
  const torqueFraction = Math.max(
    -1,
    Math.min(1, torqueRequest),
  );
  const angularSpeed = (ratedRPM * Math.PI) / 30;
  const mechanicalPower = Math.abs(
    torque * torqueFraction * angularSpeed * normalizedSpeed,
  );
  return (
    (torque *
      torqueFraction *
      (mechanicalPower > watts ? watts / mechanicalPower : 1) *
      angularSpeed) / maxSpeed);
}

export interface PreviewDrivetrainState {
  readonly linearVelocityMetresPerSecond: number;
  readonly angularVelocityRadiansPerSecond: number;
  readonly leftDistance: number;
  readonly rightDistance: number;
  readonly leftResponse: number;
  readonly rightResponse: number;
  readonly heldSide?: "left" | "right";
}

/** Stateful nominal differential drive, shared across every motion in a route. */
export class PlanningPreviewDrivetrain {
  #linearVelocity = 0;
  #angularVelocity = 0;
  #leftDistance = 0;
  #rightDistance = 0;
  #leftResponse = 0;
  #rightResponse = 0;
  #heldSide: "left" | "right" | undefined;
  readonly #motors;
  constructor(
    private readonly config: PlanningSimulationConfiguration,
    state?: PreviewDrivetrainState,
    private readonly useLemLibMotorResponse = config.previewModel === "lemlib",
  ) {
    this.#motors = inferPlanningDriveMotors(config.motorWatts);
    this.#linearVelocity = state?.linearVelocityMetresPerSecond ?? 0;
    this.#angularVelocity = state?.angularVelocityRadiansPerSecond ?? 0;
    this.#leftDistance = state?.leftDistance ?? 0;
    this.#rightDistance = state?.rightDistance ?? 0;
    this.#heldSide = state?.heldSide;
    this.#leftResponse = state?.leftResponse ?? 0;
    this.#rightResponse = state?.rightResponse ?? 0;
  }
  get state(): PreviewDrivetrainState {
    return {
      linearVelocityMetresPerSecond: this.#linearVelocity,
      angularVelocityRadiansPerSecond: this.#angularVelocity,
      leftDistance: this.#leftDistance,
      rightDistance: this.#rightDistance,
      heldSide: this.#heldSide,
      leftResponse: this.#leftResponse,
      rightResponse: this.#rightResponse,
    };
  }
  get linearVelocity(): number {
    return this.#linearVelocity / METRES_PER_INCH;
  }
  get angularVelocity(): number {
    return this.#angularVelocity;
  }
  get leftDistance(): number {
    return this.#leftDistance;
  }
  get rightDistance(): number {
    return this.#rightDistance;
  }

  step(
    leftPower: number,
    rightPower: number,
    heldSide?: "left" | "right",
  ): { travel: number; turn: number } {
    // PROS move() receives integers; VEX voltage/native velocity loops use the
    // motor's millivolt resolution. Physics stays common to every controller.
    const resolution =
      this.config.previewModel === "jar-template" ||
      this.config.previewModel === "vexcode"
        ? 12000 / 127
        : 1;
    const command = (power: number) =>
      (Math.sign(power) *
        Math.floor(Math.min(127, Math.abs(power)) * resolution + 1e-9)) /
      resolution;
    leftPower = command(leftPower);
    rightPower = command(rightPower);
    const mass = this.config.robotWeightPounds * KG_PER_POUND;
    const width = this.config.trackWidth * METRES_PER_INCH;
    const maxSpeed = this.config.maxSpeedInchesPerSecond * METRES_PER_INCH;
    const openLoop = this.useLemLibMotorResponse;
    const yawInertiaMultiplier = openLoop ? LEMLIB_YAW_INERTIA_MULTIPLIER : 1;
    const inertia = (mass * width * width * yawInertiaMultiplier) / 6;
    const yawDamping = openLoop ? LEMLIB_YAW_DAMPING : 0;
    const responseSeconds = openLoop ? LEMLIB_MOTOR_RESPONSE_SECONDS : MOTOR_RESPONSE_SECONDS;
    const response = 1 - Math.exp(-SUBSTEP / responseSeconds);
    const pivotInertia = inertia + (mass * width * width) / 4;
    if (heldSide && heldSide !== this.#heldSide) {
      const sign = heldSide === "left" ? -1 : 1;
      this.#angularVelocity =
        (inertia * this.#angularVelocity +
          (sign * mass * this.#linearVelocity * width) / 2) /
        pivotInertia;
      this.#linearVelocity = (sign * this.#angularVelocity * width) / 2;
    }
    this.#heldSide = heldSide;
    const force = (power: number, velocity: number) => {
      const motor =
        (this.#motors.elevenWatt / 2) *
          motorForce(2.1, 100, 11, velocity, power, maxSpeed, openLoop) +
        (this.#motors.fivePointFiveWatt / 2) *
          motorForce(0.5, 200, 5.5, velocity, power, maxSpeed, openLoop);
      const normal = (mass * 9.81) / 2;
      const applied = Math.max(
        -normal * TRACTION,
        Math.min(normal * TRACTION, motor * EFFICIENCY),
      );
      const resistance =
        normal *
        (Math.abs(velocity) < 0.001 ? STATIC_RESISTANCE : ROLLING_RESISTANCE);
      if (Math.abs(velocity) < 0.001 && Math.abs(applied) <= resistance)
        return 0;
      return (
        applied -
        Math.sign(Math.abs(velocity) < 0.001 ? applied : velocity) * resistance
      );
    };
    let travel = 0,
      turn = 0;
    for (let substep = 0; substep < 5; substep++) {
      const oldLinear = this.#linearVelocity,
        oldAngular = this.#angularVelocity;
      this.#leftResponse += (leftPower - this.#leftResponse) * response;
      this.#rightResponse += (rightPower - this.#rightResponse) * response;
      const leftForce = force(
        this.#leftResponse,
        oldLinear + (oldAngular * width) / 2,
      );
      const rightForce = force(
        this.#rightResponse,
        oldLinear - (oldAngular * width) / 2,
      );
      if (heldSide) {
        this.#angularVelocity +=
          (((heldSide === "left" ? -rightForce : leftForce) * width) /
            pivotInertia) *
          SUBSTEP;
        this.#linearVelocity =
          ((heldSide === "left" ? -1 : 1) * this.#angularVelocity * width) / 2;
      } else {
        this.#linearVelocity += ((leftForce + rightForce) / mass) * SUBSTEP;
        const yawTorque = ((leftForce - rightForce) * width) / 2;
        this.#angularVelocity +=
          (yawTorque / inertia - yawDamping * oldAngular) * SUBSTEP;
      }
      if (
        Math.abs(this.#linearVelocity) < 0.001 &&
        (Math.abs(this.#angularVelocity) * width) / 2 < 0.001 &&
        leftForce === 0 &&
        rightForce === 0
      ) {
        this.#linearVelocity = 0;
        this.#angularVelocity = 0;
      }
      // Static resistance must stop, rather than reverse, an unpowered wheel/body.
      if (leftPower === 0 && rightPower === 0) {
        if (oldLinear * this.#linearVelocity < 0) this.#linearVelocity = 0;
        if (oldAngular * this.#angularVelocity < 0) this.#angularVelocity = 0;
      }
      const fastest =
        Math.abs(this.#linearVelocity) +
        (Math.abs(this.#angularVelocity) * width) / 2;
      if (fastest > maxSpeed) {
        this.#linearVelocity *= maxSpeed / fastest;
        this.#angularVelocity *= maxSpeed / fastest;
      }
      travel +=
        (((oldLinear + this.#linearVelocity) / 2) * SUBSTEP) / METRES_PER_INCH;
      turn += ((oldAngular + this.#angularVelocity) / 2) * SUBSTEP;
    }
    this.#leftDistance += travel + (turn * this.config.trackWidth) / 2;
    this.#rightDistance += travel - (turn * this.config.trackWidth) / 2;
    return { travel, turn };
  }
}
