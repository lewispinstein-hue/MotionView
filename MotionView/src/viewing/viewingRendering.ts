import type { ViewingRendering } from "./viewingTypes";

export function createViewingRendering(): ViewingRendering {
  return {
    renderLists() {},
    renderWatchList() {},
    renderLogList() {},
    renderWaypointList() {},
    renderPoseList() {},
    drawFieldOverlay() {},
    drawTimeline() {},
    updatePoseReadout() {},
  };
}
