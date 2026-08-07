import type { ViewingRendering } from "./viewingTypes";
import type { LogListRenderer } from "./logList";
import type { PoseListRenderer } from "./poseList";
import type { WatchListRenderer } from "./watchList";
import type { WaypointListRenderer } from "./waypointList";

export interface ViewingRenderingDependencies {
  watchListRenderer?: WatchListRenderer;
  logListRenderer?: LogListRenderer;
  waypointListRenderer?: WaypointListRenderer;
  poseListRenderer?: PoseListRenderer;
  drawFieldOverlay?: () => void;
  drawTimeline?: () => void;
  updatePoseReadout?: () => void;
}

export function createViewingRendering(deps: ViewingRenderingDependencies = {}): ViewingRendering {
  return {
    renderLists() {
      deps.watchListRenderer?.renderList();
      deps.logListRenderer?.render();
      deps.waypointListRenderer?.renderList();
      deps.poseListRenderer?.render();
    },
    renderWatchFilter() {
      deps.watchListRenderer?.renderFilter();
    },
    renderWatchList() {
      deps.watchListRenderer?.renderList();
    },
    renderLogList() {
      deps.logListRenderer?.render();
    },
    renderWaypointFilter() {
      deps.waypointListRenderer?.renderFilter();
    },
    renderWaypointList() {
      deps.waypointListRenderer?.renderList();
    },
    renderPoseList() {
      deps.poseListRenderer?.render();
    },
    drawFieldOverlay() {
      deps.drawFieldOverlay?.();
    },
    drawTimeline() {
      deps.drawTimeline?.();
    },
    updatePoseReadout() {
      deps.updatePoseReadout?.();
    },
  };
}
