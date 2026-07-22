import type { ViewingModeController } from "./viewingTypes";

export interface ViewingModeImplementation extends Partial<ViewingModeController> {}

export function createViewingMode(implementation: ViewingModeImplementation = {}): ViewingModeController {
  return {
    loadViewingData: implementation.loadViewingData ?? (() => {}),
    clear: implementation.clear ?? (() => {}),
    renderLists: implementation.renderLists ?? (() => {}),
    renderWatchList: implementation.renderWatchList ?? (() => {}),
    renderLogList: implementation.renderLogList ?? (() => {}),
    renderWaypointList: implementation.renderWaypointList ?? (() => {}),
    renderPoseList: implementation.renderPoseList ?? (() => {}),
    selectPose: implementation.selectPose ?? (() => {}),
    selectWatch: implementation.selectWatch ?? (() => {}),
    selectWaypoint: implementation.selectWaypoint ?? (() => {}),
    updatePoseReadout: implementation.updatePoseReadout ?? (() => {}),
    currentDisplayPose: implementation.currentDisplayPose ?? (() => null),
    getExportData: implementation.getExportData ?? (() => ({ poses: [], watches: [], logs: [], waypoints: [], meta: null })),
    hasData: implementation.hasData ?? (() => false),
    bindEvents: implementation.bindEvents ?? (() => {}),
  };
}
