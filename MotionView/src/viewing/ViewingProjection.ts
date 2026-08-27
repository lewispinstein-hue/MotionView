import type { Pose, Waypoint } from "../state/models";
import type { ViewingEvents } from "./viewingEvents";
import type { ViewingDataReader, WatchMarker, WaypointView } from "./viewingTypes";

export interface ViewingTransform {
  readonly unitsToInches: number;
  readonly offsetXInches: number;
  readonly offsetYInches: number;
  readonly offsetThetaDegrees: number;
}

export interface ViewingFieldPoint {
  readonly x: number;
  readonly y: number;
  readonly theta: number | null;
}

const DEFAULT_TRANSFORM: ViewingTransform = {
  unitsToInches: 1,
  offsetXInches: 0,
  offsetYInches: 0,
  offsetThetaDegrees: 0,
};

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function lerpAngleDegrees(start: number, end: number, amount: number): number {
  const delta = ((end - start + 540) % 360) - 180;
  return normalizeDegrees(start + delta * amount);
}

/** Readonly, incrementally maintained values derived from raw Viewing data. */
export class ViewingProjection {
  readonly #markers: WatchMarker[] = [];
  readonly #markersByTime: WatchMarker[] = [];
  #transform: ViewingTransform = DEFAULT_TRANSFORM;

  constructor(
    private readonly data: ViewingDataReader,
    private readonly events: ViewingEvents,
  ) {
    events.dataChanged.subscribe((change) => {
      if (change.kind === "replaced") this.rebuildWatchMarkers();
      else if (change.kind === "appended" && change.result.watchesAdded > 0) {
        this.appendWatchMarkers(change.result.watchesAdded);
      } else if (change.kind === "cleared") this.clear();
    });
  }

  get transform(): Readonly<ViewingTransform> {
    return this.#transform;
  }

  get watchMarkers(): readonly Readonly<WatchMarker>[] {
    return this.#markers;
  }

  get watchMarkersByTime(): readonly Readonly<WatchMarker>[] {
    return this.#markersByTime;
  }

  setTransform(transform: ViewingTransform): void {
    this.#transform = { ...transform };
    this.rebuildWatchMarkers();
    this.events.projectionChanged.emit({ kind: "transform" });
  }

  timeRange(): Readonly<{ start: number; end: number }> | null {
    const start = this.data.poses[0]?.t;
    const end = this.data.poses[this.data.poses.length - 1]?.t;
    return typeof start === "number" && typeof end === "number" && end > start ? { start, end } : null;
  }

