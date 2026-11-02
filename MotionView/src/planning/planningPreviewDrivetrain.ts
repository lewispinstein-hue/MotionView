import { normalizeBoomerangMotorWatts, type BoomerangPreviewConfiguration } from "./planningBoomerangConfiguration";

const METRES_PER_INCH = 0.0254;
const KG_PER_POUND = 0.45359237;
// Explicit nominal assumptions, not measured robot characteristics.
const EFFICIENCY = 0.85;
const TRACTION = 0.8;

/** Maximize pairs of 11W motors, then fill the remaining power with 5.5W motors. */
export function inferPlanningDriveMotors(watts: number) {
  const total = normalizeBoomerangMotorWatts(watts);
  const elevenWatt = Math.floor(total / 22) * 2;
  return { elevenWatt, fivePointFiveWatt: Math.round((total - elevenWatt * 11) / 5.5) };
}

/**
 * Approximate VEX torque envelopes, not a calibrated motor/firmware simulation.
 * Sources: VEX Library, Understanding V5 Smart Motor 11W/5.5W Performance.
 * Normalize each motor to its nominal geared ground speed; radius/gearing cancel
 * in F = torque * ratedAngularSpeed / nominalGroundSpeed.
 */
function motorForce(torque: number, ratedRPM: number, watts: number, velocity: number, power: number, maxSpeed: number): number {
  const command = Math.max(-1, Math.min(1, power / 127));
  const normalizedSpeed = velocity / maxSpeed;
  // Published motors have software-limited rated speed, not a zero-torque
  // free-speed intercept. Retain torque at rated speed; current-limit at stall.
  const freeSpeedRatio = 1.6;
  const torqueFraction = Math.max(-1, Math.min(1, (command - normalizedSpeed / freeSpeedRatio) / (1 - 1 / freeSpeedRatio)));
  const angularSpeed = ratedRPM * Math.PI / 30;
  const mechanicalPower = Math.abs(torque * torqueFraction * angularSpeed * normalizedSpeed);
  const powerLimit = mechanicalPower > watts ? watts / mechanicalPower : 1;
  return torque * torqueFraction * powerLimit * angularSpeed / maxSpeed;
}

/** Nominal dynamics with equal power per side and uniform square-body inertia. */
export class PlanningPreviewDrivetrain {
  #linearVelocity = 0;
  #angularVelocity = 0;
  readonly #motors;

  constructor(private readonly config: BoomerangPreviewConfiguration) {
    this.#motors = inferPlanningDriveMotors(config.motorWatts);
  }

  step(leftPower: number, rightPower: number): { travel: number; turn: number } {
    const config = this.config;
    const mass = config.robotWeightPounds * KG_PER_POUND;
    const width = config.trackWidth * METRES_PER_INCH;
    const maxSpeed = config.maxSpeedInchesPerSecond * METRES_PER_INCH;
    const dt = config.timeStepSeconds;
    const force = (power: number, velocity: number) => {
      const motor = this.#motors.elevenWatt / 2 * motorForce(2.1, 100, 11, velocity, power, maxSpeed) +
        this.#motors.fivePointFiveWatt / 2 * motorForce(0.5, 200, 5.5, velocity, power, maxSpeed);
      const tractionLimit = mass * 9.81 * TRACTION / 2;
      return Math.max(-tractionLimit, Math.min(tractionLimit, motor * EFFICIENCY));
    };
    const leftForce = force(leftPower, this.#linearVelocity + this.#angularVelocity * width / 2);
    const rightForce = force(rightPower, this.#linearVelocity - this.#angularVelocity * width / 2);
    const oldLinear = this.#linearVelocity;
    const oldAngular = this.#angularVelocity;
    this.#linearVelocity += (leftForce + rightForce) / mass * dt;
    const inertia = mass * width * width / 6;
    this.#angularVelocity += (leftForce - rightForce) * width / 2 / inertia * dt;
    // Rated-speed limiter for this nominal motor model.
    const fastestWheel = Math.abs(this.#linearVelocity) + Math.abs(this.#angularVelocity) * width / 2;
    if (fastestWheel > maxSpeed) {
      this.#linearVelocity *= maxSpeed / fastestWheel;
      this.#angularVelocity *= maxSpeed / fastestWheel;
    }
    return {
      travel: (oldLinear + this.#linearVelocity) / 2 * dt / METRES_PER_INCH,
      turn: (oldAngular + this.#angularVelocity) / 2 * dt,
    };
  }
}
