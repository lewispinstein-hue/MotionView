import { setStatus } from "../app/status";
import { requestDrawAll } from "../render/renderScheduler";
import type { ViewingInput } from "./viewingTypes";

export interface ViewingInputDependencies {
  hasData?: () => boolean;
  isLiveConnected?: () => boolean;
  getLiveAutoFollowHead?: () => boolean;
  setLiveAutoFollowHead?: (enabled: boolean) => void;
  getSelectedIndex?: () => number;
  getPoseCount?: () => number;
  setSelectedIndex?: (index: number) => void;
  setLastPoseIndex?: (index: number) => void;
  clearTransientSelection?: () => void;
  clearTrackHover?: () => void;
  clearTrackLock?: () => void;
  isPlaying?: () => boolean;
  play?: () => void;
  pause?: () => void;
  highlightPoseList?: () => void;
  updatePoseReadout?: () => void;
}

export function createViewingInput(deps: ViewingInputDependencies = {}): ViewingInput {
  const updateLiveAutoFollowWindowState = (enabled: boolean) => {
    if (typeof window === "undefined") return;
    const liveState = (window as any).__live;
    if (liveState) liveState.autoFollowHead = enabled;
  };

  const selectPoseOffset = (offset: number) => {
    deps.pause?.();
    deps.clearTrackHover?.();
    deps.clearTrackLock?.();
    deps.clearTransientSelection?.();
    const poseCount = deps.getPoseCount?.() ?? 0;
    const selectedIndex = deps.getSelectedIndex?.() ?? 0;
    const nextIndex = offset < 0
      ? Math.max(0, selectedIndex + offset)
      : Math.min(poseCount - 1, selectedIndex + offset);
    deps.setSelectedIndex?.(nextIndex);
    deps.setLastPoseIndex?.(nextIndex);
    deps.highlightPoseList?.();
    deps.updatePoseReadout?.();
    requestDrawAll();
  };

  return {
    bindEvents() {},
    handleKeydown(event: KeyboardEvent) {
      if (!deps.hasData?.()) return false;

      if (event.code === "Space" && deps.isLiveConnected?.()) {
        event.preventDefault();
        const nextAutoFollow = !deps.getLiveAutoFollowHead?.();
        if (!nextAutoFollow) {
          deps.setLastPoseIndex?.(deps.getSelectedIndex?.() ?? 0);
        }
        deps.setLiveAutoFollowHead?.(nextAutoFollow);
        updateLiveAutoFollowWindowState(nextAutoFollow);
        setStatus(`Live View: Auto-follow head: ${nextAutoFollow ? "ON" : "OFF"} (Space)`);
        return true;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (deps.isPlaying?.()) {
          deps.pause?.();
          deps.updatePoseReadout?.();
          requestDrawAll();
        } else {
          deps.play?.();
        }
        return true;
      }

      if (event.code === "ArrowLeft") {
        event.preventDefault();
        selectPoseOffset(-1);
        return true;
      }

      if (event.code === "ArrowRight") {
        event.preventDefault();
        selectPoseOffset(1);
        return true;
      }

      return false;
    },
  };
}
