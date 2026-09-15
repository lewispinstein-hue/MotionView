import type { PlanningEvents } from "./planningEvents";
import type { PlanningProjection } from "./PlanningProjection";
import type { PlanningSession } from "./planningSession";

const PLANNING_SPEED_SCALE = 0.35;

export class PlanningPlayback {
  #playing = false;
  #rate = 1;
  #frame: number | null = null;
  #lastWallTime: number | null = null;

  constructor(
    private readonly session: PlanningSession,
    private readonly projection: PlanningProjection,
    private readonly events: PlanningEvents,
  ) {}

  get isPlaying(): boolean { return this.#playing; }
  get distance(): number { return this.session.playbackDistance; }
  get rate(): number { return this.#rate; }

  setRate(rate: number): void {
    this.#rate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    this.events.playbackChanged.emit({ kind: "rate", distance: this.distance });
  }

  play(): void {
    if (this.#playing || this.session.waypoints.length < 2) return;
    if (this.distance >= this.projection.totalLength) this.setDistance(0);
    this.#playing = true;
    this.#lastWallTime = null;
    this.events.playbackChanged.emit({ kind: "started", distance: this.distance });
    this.#frame = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (this.#frame != null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#lastWallTime = null;
    if (!this.#playing) return;
    this.#playing = false;
    this.events.playbackChanged.emit({ kind: "paused", distance: this.distance });
  }

  toggle(): void { this.#playing ? this.pause() : this.play(); }

  setDistance(distance: number): void {
    this.session.playbackDistance = Math.max(0, Math.min(Number.isFinite(distance) ? distance : 0, this.projection.totalLength));
    this.events.playbackChanged.emit({ kind: "distance", distance: this.distance });
  }

  private readonly tick = (now: number): void => {
    if (!this.#playing) return;
    if (this.#lastWallTime == null) this.#lastWallTime = now;
    const elapsedSeconds = (now - this.#lastWallTime) / 1000;
    this.#lastWallTime = now;
    const next = this.distance
      + elapsedSeconds * this.projection.speedAt(this.distance) * this.#rate * PLANNING_SPEED_SCALE;
    this.setDistance(next);
    if (this.distance >= this.projection.totalLength) this.pause();
    else this.#frame = requestAnimationFrame(this.tick);
  };
}
