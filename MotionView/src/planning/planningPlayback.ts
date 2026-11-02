import type { PlanningEvents, PlanningPlaybackChangedEvent } from "./planningEvents";
import type { PlanningProjection } from "./PlanningProjection";
import type { PlanningSession } from "./planningSession";

export class PlanningPlayback {
  #playing = false;
  #rate = 1;
  #frame: number | null = null;
  #lastWallTime: number | null = null;
  #inspectionIndex: number | null = null;
  constructor(private readonly session: PlanningSession, private readonly projection: PlanningProjection, private readonly events: PlanningEvents) {
    events.projectionChanged.subscribe(({ kind }) => {
      if (kind === "simulation-pending" || kind === "route-edit") this.pause();
      if (kind === "simulation-ready") this.refresh();
    });
    events.selectionChanged.subscribe(({ kind }) => {
      if (kind === "waypoint" && this.session.selectedWaypoint >= 0) this.inspectWaypoint(this.session.selectedWaypoint);
      else this.#inspectionIndex = null;
    });
  }
  get isPlaying(): boolean { return this.#playing; }
  get time(): number { return this.session.playbackTime; }
  get duration(): number { return this.projection.duration; }
  /** Derived for field node placement and the existing Object Latest behavior. */
  get distance(): number { return this.projection.distanceAtTime(this.time); }
  get rate(): number { return this.#rate; }
  get pose() {
    const target = this.#inspectionIndex !== null ? this.session.waypoints[this.#inspectionIndex] : null;
    return target ? { ...target } : this.projection.sampleTime(this.time);
  }
  setRate(rate: number): void { this.#rate = Number.isFinite(rate) && rate > 0 ? rate : 1; this.emit("rate"); }
  play(): void {
    if (this.#playing || this.session.isRouteEditing || this.session.waypoints.length < 2 || this.projection.pending || this.duration <= 0) return;
    this.#inspectionIndex = null;
    if (this.time >= this.duration) this.setTime(0);
    this.#playing = true; this.#lastWallTime = null; this.emit("started");
    this.#frame = requestAnimationFrame(this.tick);
  }
  pause(): void {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null; this.#lastWallTime = null;
    if (!this.#playing) return;
    this.#playing = false; this.emit("paused");
  }
  toggle(): void { this.#playing ? this.pause() : this.play(); }
  setTime(time: number): void {
    this.#inspectionIndex = null;
    this.session.playbackTime = Math.max(0, Math.min(Number.isFinite(time) ? time : 0, this.duration));
    this.emit("time");
  }
  refresh(): void {
    if (this.#inspectionIndex !== this.session.selectedWaypoint) this.#inspectionIndex = null;
    const desired = this.#inspectionIndex === null ? this.time : this.projection.times[this.#inspectionIndex] ?? this.duration;
    this.session.playbackTime = Math.max(0, Math.min(desired, this.duration));
    this.emit("time");
  }
  setDistance(distance: number): void { this.setTime(this.projection.timeAtDistance(distance)); }
  inspectWaypoint(index: number): void {
    this.pause();
    this.setTime(this.projection.times[index] ?? this.duration);
    this.#inspectionIndex = index;
    this.emit("time");
  }
  private emit(kind: PlanningPlaybackChangedEvent["kind"]): void {
    this.events.playbackChanged.emit({ kind, time: this.time, distance: this.distance });
  }
  private readonly tick = (now: number): void => {
    if (!this.#playing) return;
    if (this.#lastWallTime === null) this.#lastWallTime = now;
    const elapsed = Math.max(0, now - this.#lastWallTime) / 1000;
    this.#lastWallTime = now;
    this.setTime(this.time + elapsed * this.#rate);
    if (this.time >= this.duration) this.pause();
    else this.#frame = requestAnimationFrame(this.tick);
  };
}
