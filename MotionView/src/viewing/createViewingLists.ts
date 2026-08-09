import { createLogListRenderer, type LogListRenderer } from "./logList";
import { createPoseListRenderer, type PoseListRenderer } from "./poseList";
import { createVirtualList, type VirtualList } from "./virtualList";
import { createWatchListRenderer, type WatchListRenderer } from "./watchList";
import { createWaypointListRenderer, type WaypointListRenderer } from "./waypointList";

export interface CreateViewingListsDependencies {
  elements: {
    watchList: HTMLElement | null;
    watchFilter: HTMLSelectElement | null;
    watchSort: HTMLSelectElement | null;
    watchCount: HTMLElement | null;
    poseList: HTMLElement | null;
    poseCount: HTMLElement | null;
    waypointList: HTMLElement | null;
    waypointCount: HTMLElement | null;
    waypointFilter: HTMLSelectElement | null;
    logList: HTMLElement | null;
    logCount: HTMLElement | null;
    logSort: HTMLSelectElement | null;
  };
  getWatchMarkers(): any[];
  getWatches(): any[];
  getLogs(): any[];
  getWaypoints(): any[];
  getVisibleWaypointEvents(): Array<{ waypoint: any; event: any }>;
  getSelectedWatch(): any;
  getSelectedPoseIndex(): number;
  getPoseCount(): number;
  getPose(index: number): any;
  getSelectedWaypointId(): unknown;
  getSelectedWaypointEventTime(): unknown;
  getSelectedLogTime(): number | null;
  setSelectedLogTime(time: number | null): void;
  clearWaypointSelectionState(): void;
  onPoseSelected(index: number): void;
  onWaypointEventSelected(waypoint: any, event: any): void;
  selectWatchMarker(marker: any, fromUserClick: boolean, clickPos: { x: number; y: number } | null): void;
  toggleFloatingWatch(watchId: unknown): void;
  toggleWatchVisibilityForWatch(watch: any): void;
  openOrToggleWatchGraphPanel(marker: any): void;
  refreshWatchGraphPanelData(): void;
  jumpToEventTime(time: number, options: Record<string, unknown>): void;
  getRawPoseTime(index: number): unknown;
  poseToInches(pose: any): { x: number; y: number; theta: number };
  formatNumberString(value: unknown, decimals?: number, fallback?: string): string;
  fmtNum(value: unknown, decimals?: number): string;
  escapeHtml(value: unknown): string;
  levelStyle(level: unknown): { fill: string; text: string; name: string };
  levelSortRank(level: unknown): number;
  watchSortValueKey(value: unknown): { t: number; n: number; s: string };
  watchFilterKeyForWatch(watch: any): string;
  watchFilterMatches(watch: any): boolean;
  watchFilterLabelForWatch(watch: any): string;
  watchVisibilityKeyForWatch(watch: any): string;
  watchVisibilityIconId(watch: any): string;
  watchVisibilityTitle(watch: any): string;
  isGraphableWatchValue(value: unknown): boolean;
  svgIconHref(iconId: string): string;
  setSvgUseHref(useElement: SVGUseElement | null, href: string): void;
  waypointTypeStyle(type: unknown): { fill: string; text: string };
  waypointEventLines(event: any): string[];
  fmtSecondsToString(ms: unknown): string | null;
  scrollIntoViewIfNeeded(container: HTMLElement | null, element: Element | null, pad?: number): void;
  watchToleranceMs: number;
}

export interface ViewingListsController {
  renderers: {
    watchListRenderer: WatchListRenderer;
    poseListRenderer: PoseListRenderer;
    waypointListRenderer: WaypointListRenderer;
    logListRenderer: LogListRenderer;
  };
  highlightWatch(timeMs: unknown, doScroll: boolean): void;
  highlightPose(): void;
  highlightWaypoint(waypointId: unknown, eventTime: unknown, doScroll: boolean): void;
  highlightLog(timeMs: number | null, doScroll: boolean): void;
  bindEvents(): void;
}

