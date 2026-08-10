import type { Pose } from "../state/models";
import type { PoseReader } from "../state/poseStore";
import type { WatchMarker } from "./viewingTypes";

export interface TimelineHoverSnapshot {
  index: number;
  lockActive: boolean;
  lockPose: Pose | null;
  lockIndex: number | null;
}

export interface TrackHoverState {
  pose?: Pose | null;
  t?: number | null;
  idxNearest: number | null;
}

export interface SelectedWatchState {
  marker: WatchMarker;
}

export interface ViewingSelectionController {
  selectedIndex: number;
  selectedWatch: SelectedWatchState | null;
  selectedLogTime: number | null;
  selectedWaypointId: number | string | null;
  selectedWaypointEventTime: number | null;
  hoverTimelineTime: number | null;
  timelineHoverSaved: TimelineHoverSnapshot | null;
  trackHover: TrackHoverState | null;
  trackHoverSavedIndex: number | null;
  trackLockActive: boolean;
  trackLockPose: Pose | null;
  trackLockIndex: number | null;
  clearSelectedDetail(): void;
  clearTimelineHover(restore?: boolean): void;
  saveTimelineHoverIfNeeded(): void;
  setSelectedPoseIndex(index: number): void;
  setSelectedWatch(marker: WatchMarker | null): void;
  setSelectedLogTime(time: number | null): void;
  setSelectedWaypoint(waypointId: number | string | null, eventTime?: number | null): void;
  clearTrackHover(restore: boolean): void;
  clearTrackLock(): void;
  lockTrackPose(pose: Pose, index: number): void;
  currentReferenceTime(poses: PoseReader, playingTime?: number | null, playing?: boolean): number | null;
  reset(): void;
}

export function createViewingSelection(): ViewingSelectionController {
  const controller: ViewingSelectionController = {
    selectedIndex: 0,
    selectedWatch: null,
    selectedLogTime: null,
    selectedWaypointId: null,
    selectedWaypointEventTime: null,
    hoverTimelineTime: null,
    timelineHoverSaved: null,
    trackHover: null,
    trackHoverSavedIndex: null,
    trackLockActive: false,
    trackLockPose: null,
    trackLockIndex: null,

    clearSelectedDetail() {
      controller.selectedWatch = null;
      controller.selectedLogTime = null;
      controller.selectedWaypointId = null;
      controller.selectedWaypointEventTime = null;
    },

    clearTimelineHover(restore = false) {
      controller.hoverTimelineTime = null;
      if (restore && controller.timelineHoverSaved) {
        controller.selectedIndex = controller.timelineHoverSaved.index;
        controller.trackLockActive = controller.timelineHoverSaved.lockActive;
        controller.trackLockPose = controller.timelineHoverSaved.lockPose;
        controller.trackLockIndex = controller.timelineHoverSaved.lockIndex;
      }
      controller.timelineHoverSaved = null;
    },

    saveTimelineHoverIfNeeded() {
      if (controller.timelineHoverSaved != null) return;
      controller.timelineHoverSaved = {
        index: controller.selectedIndex,
        lockActive: controller.trackLockActive,
        lockPose: controller.trackLockPose,
        lockIndex: controller.trackLockIndex,
      };
    },

    setSelectedPoseIndex(index: number) {
      controller.selectedIndex = index;
    },

    setSelectedWatch(marker: WatchMarker | null) {
      controller.selectedWatch = marker ? { marker } : null;
      if (marker) {
        controller.selectedLogTime = null;
        controller.selectedWaypointId = null;
        controller.selectedWaypointEventTime = null;
      }
    },

    setSelectedLogTime(time: number | null) {
      controller.selectedLogTime = time;
    },

    setSelectedWaypoint(waypointId: number | string | null, eventTime: number | null = null) {
      controller.selectedWaypointId = waypointId;
      controller.selectedWaypointEventTime = eventTime;
      if (waypointId != null) {
        controller.selectedWatch = null;
        controller.selectedLogTime = null;
      }
    },

    clearTrackHover(restore: boolean) {
      controller.trackHover = null;
      if (restore && controller.trackHoverSavedIndex != null) {
        controller.selectedIndex = controller.trackHoverSavedIndex;
        controller.trackHoverSavedIndex = null;
      }
    },

    clearTrackLock() {
      controller.trackLockActive = false;
      controller.trackLockPose = null;
      controller.trackLockIndex = null;
    },

    lockTrackPose(pose: Pose, index: number) {
      controller.trackLockActive = true;
      controller.trackLockPose = pose;
      controller.trackLockIndex = index;
      controller.selectedIndex = index;
    },

    currentReferenceTime(poses: readonly Pose[], playingTime: number | null = null, playing = false) {
      if (playing) return playingTime ?? null;
      if (controller.hoverTimelineTime != null) return controller.hoverTimelineTime;
      if (controller.trackHover?.pose?.t != null) return controller.trackHover.pose.t;
      if (controller.trackLockActive && controller.trackLockPose?.t != null) return controller.trackLockPose.t;
      if (!poses.length) return null;
      const idx = Math.max(0, Math.min(controller.selectedIndex, poses.length - 1));
      return poses[idx]?.t ?? null;
    },

    reset() {
      controller.selectedIndex = 0;
      controller.selectedWatch = null;
      controller.selectedLogTime = null;
      controller.selectedWaypointId = null;
      controller.selectedWaypointEventTime = null;
      controller.hoverTimelineTime = null;
      controller.timelineHoverSaved = null;
      controller.trackHover = null;
      controller.trackHoverSavedIndex = null;
      controller.trackLockActive = false;
      controller.trackLockPose = null;
      controller.trackLockIndex = null;
    },
  };

  return controller;
}

export function scrollIntoViewIfNeeded(
  container: HTMLElement | null,
  element: Element | null,
  pad = 10,
) {
  if (!container || !element) return;
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  if (
    elementRect.top >= containerRect.top + pad
    && elementRect.bottom <= containerRect.bottom - pad
  ) {
    return;
  }

  const topDelta = elementRect.top - (containerRect.top + pad);
  const bottomDelta = elementRect.bottom - (containerRect.bottom - pad);
  if (topDelta < 0) container.scrollTop += topDelta;
  else if (bottomDelta > 0) container.scrollTop += bottomDelta;
}
