import { requestDrawAll } from "../render/renderScheduler";
import type { PlanningModeDependencies, PlanningPlayback, PlanningRendering } from "./planningTypes";
import type { PlanningModeInternalState } from "./planningInternalState";

export function createPlanningPlayback(
  state: PlanningModeInternalState,
  dependencies: PlanningModeDependencies,
  rendering: PlanningRendering,
): PlanningPlayback {
  const playback: PlanningPlayback = {
    isPlaying: () => state.playing,
    getPlaybackDistance: () => state.playDist,
    play() {
      if (state.waypoints.length < 2) return;
      const totalLength = dependencies.getPlanTotalLength?.() ?? 0;
      if (state.playDist >= totalLength) {
        state.playDist = 0;
        playback.setDistance(state.playDist);
      }
      state.playing = true;
      dependencies.setPlayButtonLabel?.("⏸");
      state.lastWall = performance.now();
      const tick = (now: number) => {
        if (!state.playing) return;
        const lastWall = state.lastWall ?? now;
        const dtWall = (now - lastWall) / 1000;
        state.lastWall = now;
        const total = dependencies.getPlanTotalLength?.() ?? 0;
        const speed = dependencies.getPlanSpeedUnitsPerSecAtDistance?.(state.playDist) ?? 0;
        const playbackRate = dependencies.getPlaybackRate?.() ?? 1;
        state.playDist += dtWall * speed * (playbackRate / 2);
        if (state.playDist >= total) {
          state.playDist = total;
          playback.pause();
        } else {
          state.raf = requestAnimationFrame(tick);
        }
        playback.setDistance(state.playDist);
      };
      state.raf = requestAnimationFrame(tick);
    },
    pause() {
      state.playing = false;
      dependencies.setPlayButtonLabel?.("▶");
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = null;
      state.lastWall = null;
    },
    togglePlayback() {
      if (state.playing) playback.pause();
      else playback.play();
    },
    setDistance(distanceInches: number) {
      const total = dependencies.getPlanTotalLength?.() ?? 0;
      const nextDistance = Number.isFinite(distanceInches) ? distanceInches : 0;
      state.playDist = Math.max(0, Math.min(nextDistance, total));
      dependencies.setPlanningDistanceUi?.(state.playDist, total, state.waypoints.length);
      rendering.drawTimeline();
      dependencies.onPlanningDistanceChanged?.();
      requestDrawAll();
    },
    updateControls() {
      dependencies.setPlanningControlsAvailability?.(state.waypoints.length);
    },
  };

  return playback;
}
