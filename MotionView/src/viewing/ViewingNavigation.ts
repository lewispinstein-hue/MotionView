import type { LogEntry, Pose } from "../state/models";
import type { ViewingEvents } from "./viewingEvents";
import type { ViewingDataReader, WatchMarker, WaypointEventView, WaypointView } from "./viewingTypes";

/** Owns Viewing selection and navigation state without knowing about DOM rendering. */
export class ViewingNavigation {
  #selectedIndex = 0;
  #selectedWatch: Readonly<WatchMarker> | null = null;
  #selectedLog: Readonly<LogEntry> | null = null;
  #selectedWaypointId: number | string | null = null;
  #selectedWaypointEventTime: number | null = null;
  #selectedWaypointEvent: Readonly<WaypointEventView> | null = null;
  #hoverTimelineTime: number | null = null;
  #trackHoverPose: Readonly<Pose> | null = null;
  #trackHoverTime: number | null = null;
  #trackLockPose: Readonly<Pose> | null = null;
  #trackLockIndex: number | null = null;
  #connected = false;
  #streaming = false;
  #autoFollow = true;
  #lastManualIndex = 0;

  constructor(
    private readonly data: ViewingDataReader,
    private readonly events: ViewingEvents,
  ) {
    events.dataChanged.subscribe((change) => {
      if (change.kind === "replaced" || change.kind === "cleared") this.reset();
      else if (change.kind === "appended" && change.result.posesAdded > 0 && this.#autoFollow) {
        this.#selectedIndex = Math.max(0, data.poses.length - 1);
        this.emit("selection");
      }
    });
  }

  get selectedIndex(): number { return this.#selectedIndex; }
  get selectedWatch(): Readonly<WatchMarker> | null { return this.#selectedWatch; }
  get selectedLog(): Readonly<LogEntry> | null { return this.#selectedLog; }
  get selectedLogTime(): number | null { return this.#selectedLog?.t ?? null; }
  get selectedWaypointId(): number | string | null { return this.#selectedWaypointId; }
  get selectedWaypointEventTime(): number | null { return this.#selectedWaypointEventTime; }
  get selectedWaypointEvent(): Readonly<WaypointEventView> | null { return this.#selectedWaypointEvent; }
  get hoverTimelineTime(): number | null { return this.#hoverTimelineTime; }
  get trackHoverPose(): Readonly<Pose> | null { return this.#trackHoverPose; }
  get trackHoverTime(): number | null { return this.#trackHoverTime; }
  get trackLockPose(): Readonly<Pose> | null { return this.#trackLockPose; }
  get trackLockIndex(): number | null { return this.#trackLockIndex; }
  get trackLockActive(): boolean { return this.#trackLockPose != null; }
  get liveConnected(): boolean { return this.#connected; }
  get livestreaming(): boolean { return this.#streaming; }
  get autoFollow(): boolean { return this.#autoFollow; }

  setLiveState(connected: boolean, streaming: boolean): void {
    if (connected === this.#connected && streaming === this.#streaming) return;
    this.#connected = connected;
    this.#streaming = streaming;
    this.emit("live-state");
  }

  setAutoFollow(enabled: boolean): void {
    const next = !!enabled;
    if (next === this.#autoFollow) return;
    if (!next) this.#lastManualIndex = this.#selectedIndex;
    this.#autoFollow = next;
    if (next && this.data.poses.length) this.#selectedIndex = this.data.poses.length - 1;
    this.emit("live-state");
  }

  selectPose(index: number, options: Readonly<{ preserveDetails?: boolean }> = {}): void {
    this.#selectedIndex = Math.max(0, Math.min(this.data.poses.length - 1, Math.trunc(index)));
    this.#lastManualIndex = this.#selectedIndex;
    if (!options.preserveDetails) this.clearDetails(false);
    this.emit("selection");
  }

  movePoseBy(offset: number): void {
    this.selectPose(this.#selectedIndex + Math.trunc(offset));
  }

  selectWatch(marker: Readonly<WatchMarker>): void {
    this.#selectedWatch = marker;
    this.#selectedLog = null;
    this.#selectedWaypointId = null;
    this.#selectedWaypointEventTime = null;
    this.#selectedWaypointEvent = null;
    this.emit("selection");
  }

  selectLog(entry: Readonly<LogEntry> | null): void {
    this.#selectedLog = entry;
    this.#selectedWatch = null;
    this.#selectedWaypointId = null;
    this.#selectedWaypointEventTime = null;
    this.#selectedWaypointEvent = null;
    this.emit("selection");
  }

  selectWaypoint(waypoint: WaypointView, event: WaypointEventView | null = null): void {
    this.#selectedWaypointId = waypoint.id;
    this.#selectedWaypointEventTime = event?.t ?? waypoint.latestActiveEvent?.t ?? waypoint.createdTime ?? null;
    this.#selectedWaypointEvent = event;
    this.#selectedWatch = null;
    this.#selectedLog = null;
    this.emit("selection");
  }

  setTimelineHover(time: number | null): void {
    if (time === this.#hoverTimelineTime) return;
    this.#hoverTimelineTime = time;
    this.emit("hover");
  }

  setTrackHover(pose: Readonly<Pose> | null, time: number | null = null): void {
    if (pose === this.#trackHoverPose && time === this.#trackHoverTime) return;
    this.#trackHoverPose = pose;
    this.#trackHoverTime = time;
    this.emit("hover");
  }

  lockTrack(pose: Readonly<Pose>, index: number): void {
    this.#selectedIndex = Math.max(0, Math.min(this.data.poses.length - 1, Math.trunc(index)));
    this.#lastManualIndex = this.#selectedIndex;
    this.clearDetails(false);
    this.#trackLockPose = pose;
    this.#trackLockIndex = this.#selectedIndex;
    this.emit("track-lock");
  }

  clearTrackLock(): void {
    if (!this.#trackLockPose) return;
    this.#trackLockPose = null;
    this.#trackLockIndex = null;
    this.emit("track-lock");
  }

  clearDetails(emit = true): void {
    this.#selectedWatch = null;
    this.#selectedLog = null;
    this.#selectedWaypointId = null;
    this.#selectedWaypointEventTime = null;
    this.#selectedWaypointEvent = null;
    if (emit) this.emit("selection");
  }

  reset(): void {
    this.#selectedIndex = 0;
    this.#lastManualIndex = 0;
    this.#selectedWatch = null;
    this.#selectedLog = null;
    this.#selectedWaypointId = null;
    this.#selectedWaypointEventTime = null;
    this.#selectedWaypointEvent = null;
    this.#hoverTimelineTime = null;
    this.#trackHoverPose = null;
    this.#trackHoverTime = null;
    this.#trackLockPose = null;
    this.#trackLockIndex = null;
    this.emit("selection");
  }

  private emit(kind: "selection" | "hover" | "track-lock" | "live-state"): void {
    this.events.navigationChanged.emit({ kind });
  }
}