  findFloorIndex(timeMs: number): number {
    const poses = this.data.poses;
    if (!poses.length) return -1;
    let low = 0;
    let high = poses.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((poses[middle]?.t ?? -Infinity) <= timeMs) low = middle + 1;
      else high = middle - 1;
    }
    return Math.max(0, Math.min(poses.length - 1, high));
  }

  nearestIndex(timeMs: number, toleranceMs: number): Readonly<{ index: number; deltaMs: number }> | null {
    const poses = this.data.poses;
    if (!poses.length) return null;
    const floor = this.findFloorIndex(timeMs);
    const candidates = [floor, Math.min(floor + 1, poses.length - 1)];
    let best: { index: number; deltaMs: number } | null = null;
    for (const index of candidates) {
      const poseTime = poses[index]?.t;
      if (typeof poseTime !== "number") continue;
      const deltaMs = Math.abs(poseTime - timeMs);
      if (!best || deltaMs < best.deltaMs) best = { index, deltaMs };
    }
    return best && best.deltaMs <= toleranceMs ? best : null;
  }

  poseAt(index: number): Readonly<Pose> | null {
    const pose = this.data.poses[index];
    return pose ? this.transformPose(pose) : null;
  }

  /** Converts a field-space pose back into the selected source unit for display. */
  displayPose(pose: Readonly<Pose> | null): Readonly<Pose> | null {
    if (!pose) return null;
    const factor = this.#transform.unitsToInches || 1;
    return { ...pose, x: pose.x / factor, y: pose.y / factor };
  }

  waypointTarget(waypoint: WaypointView): Readonly<ViewingFieldPoint> {
    const transform = this.#transform;
    return {
      x: waypoint.target.x * transform.unitsToInches + transform.offsetXInches,
      y: waypoint.target.y * transform.unitsToInches + transform.offsetYInches,
      theta: waypoint.target.theta == null
        ? null
        : normalizeDegrees(waypoint.target.theta + transform.offsetThetaDegrees),
    };
  }

  interpolatePose(timeMs: number | null): Readonly<Pose> | null {
    if (timeMs == null || !this.data.poses.length) return null;
    const index = this.findFloorIndex(timeMs);
    const first = this.data.poses[index];
    if (!first) return null;
    const second = this.data.poses[index + 1];
    if (!second) return this.transformPose({ ...first, t: first.t });
    const firstTime = first.t ?? timeMs;
    const secondTime = second.t ?? firstTime;
    const amount = Math.max(0, Math.min(1, (timeMs - firstTime) / ((secondTime - firstTime) || 1)));
    return this.transformPose({
      t: timeMs,
      x: first.x + (second.x - first.x) * amount,
      y: first.y + (second.y - first.y) * amount,
      theta: lerpAngleDegrees(first.theta, second.theta, amount),
      l_vel: (first.l_vel ?? 0) + ((second.l_vel ?? 0) - (first.l_vel ?? 0)) * amount,
      r_vel: (first.r_vel ?? 0) + ((second.r_vel ?? 0) - (first.r_vel ?? 0)) * amount,
      speed_raw: first.speed_raw + (second.speed_raw - first.speed_raw) * amount,
      speed_norm: first.speed_norm + (second.speed_norm - first.speed_norm) * amount,
    });
  }

  waypointPoseIndex(waypoint: WaypointView, eventTime: number | null = null): number | null {
    const start = waypoint.createdTime;
    if (typeof start !== "number" || !this.data.poses.length) return null;
    const end = waypoint.terminalEvent?.t ?? Infinity;
    const target = eventTime ?? waypoint.latestActiveEvent?.t ?? start;
    let index = this.findFloorIndex(target);
    const candidates = [index, Math.min(index + 1, this.data.poses.length - 1)];
    let best: { index: number; delta: number } | null = null;
    for (const candidate of candidates) {
      const time = this.data.poses[candidate]?.t;
      if (typeof time !== "number" || time < start || time > end) continue;
      const delta = Math.abs(time - target);
      if (!best || delta < best.delta) best = { index: candidate, delta };
    }
    return best?.index ?? null;
  }

  private transformPose(pose: Readonly<Pose>): Pose {
    const transform = this.#transform;
    return {
      t: pose.t,
      x: pose.x * transform.unitsToInches + transform.offsetXInches,
      y: pose.y * transform.unitsToInches + transform.offsetYInches,
      theta: normalizeDegrees(pose.theta + transform.offsetThetaDegrees),
      l_vel: pose.l_vel,
      r_vel: pose.r_vel,
      speed_raw: pose.speed_raw,
      speed_norm: pose.speed_norm,
    };
  }

  private markerForWatch(watch: ViewingDataReader["watches"][number]): WatchMarker {
    const near = this.nearestIndex(watch.t, 60);
    return near
      ? { watch, t: watch.t, ok: true, dt: near.deltaMs, pose: this.poseAt(near.index), idx: near.index }
      : { watch, t: watch.t, ok: false, dt: null, pose: this.interpolatePose(watch.t), idx: null };
  }

  private rebuildWatchMarkers(): void {
    this.#markers.length = 0;
    for (const watch of this.data.watches) this.#markers.push(this.markerForWatch(watch));
    this.rebuildMarkerTimeIndex();
    this.events.projectionChanged.emit({ kind: "replaced" });
  }

  private appendWatchMarkers(count: number): void {
    const start = Math.max(0, this.data.watches.length - count);
    for (let index = start; index < this.data.watches.length; index += 1) {
      const watch = this.data.watches[index];
      if (watch) this.#markers.push(this.markerForWatch(watch));
    }
    this.rebuildMarkerTimeIndex();
    this.events.projectionChanged.emit({ kind: "appended", watchesAdded: count });
  }

  private rebuildMarkerTimeIndex(): void {
    this.#markersByTime.length = 0;
    this.#markersByTime.push(...this.#markers);
    this.#markersByTime.sort((left, right) => left.t - right.t);
  }

  private clear(): void {
    this.#markers.length = 0;
    this.#markersByTime.length = 0;
    this.events.projectionChanged.emit({ kind: "replaced" });
  }
}
