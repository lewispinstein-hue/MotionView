import type { PlanWaypointMotion } from "../state/models";

const CONTROLLER_TICK_MS = 10;

/** Latched error windows, matching LemLib's ExitCondition at fixed 10 ms ticks. */
class ErrorWindow {
  #elapsed = -1;
  #done = false;
  constructor(private readonly range: number, private readonly duration: number) {}

  update(error: number): boolean {
    if (Math.abs(error) > this.range) this.#elapsed = -1;
    else if (this.#elapsed < 0) this.#elapsed = 0;
    else {
      this.#elapsed += CONTROLLER_TICK_MS;
      if (this.#elapsed >= this.duration) this.#done = true;
    }
    return this.#done;
  }
}

/** Nominal LemLib documentation defaults; these are not user tuning inputs.
 * https://github.com/LemLib/LemLib/blob/stable/src/lemlib/exitcondition.cpp
 * moveToPoint uses either lateral window; moveToPose latches both lateral
 * windows and requires either angular window as well as its close-range phase.
 */
export class PlanningLemLibSettling {
  readonly #linearSmall = new ErrorWindow(1, 100);
  readonly #linearLarge = new ErrorWindow(3, 500);
  readonly #angularSmall = new ErrorWindow(1, 100);
  readonly #angularLarge = new ErrorWindow(3, 500);
  #linearSettled = false;

  update(type: PlanWaypointMotion["type"], linearError: number, angularError: number, close: boolean): boolean {
    if (type === "rotate" || type === "swing") {
      const small = this.#angularSmall.update(angularError);
      const large = this.#angularLarge.update(angularError);
      return small || large;
    }
    const small = this.#linearSmall.update(linearError);
    const large = this.#linearLarge.update(linearError);
    if (type === "forward") return close && (small || large);
    this.#linearSettled ||= small && large;
    const angularSmall = this.#angularSmall.update(angularError);
    const angularLarge = this.#angularLarge.update(angularError);
    return close && this.#linearSettled && (angularSmall || angularLarge);
  }
}
