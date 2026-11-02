import type { PreviewPIDConfiguration } from "./planningBoomerangConfiguration";

/** LemLib-compatible per-update gains (no implicit seconds conversion). */
export class PlanningPreviewPID {
  #integral = 0;
  #previousError = 0;

  constructor(private readonly configuration: PreviewPIDConfiguration) {}

  update(error: number): number {
    const config = this.configuration;
    this.#integral += error;
    if ((config.signFlipReset && Math.sign(error) !== Math.sign(this.#previousError)) ||
        (config.windupRange > 0 && Math.abs(error) > config.windupRange)) this.#integral = 0;
    const derivative = error - this.#previousError;
    this.#previousError = error;
    return config.kP * error + config.kI * this.#integral + config.kD * derivative;
  }
}
