import type { Pose, WatchEntry, Waypoint, WaypointEvent } from "../state/models";
import { createPoseStore } from "../state/poseStore";
import { buildWaypointState, normalizeLogs, normalizeWatches } from "./routeNormalization";
import type { ViewingInternalState } from "./viewingState";
import type { ParsedLiveViewingBatch, ViewingAppendResult, ViewingDataActions } from "./viewingTypes";

export type NumberParser = (value: unknown) => number | null;
export type LogLevelNormalizer = (value: unknown) => string;

export interface ViewingActionDependencies {
  makePoseStore: typeof createPoseStore;
  toNumMaybe: NumberParser;
  normalizeLogLevel: LogLevelNormalizer;
  getWatchVisibility?: (watch: WatchEntry) => boolean;
}

export const defaultNumberParser: NumberParser = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const defaultLogLevelNormalizer: LogLevelNormalizer = (value) => String(value ?? "INFO").trim().toUpperCase() || "INFO";

function normalizePoseArray(value: unknown, toNumMaybe: NumberParser, makePoseStore: typeof createPoseStore) {
  const store = makePoseStore(Array.isArray(value) ? value.length : 16);
  const items = (Array.isArray(value) ? value : [])
    .filter((pose) => pose && typeof pose === "object" && typeof (pose as any).x === "number" && typeof (pose as any).y === "number")
    .map((pose) => {
      const entry = pose as Record<string, unknown>;
      return {
        t: (typeof entry.t === "number") ? entry.t : (toNumMaybe(entry.t) ?? null),
        x: entry.x as number,
        y: entry.y as number,
        theta: (typeof entry.theta === "number") ? entry.theta : (toNumMaybe(entry.theta) ?? 0),
        l_vel: (typeof entry.l_vel === "number") ? entry.l_vel : (toNumMaybe(entry.l_vel) ?? null),
        r_vel: (typeof entry.r_vel === "number") ? entry.r_vel : (toNumMaybe(entry.r_vel) ?? null),
        speed_raw: (typeof entry.speed_raw === "number")
          ? entry.speed_raw
          : ((typeof entry.speed === "number") ? entry.speed : (toNumMaybe(entry.speed) ?? 0)),
        speed_norm: 0,
      };
    })
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  for (const pose of items) store.push(pose);
  return store;
}

function appendMany<T>(target: T[], items: readonly T[] | undefined) {
  if (!items?.length) return 0;
  target.length += items.length;
  const start = target.length - items.length;
  for (let index = 0; index < items.length; index += 1) target[start + index] = items[index];
  return items.length;
}

function appendWatches(
  target: WatchEntry[],
  watches: readonly WatchEntry[] | undefined,
  getWatchVisibility?: (watch: WatchEntry) => boolean,
) {
  if (!watches?.length) return 0;
  target.length += watches.length;
  const start = target.length - watches.length;
  for (let index = 0; index < watches.length; index += 1) {
    const watch = watches[index];
    target[start + index] = getWatchVisibility
      ? { ...watch, visible: getWatchVisibility(watch) }
      : watch;
  }
  return watches.length;
}

function replaceArrayContents<T>(target: T[], items: readonly T[]) {
  target.length = 0;
  appendMany(target, items);
}

function applyWaypointEvent(state: ViewingInternalState, event: WaypointEvent) {
  if (event.type === "CREATED") {
    const isRetriggerable = !!event.params?.retriggerable;
    const targetX = Number(event.params.tarX);
    const targetY = Number(event.params.tarY);
    const targetTheta = event.params.tarT == null ? null : Number(event.params.tarT);
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;
    state.waypointsById.set(event.id, {
      id: event.id,
      name: event.name,
      createdTime: event.t,
      createdEvent: event,
      target: { x: targetX, y: targetY, theta: Number.isFinite(targetTheta) ? targetTheta : null },
      retriggerable: isRetriggerable,
      events: [event],
      active: true,
      terminalEvent: null,
      latestEvent: event,
      latestActiveEvent: event,
    });
    return true;
  }

  const waypoint = state.waypointsById.get(event.id);
  if (!waypoint) return false;
  waypoint.events.push(event);
  waypoint.events.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  waypoint.latestEvent = event;
  if (event.type === "TIMEDOUT" || (!waypoint.retriggerable && event.type === "REACHED")) {
    waypoint.active = false;
    waypoint.terminalEvent = event;
  }
  if (!waypoint.terminalEvent || event.t <= waypoint.terminalEvent.t) {
    waypoint.latestActiveEvent = event;
  }
  return true;
}

export function createViewingActions(
  state: ViewingInternalState,
  deps: ViewingActionDependencies,
): ViewingDataActions {
  return {
    loadViewingData(data: unknown) {
      const obj = (data && typeof data === "object") ? data as Record<string, any> : {};
      const poses = Array.isArray(obj.poses) ? obj.poses : (Array.isArray(obj["robot-path"]) ? obj["robot-path"] : []);
      const normalizedPoses = normalizePoseArray(poses, deps.toNumMaybe, deps.makePoseStore);
      state.poses.clear();
      for (const pose of normalizedPoses) state.poses.push(pose);
      replaceArrayContents(state.watches, normalizeWatches(obj.watches || obj.watch || [], deps.toNumMaybe));
      replaceArrayContents(state.logs, normalizeLogs(obj.logs || obj.log || [], deps.toNumMaybe, deps.normalizeLogLevel));
      const normalizedWaypoints = buildWaypointState(obj.waypoints || []);
      replaceArrayContents(state.waypoints, normalizedWaypoints.waypoints);
      state.waypointsById.clear();
      for (const [id, waypoint] of normalizedWaypoints.waypointsById) state.waypointsById.set(id, waypoint);
      state.watchMarkers.length = 0;
      state.meta = obj.meta ?? null;
    },

    clear() {
      state.poses.clear();
      state.watches.length = 0;
      state.logs.length = 0;
      state.waypoints.length = 0;
      state.waypointsById.clear();
      state.watchMarkers.length = 0;
      state.meta = null;
    },

    appendLiveBatch(batch: ParsedLiveViewingBatch): ViewingAppendResult {
      const poses = batch.poses ?? [];
      for (const pose of poses) state.poses.push(pose as Partial<Pose>);
      const watchesAdded = appendWatches(state.watches, batch.watches, deps.getWatchVisibility);
      const logsAdded = appendMany(state.logs, batch.logs);
      let waypointsAdded = appendMany(state.waypoints, batch.waypoints);
      for (const waypoint of batch.waypoints ?? []) {
        const id = Number((waypoint as any)?.id);
        if (Number.isInteger(id)) state.waypointsById.set(id, waypoint);
      }
      for (const event of batch.waypointEvents ?? []) {
        if (applyWaypointEvent(state, event)) waypointsAdded += 1;
      }
      if (watchesAdded > 0) state.watches.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      if (logsAdded > 0) state.logs.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      if (waypointsAdded > 0) {
        replaceArrayContents(state.waypoints, Array.from(state.waypointsById.values()).sort((a, b) => (a.createdTime ?? 0) - (b.createdTime ?? 0)));
      }
      if (batch.meta !== undefined) state.meta = batch.meta;
      return {
        posesAdded: poses.length,
        watchesAdded,
        logsAdded,
        waypointsAdded,
        hasNewData: poses.length > 0 || watchesAdded > 0 || logsAdded > 0 || waypointsAdded > 0,
      };
    },
  };
}
