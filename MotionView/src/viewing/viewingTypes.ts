import type { LogEntry, Pose, WatchEntry, Waypoint, WaypointCreatedEvent, WaypointEvent } from "../state/models";
import type { PoseReader } from "../state/poseStore";

export type WatchEntryView = Readonly<WatchEntry>;
export type LogEntryView = Readonly<LogEntry>;
type ReadonlyWaypointEvent<T extends WaypointEvent> = Readonly<Omit<T, "params">> & {
  readonly params: Readonly<T["params"]>;
};

type ToReadonlyWaypointEvent<Event> = Event extends WaypointEvent
  ? ReadonlyWaypointEvent<Event>
  : never;

export type WaypointEventView = ToReadonlyWaypointEvent<WaypointEvent>;
export type WaypointView = Readonly<Omit<
  Waypoint,
  "target" | "events" | "createdEvent" | "terminalEvent" | "latestEvent" | "latestActiveEvent"
>> & {
  readonly target: Readonly<Waypoint["target"]>;
  readonly events: readonly WaypointEventView[];
  readonly createdEvent: ReadonlyWaypointEvent<WaypointCreatedEvent>;
  readonly terminalEvent: WaypointEventView | null;
  readonly latestEvent: WaypointEventView;
  readonly latestActiveEvent: WaypointEventView;
};

export interface WatchMarker {
  watch: Readonly<WatchEntry>;
  t: number;
  ok: boolean;
  dt: number | null;
  pose: Pose | null;
  idx: number | null;
}

export interface WaypointVisibleEvent {
  waypoint: Waypoint;
  event: WaypointEvent;
}

export interface ViewingExportView {
  readonly poses: PoseReader;
  readonly watches: readonly WatchEntryView[];
  readonly logs: readonly LogEntryView[];
  readonly waypoints: readonly WaypointView[];
  readonly meta: Readonly<Record<string, unknown>> | null;
}

export interface ViewingDataReader {
  readonly poses: PoseReader;
  readonly watches: readonly WatchEntryView[];
  readonly logs: readonly LogEntryView[];
  readonly waypoints: readonly WaypointView[];
  readonly waypointById: ReadonlyMap<number, WaypointView>;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly hasData: boolean;
}

export interface ParsedLiveViewingBatch {
  poses?: readonly Partial<Pose>[];
  watches?: readonly WatchEntry[];
  logs?: readonly LogEntry[];
  waypoints?: readonly Waypoint[];
  waypointEvents?: readonly WaypointEvent[];
  meta?: Record<string, unknown> | null;
}

export interface ViewingAppendResult {
  posesAdded: number;
  watchesAdded: number;
  logsAdded: number;
  waypointsAdded: number;
  hasNewData: boolean;
  metadataChanged: boolean;
}

export type ViewingDataChangedEvent =
  | { readonly kind: "replaced"; readonly result: Readonly<ViewingAppendResult> }
  | { readonly kind: "appended"; readonly result: Readonly<ViewingAppendResult> }
  | { readonly kind: "cleared" }
  | { readonly kind: "watch-visibility"; readonly key: string; readonly visible: boolean }
  | { readonly kind: "speed-range"; readonly minimum: number; readonly maximum: number };

export type ViewingNavigationChangedEvent =
  | { readonly kind: "selection" }
  | { readonly kind: "hover" }
  | { readonly kind: "track-lock" }
  | { readonly kind: "live-state" };

export type ViewingPlaybackChangedEvent =
  | { readonly kind: "started" }
  | { readonly kind: "paused" }
  | { readonly kind: "frame" }
  | { readonly kind: "rate"; readonly rate: number };

export type ViewingProjectionChangedEvent =
  | { readonly kind: "replaced" }
  | { readonly kind: "appended"; readonly watchesAdded: number }
  | { readonly kind: "transform" };

export interface ViewingDataSink {
  appendLiveBatch(batch: ParsedLiveViewingBatch): ViewingAppendResult;
}
