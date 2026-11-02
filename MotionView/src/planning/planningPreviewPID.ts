import type { PreviewPIDConfiguration } from "./planningSimulationConfiguration";

/** LemLib-compatible per-update gains (no implicit seconds conversion). */
export class PlanningPreviewPID {
  #integral = 0;
  #previousError = 0;
  #previousMeasurement: number | null = null;

  constructor(
    private readonly configuration: PreviewPIDConfiguration,
    private readonly derivativeOnMeasurement = false,
  ) {}

  update(error: number, measurement = -error): number {
    const config = this.configuration;
    this.#integral += error;
    if (
      (config.signFlipReset &&
        Math.sign(error) !== Math.sign(this.#previousError)) ||
      (config.windupRange > 0 && Math.abs(error) > config.windupRange)
    )
      this.#integral = 0;
    const derivative = this.derivativeOnMeasurement
      ? this.#previousMeasurement === null
        ? 0
        : this.#previousMeasurement - measurement
      : error - this.#previousError;
    this.#previousMeasurement = measurement;
    this.#previousError = error;
    return (
      config.kP * error + config.kI * this.#integral + config.kD * derivative
    );
  }
}