export function createViewingLists(deps: CreateViewingListsDependencies): ViewingListsController {
  const { elements } = deps;
  let watchListVirtual: VirtualList<any> | null = null;
  let poseListVirtual: VirtualList<any> | null = null;
  let logListVirtual: VirtualList<any> | null = null;

  const watchListRenderer = createWatchListRenderer({
    watchList: elements.watchList,
    watchFilter: elements.watchFilter,
    watchSort: elements.watchSort,
    watchCount: elements.watchCount,
    get watchListVirtual() { return watchListVirtual; },
    getWatchMarkers: deps.getWatchMarkers,
    getWatches: deps.getWatches,
    getSelectedWatch: deps.getSelectedWatch,
    setRenderedWatchIndexByTime: () => {},
    refreshWatchGraphPanelData: deps.refreshWatchGraphPanelData,
    levelStyle: deps.levelStyle,
    levelSortRank: deps.levelSortRank,
    watchSortValueKey: deps.watchSortValueKey,
    watchFilterKeyForWatch: deps.watchFilterKeyForWatch,
    watchFilterMatches: deps.watchFilterMatches,
    watchFilterLabelForWatch: deps.watchFilterLabelForWatch,
    watchVisibilityKeyForWatch: deps.watchVisibilityKeyForWatch,
    watchVisibilityIconId: deps.watchVisibilityIconId,
    watchVisibilityTitle: deps.watchVisibilityTitle,
    isGraphableWatchValue: deps.isGraphableWatchValue,
    svgIconHref: deps.svgIconHref,
    setSvgUseHref: deps.setSvgUseHref,
    escapeHtml: deps.escapeHtml,
    fmtNum: deps.fmtNum,
    selectWatchMarker: deps.selectWatchMarker,
    toggleFloatingWatch: deps.toggleFloatingWatch,
    toggleWatchVisibilityForWatch: deps.toggleWatchVisibilityForWatch,
    openOrToggleWatchGraphPanel: deps.openOrToggleWatchGraphPanel,
  });

  watchListVirtual = createVirtualList<any>(elements.watchList, {
    estimateRowHeight: 62,
    overscanPx: 480,
    getKey: (item: any, index) => `${item?.t ?? "watch"}:${index}`,
    renderItem: (item) => watchListRenderer.createItem(item),
    syncRowLayout: watchListRenderer.syncItemActionLayout,
  });

  const poseListRenderer = createPoseListRenderer({
    poseList: elements.poseList,
    poseCount: elements.poseCount,
    get poseListVirtual() { return poseListVirtual; },
    getPoseCount: deps.getPoseCount,
    getPose: deps.getPose,
    getSelectedIndex: deps.getSelectedPoseIndex,
    poseToInches: deps.poseToInches,
    formatNumberString: deps.formatNumberString,
    fmtNum: deps.fmtNum,
    escapeHtml: deps.escapeHtml,
    onPoseSelected: deps.onPoseSelected,
  });

  poseListVirtual = createVirtualList<any>(elements.poseList, {
    estimateRowHeight: 52,
    overscanPx: 320,
    getKey: (_, index) => `pose:${index}`,
    renderItem: (_, index) => poseListRenderer.createItem(index),
  });

  const waypointListRenderer = createWaypointListRenderer({
    waypointList: elements.waypointList,
    waypointCount: elements.waypointCount,
    waypointFilter: elements.waypointFilter,
    getWaypoints: deps.getWaypoints,
    getVisibleEvents: deps.getVisibleWaypointEvents,
    getSelectedWaypointId: deps.getSelectedWaypointId,
    getSelectedWaypointEventTime: deps.getSelectedWaypointEventTime,
    waypointTypeStyle: deps.waypointTypeStyle,
    waypointEventLines: deps.waypointEventLines,
    fmtSecondsToString: deps.fmtSecondsToString,
    escapeHtml: deps.escapeHtml,
    scrollIntoViewIfNeeded: deps.scrollIntoViewIfNeeded,
    onWaypointEventSelected: deps.onWaypointEventSelected,
  });

  const logListRenderer = createLogListRenderer({
    logList: elements.logList,
    logCount: elements.logCount,
    get logListVirtual() { return logListVirtual; },
    logSort: elements.logSort,
    watchToleranceMs: deps.watchToleranceMs,
    getLogs: deps.getLogs,
    getSelectedLogTime: deps.getSelectedLogTime,
    setSelectedLogTime: deps.setSelectedLogTime,
    clearWaypointSelectionState: deps.clearWaypointSelectionState,
    highlightWaypointInList: (waypointId, eventTime, doScroll) => waypointListRenderer.highlight(waypointId, eventTime, doScroll),
    jumpToEventTime: deps.jumpToEventTime,
    getRawPoseTime: deps.getRawPoseTime,
    levelStyle: deps.levelStyle,
    levelSortRank: deps.levelSortRank,
    fmtNum: deps.fmtNum,
    escapeHtml: deps.escapeHtml,
    scrollIntoViewIfNeeded: deps.scrollIntoViewIfNeeded,
  });

  logListVirtual = createVirtualList<any>(elements.logList, {
    estimateRowHeight: 74,
    overscanPx: 420,
    getKey: (item: any, index) => `${item?.t ?? "log"}:${index}`,
    renderItem: (item) => logListRenderer.createItem(item),
  });

  function bindEvents() {
    document.addEventListener("pointerdown", (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (watchListRenderer.isActionsMenuTarget(target)) return;
      watchListRenderer.closeActionsMenu();
    }, true);

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        watchListRenderer.closeActionsMenu({ restoreFocus: true });
      } else if (ev.key === "Tab") {
        watchListRenderer.closeActionsMenu();
      }
    }, true);

    elements.watchList?.addEventListener("scroll", () => {
      watchListRenderer.closeActionsMenu();
    }, { passive: true });
  }

  return {
    renderers: {
      watchListRenderer,
      poseListRenderer,
      waypointListRenderer,
      logListRenderer,
    },
    highlightWatch: (timeMs, doScroll) => watchListRenderer.highlight(timeMs, doScroll),
    highlightPose: () => poseListRenderer.highlight(),
    highlightWaypoint: (waypointId, eventTime, doScroll) => waypointListRenderer.highlight(waypointId, eventTime, doScroll),
    highlightLog: (timeMs, doScroll) => logListRenderer.highlight(timeMs, doScroll),
    bindEvents,
  };
}
