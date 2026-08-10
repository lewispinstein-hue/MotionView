import { setStatus } from "../app/status";
import { requestDrawAll } from "../render/renderScheduler";
import type { Pose } from "../state/models";
import type { PoseReader } from "../state/poseStore";
import type { ViewingSelectionController } from "./viewingSelection";
import type { WatchMarker } from "./viewingTypes";

export interface ViewingPlaybackOptions {
  selection: ViewingSelectionController;
  getPoses(): PoseReader;
  getPlayRate(): number;
  isLivestreaming(): boolean;
  setPlayButtonLabel(label: string): void;
  formatTimeSeconds(ms: number | null): string;
  interpolatePoseAtTime(timeMs: number): Pose | null;
  findFloorIndexByTime(timeMs: number): number;
  lastWatchAtTime(timeMs: number): WatchMarker | null;
  highlightWatch(timeMs: number, doScroll: boolean): void;
  updatePoseReadout(): void;
}

export interface ViewingPlaybackController {
  isPlaying(): boolean;
  getPlayTimeMs(): number | null;
  getPlayPose(): Pose | null;
  setPlayTimeMs(timeMs: number | null): void;
  play(): void;
  pause(): void;
  setPlayRate(rate: number): void;
}

export function createViewingPlayback(options: ViewingPlaybackOptions): ViewingPlaybackController {
  let playing = false;
  let raf: number | null = null;
  let playTimeMs: number | null = null;
  let lastWall: number | null = null;
  let playRate = options.getPlayRate();
  let playPose: Pose | null = null;

  const cancelFrame = () => {
    if (raf != null) cancelAnimationFrame(raf);
    raf = null;
  };

  const pause = () => {
    if (!playing) return;
    playing = false;
    options.setPlayButtonLabel("▶");
    cancelFrame();
    playPose = null;
    lastWall = null;
    const poses = options.getPoses();
    setStatus(`Paused at time ${options.formatTimeSeconds(poses[options.selection.selectedIndex]?.t ?? 0)}s`);
  };

  const play = () => {
    const poses = options.getPoses();
    if (!poses.length) return;
    if (options.isLivestreaming()) {
      setStatus("Playback disabled while livestreaming.");
      return;
    }

    const tMin = poses[0]?.t ?? 0;
    const tMax = poses[poses.length - 1]?.t ?? tMin;
    if (
      options.selection.selectedIndex >= poses.length - 1
      || (typeof playTimeMs === "number" && playTimeMs >= tMax)
    ) {
      options.selection.selectedIndex = 0;
      playTimeMs = tMin;
      playPose = null;
    }

    options.selection.clearTrackHover(true);
    options.selection.clearTrackLock();
    options.selection.selectedWatch = null;
    options.selection.selectedLogTime = null;
    options.selection.timelineHoverSaved = null;
    setStatus(`Playing from time ${options.formatTimeSeconds(poses[options.selection.selectedIndex]?.t ?? 0)}s`);

    const tStart = poses[options.selection.selectedIndex]?.t;
    playTimeMs = (typeof tStart === "number") ? tStart : (poses[0]?.t ?? 0);

    playing = true;
    options.setPlayButtonLabel("⏸");
    lastWall = performance.now();

    const tick = (now: number) => {
      if (!playing) return;
      const previousWall = lastWall ?? now;
      const dtWall = now - previousWall;
      lastWall = now;
      playTimeMs = (playTimeMs ?? tMin) + dtWall * playRate;

      if (playTimeMs >= tMax) {
        playTimeMs = tMax;
        playPose = options.interpolatePoseAtTime(playTimeMs);
        options.selection.selectedIndex = poses.length - 1;
        options.updatePoseReadout();
        requestDrawAll();
        pause();
        return;
      }

      playPose = options.interpolatePoseAtTime(playTimeMs);
      options.selection.selectedIndex = options.findFloorIndexByTime(playTimeMs);

      const last = options.lastWatchAtTime(playTimeMs);
      if (last && (!options.selection.selectedWatch || options.selection.selectedWatch.marker?.t !== last.t)) {
        options.selection.selectedWatch = { marker: last };
        options.highlightWatch(last.t, false);
      }

      options.updatePoseReadout();
      requestDrawAll();
      raf = requestAnimationFrame(tick);
    };

    cancelFrame();
    raf = requestAnimationFrame(tick);
  };

  return {
    isPlaying: () => playing,
    getPlayTimeMs: () => playTimeMs,
    getPlayPose: () => playPose,
    setPlayTimeMs(timeMs: number | null) {
      playTimeMs = timeMs;
      playPose = typeof timeMs === "number" ? options.interpolatePoseAtTime(timeMs) : null;
    },
    play,
    pause,
    setPlayRate(rate: number) {
      playRate = Number(rate) || 1;
    },
  };
}
