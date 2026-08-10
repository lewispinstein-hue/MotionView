import type { LogEntry, Pose, WatchEntry, Waypoint, WaypointEvent } from "../state/models";
import { createPoseStore, type PoseStore } from "../state/poseStore";
import {
  buildWaypointState,
  normalizeLogs,
  normalizePoses,
  normalizeWatches,
} from "./routeNormalization";
import { ViewingEvents } from "./viewingEvents";
import type {
  ParsedLiveViewingBatch,
  ViewingAppendResult,
  ViewingDataReader,
  ViewingExportView,
  WatchEntryView,
} from "./viewingTypes";

function appendMany<T>(target: T[], items: readonly T[] | undefined): number {
  if (!items?.length) return 0;
  const start = target.length;
  target.length += items.length;
  for (let index = 0; index < items.length; index += 1) target[start + index] = items[index];
  return items.length;
}

function replaceArrayContents<T>(target: T[], items: readonly T[]): void {
  target.length = 0;
  appendMany(target, items);
}

function normalizedMetadata(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function watchVisibilityKey(watch: Pick<WatchEntry, "id" | "t">): string {
  const id = Number(watch.id);
  return Number.isInteger(id) ? `id:${id}` : `entry:${Number(watch.t)}`;
}

/** Internal mutable owner for all imported and livestreamed Viewing records. */
export class ViewingSession implements ViewingDataReader {
  readonly #poses: PoseStore = createPoseStore();
  readonly #watches: WatchEntry[] = [];
  readonly #logs: LogEntry[] = [];
  readonly #waypoints: Waypoint[] = [];
  readonly #waypointById = new Map<number, Waypoint>();
  readonly #watchVisibility = new Map<string, boolean>();
  #metadata: Record<string, unknown> | null = null;
  #minimumSpeed = 0;
  #maximumSpeed = 127;

  constructor(private readonly events: ViewingEvents) {}

  get poses() {
    return this.#poses;
  }

  get watches() {
    return this.#watches;
  }

  get logs() {
    return this.#logs;
  }

  get waypoints() {
    return this.#waypoints;
  }

  get waypointById() {
    return this.#waypointById;
  }

  get metadata() {
    return this.#metadata;
  }

  get hasData(): boolean {
    return this.#poses.length > 0
      || this.#watches.length > 0
      || this.#logs.length > 0
      || this.#waypoints.length > 0;
  }

  load(data: unknown): void {
    const object = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const rawPoses = Array.isArray(object.poses) ? object.poses : object["robot-path"];
    const poses = normalizePoses(rawPoses);
    const watches = normalizeWatches(object.watches ?? object.watch);
    const logs = normalizeLogs(object.logs ?? object.log);
    const waypointState = buildWaypointState(object.waypoints);

    this.clearStorage();
    this.#poses.reserve(poses.length);
    for (const pose of poses) this.#poses.push(pose);
    replaceArrayContents(this.#watches, watches);
    replaceArrayContents(this.#logs, logs);
    replaceArrayContents(this.#waypoints, waypointState.waypoints);
    for (const [id, waypoint] of waypointState.waypointsById) this.#waypointById.set(id, waypoint);
    this.#metadata = normalizedMetadata(object.meta);
    this.rebuildWatchVisibility();
    this.normalizePoseSpeeds(0);

    this.events.dataChanged.emit({ kind: "replaced", result: this.currentResult(true) });
  }

  loadParsedBatch(batch: ParsedLiveViewingBatch): ViewingAppendResult {
    this.clearStorage();
    const result = this.appendBatch({
      ...batch,
      poses: normalizePoses(batch.poses),
    });
    this.events.dataChanged.emit({ kind: "replaced", result });
    return result;
  }

  appendLiveBatch(batch: ParsedLiveViewingBatch): ViewingAppendResult {
    const result = this.appendBatch(batch);
    if (result.hasNewData) this.events.dataChanged.emit({ kind: "appended", result });
    return result;
  }

  clear(): void {
    this.clearStorage();
    this.events.dataChanged.emit({ kind: "cleared" });
  }

  setWatchVisibility(watch: WatchEntryView, visible: boolean): void {
    const key = watchVisibilityKey(watch);
    const nextVisible = !!visible;
    this.#watchVisibility.set(key, nextVisible);
    let changed = false;
    for (const candidate of this.#watches) {
      if (watchVisibilityKey(candidate) !== key || candidate.visible === nextVisible) continue;
      candidate.visible = nextVisible;
      changed = true;
    }
    if (changed) this.events.dataChanged.emit({ kind: "watch-visibility", key, visible: nextVisible });
  }

  setSpeedRange(minimum: number, maximum: number): void {
    let nextMinimum = Number.isFinite(minimum) ? minimum : 0;
    let nextMaximum = Number.isFinite(maximum) ? maximum : 127;
    if (nextMinimum > nextMaximum) [nextMinimum, nextMaximum] = [nextMaximum, nextMinimum];
    if (nextMinimum === this.#minimumSpeed && nextMaximum === this.#maximumSpeed) return;
    this.#minimumSpeed = nextMinimum;
    this.#maximumSpeed = nextMaximum;
    this.normalizePoseSpeeds(0);
    this.events.dataChanged.emit({
      kind: "speed-range",
      minimum: this.#minimumSpeed,
      maximum: this.#maximumSpeed,
    });
  }

  exportData(): ViewingExportView {
    return {
      poses: this.#poses,
      watches: this.#watches,
      logs: this.#logs,
      waypoints: this.#waypoints,
      meta: this.#metadata,
    };
  }

  private appendBatch(batch: ParsedLiveViewingBatch): ViewingAppendResult {
    const firstPoseIndex = this.#poses.length;
    const poses = batch.poses ?? [];
    this.#poses.reserve(firstPoseIndex + poses.length);
    for (const pose of poses) this.#poses.push(pose as Partial<Pose>);
    if (poses.length) this.normalizePoseSpeeds(firstPoseIndex);

    let watchesAdded = 0;
    for (const watch of batch.watches ?? []) {
      const key = watchVisibilityKey(watch);
      const visible = this.#watchVisibility.get(key) ?? (watch.visible !== false);
      this.#watchVisibility.set(key, visible);
      this.#watches.push({ ...watch, visible });
      watchesAdded += 1;
    }

    const logsAdded = appendMany(this.#logs, batch.logs);
    let waypointsAdded = 0;
    for (const waypoint of batch.waypoints ?? []) {
      if (!Number.isInteger(waypoint.id)) continue;
      this.#waypointById.set(waypoint.id, waypoint);
      waypointsAdded += 1;
    }
    for (const event of batch.waypointEvents ?? []) {
      if (this.applyWaypointEvent(event)) waypointsAdded += 1;
    }

    if (watchesAdded) this.#watches.sort((left, right) => left.t - right.t);
    if (logsAdded) this.#logs.sort((left, right) => left.t - right.t);
    if (waypointsAdded) {
      replaceArrayContents(
        this.#waypoints,
        [...this.#waypointById.values()].sort((left, right) => (left.createdTime ?? 0) - (right.createdTime ?? 0)),
      );
    }

    const metadataChanged = batch.meta !== undefined;
    if (metadataChanged) this.#metadata = normalizedMetadata(batch.meta);
    return {
      posesAdded: poses.length,
      watchesAdded,
      logsAdded,
      waypointsAdded,
      metadataChanged,
      hasNewData: poses.length > 0 || watchesAdded > 0 || logsAdded > 0 || waypointsAdded > 0 || metadataChanged,
    };
  }

  private applyWaypointEvent(event: WaypointEvent): boolean {
    if (event.type === "CREATED") {
      const targetX = Number(event.params.tarX);
      const targetY = Number(event.params.tarY);
      const targetTheta = event.params.tarT == null ? null : Number(event.params.tarT);
      if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;
      this.#waypointById.set(event.id, {
        id: event.id,
        name: event.name,
        createdTime: event.t,
        createdEvent: event,
        target: { x: targetX, y: targetY, theta: Number.isFinite(targetTheta) ? targetTheta : null },
        retriggerable: !!event.params.retriggerable,
        events: [event],
        active: true,
        terminalEvent: null,
        latestEvent: event,
        latestActiveEvent: event,
      });
      return true;
    }

    const waypoint = this.#waypointById.get(event.id);
    if (!waypoint) return false;
    waypoint.events.push(event);
    waypoint.events.sort((left, right) => left.t - right.t);
    waypoint.latestEvent = event;
    if (event.type === "TIMEDOUT" || (!waypoint.retriggerable && event.type === "REACHED")) {
      waypoint.active = false;
      waypoint.terminalEvent = event;
    }
    if (!waypoint.terminalEvent || event.t <= waypoint.terminalEvent.t) waypoint.latestActiveEvent = event;
    return true;
  }

  private normalizePoseSpeeds(startIndex: number): void {
    const denominator = (this.#maximumSpeed - this.#minimumSpeed) || 1;
    for (let index = Math.max(0, startIndex); index < this.#poses.length; index += 1) {
      const speed = Math.abs(this.#poses[index]?.speed_raw ?? 0);
      const normalized = Math.max(0, Math.min(1, (speed - this.#minimumSpeed) / denominator));
      this.#poses.setSpeedNorm(index, normalized);
    }
  }

  private rebuildWatchVisibility(): void {
    this.#watchVisibility.clear();
    for (const watch of this.#watches) this.#watchVisibility.set(watchVisibilityKey(watch), watch.visible !== false);
  }

  private clearStorage(): void {
    this.#poses.clear();
    this.#watches.length = 0;
    this.#logs.length = 0;
    this.#waypoints.length = 0;
    this.#waypointById.clear();
    this.#watchVisibility.clear();
    this.#metadata = null;
  }

  private currentResult(metadataChanged: boolean): ViewingAppendResult {
    return {
      posesAdded: this.#poses.length,
      watchesAdded: this.#watches.length,
      logsAdded: this.#logs.length,
      waypointsAdded: this.#waypoints.length,
      metadataChanged,
      hasNewData: this.hasData || metadataChanged,
    };
  }
}
