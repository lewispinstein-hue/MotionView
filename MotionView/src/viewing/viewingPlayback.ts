import type { Pose } from "../state/models";
import type { ViewingEvents } from "./viewingEvents";
import type { ViewingDataReader } from "./viewingTypes";
import type { ViewingNavigation } from "./ViewingNavigation";
import type { ViewingProjection } from "./ViewingProjection";

/** Owns Viewing playback timing and exposes readonly current-frame state. */
export class ViewingPlayback {
  #playing = false;
  #rate = 1;
  #timeMs: number | null = null;
  #pose: Readonly<Pose> | null = null;
  #lastWallTime: number | null = null;
  #frame: number | null = null;

  constructor(
    private readonly data: ViewingDataReader,
    private readonly navigation: ViewingNavigation,
    private readonly projection: ViewingProjection,
    private readonly events: ViewingEvents,
  ) {
    events.dataChanged.subscribe((change) => {
      if (change.kind === "replaced" || change.kind === "cleared") this.pause();
    });
  }

  get isPlaying(): boolean { return this.#playing; }
  get rate(): number { return this.#rate; }
  get timeMs(): number | null { return this.#timeMs; }
  get pose(): Readonly<Pose> | null { return this.#pose; }

  setRate(rate: number): void {
    const next = Number.isFinite(rate) && rate > 0 ? rate : 1;
    if (next === this.#rate) return;
    this.#rate = next;
    this.events.playbackChanged.emit({ kind: "rate", rate: next });
  }

  setTime(timeMs: number | null): void {
    this.#timeMs = timeMs;
    this.#pose = this.projection.interpolatePose(timeMs);
    if (timeMs != null) {
      this.navigation.selectPose(this.projection.findFloorIndex(timeMs), { preserveDetails: true });
    }
    this.events.playbackChanged.emit({ kind: "frame" });
  }

  play(): void {
    const range = this.projection.timeRange();
    if (!range || this.#playing) return;
    this.#playing = true;
    this.#timeMs = this.#timeMs == null || this.#timeMs >= range.end ? range.start : this.#timeMs;
    this.#lastWallTime = null;
    this.events.playbackChanged.emit({ kind: "started" });
    this.#frame = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (this.#frame != null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#lastWallTime = null;
    if (!this.#playing) return;
    this.#playing = false;
    this.events.playbackChanged.emit({ kind: "paused" });
  }

  toggle(): void {
    if (this.#playing) this.pause();
    else this.play();
  }

  currentDisplayPose(): Readonly<Pose> | null {
    if (this.#playing) return this.#pose ?? this.projection.interpolatePose(this.#timeMs);
    if (this.navigation.hoverTimelineTime != null) return this.projection.interpolatePose(this.navigation.hoverTimelineTime);
    if (this.navigation.trackHoverPose) return this.navigation.trackHoverPose;
    if (this.navigation.trackLockPose) return this.navigation.trackLockPose;
    return this.projection.poseAt(this.navigation.selectedIndex);
  }

  currentDisplayIndex(): number {
    if (this.#playing && this.#timeMs != null) return this.projection.findFloorIndex(this.#timeMs);
    if (this.navigation.hoverTimelineTime != null) return this.projection.findFloorIndex(this.navigation.hoverTimelineTime);
    if (this.navigation.trackHoverTime != null) return this.projection.findFloorIndex(this.navigation.trackHoverTime);
    if (this.navigation.trackLockIndex != null) return this.navigation.trackLockIndex;
    return this.navigation.selectedIndex;
  }

  readonly tick = (wallTime: number): void => {
    if (!this.#playing) return;
    const range = this.projection.timeRange();
    if (!range) {
      this.pause();
      return;
    }
    if (this.#lastWallTime == null) this.#lastWallTime = wallTime;
    const elapsed = (wallTime - this.#lastWallTime) * this.#rate;
    this.#lastWallTime = wallTime;
    this.#timeMs = Math.min(range.end, (this.#timeMs ?? range.start) + elapsed);
    this.#pose = this.projection.interpolatePose(this.#timeMs);
    this.navigation.selectPose(this.projection.findFloorIndex(this.#timeMs), { preserveDetails: true });
    this.events.playbackChanged.emit({ kind: "frame" });
    if (this.#timeMs >= range.end) this.pause();
    else this.#frame = requestAnimationFrame(this.tick);
  };
}
