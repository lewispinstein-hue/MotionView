import { getMode } from "../app/modeController";
import { setStatus } from "../app/status";
import { requestDrawAll } from "../render/renderScheduler";
import { formatDistanceFromInches, getCurrentUnits } from "../shared/units";
import type { Pose, WatchEntry, Waypoint, WaypointEvent } from "../state/models";
import { createFloatingInfo } from "./floatingInfo";
import { createViewingFieldInteraction, type ViewingFieldInteractionController } from "./viewingFieldInteraction";
import { createViewingFieldOverlayRenderer, type ViewingFieldOverlayRenderer } from "./viewingFieldOverlay";
import { createViewingInput } from "./viewingInput";
import { createViewingLists } from "./createViewingLists";
import { createViewingPlayback, type ViewingPlaybackController } from "./viewingPlayback";
import { createViewingRendering } from "./viewingRendering";
import { createViewingSelection, scrollIntoViewIfNeeded, type ViewingSelectionController } from "./viewingSelection";
import { createViewingTimeline, type ViewingTimelineController } from "./viewingTimeline";
import { createWatchGraph } from "./watchGraph";
import { createWatchVisibility, type WatchVisibilityController } from "./watchVisibility";
import type { WatchMarker } from "./viewingTypes";

export interface ViewingRenderFlags {
  posesChanged?: boolean;
  watchesChanged?: boolean;
  logsChanged?: boolean;
  waypointsChanged?: boolean;
  filtersChanged?: boolean;
}

export interface ViewingUiController {
  selection: ViewingSelectionController;
  playback: ViewingPlaybackController;
  rendering: ReturnType<typeof createViewingRendering>;
  input: ReturnType<typeof createViewingInput>;
  timeline: ViewingTimelineController;
  fieldOverlay: ViewingFieldOverlayRenderer;
  fieldInteraction: ViewingFieldInteractionController;
  bindEvents(): void;
  setPlaybackRate(rate: number): void;
  currentDisplayPose(): Pose | null;
  updatePoseReadout(): void;
  drawWaypointOffsetOverlay(pose: Pose | null): void;
  recomputeWatchMarkers(): void;
  updateAfterDataChange(flags?: ViewingRenderFlags): void;
  resetForLoadedData(): void;
  clearTransientState(): void;
  syncLivePoseSelection(): void;
  currentVisibilityForWatch(watch: WatchEntry | null | undefined): boolean;
  hasSelectedWaypoint(): boolean;
  clearWaypointSelection(): void;
  toggleFloatingInfo(): void;
  toggleWatchGraph(): void;
  openFloatingWatch(watchId?: number | string | null): void;
  resizeWatchGraph(): void;
  handleWindowMouseMove(event: MouseEvent): void;
  handleWindowMouseUp(): void;
}

export interface CreateViewingUiOptions {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  timelineCanvas: HTMLCanvasElement | null;
  timelineContext: CanvasRenderingContext2D | null;
  timelineBar: HTMLElement | null;
  getData(): unknown;
  setData(data: any): void;
  getPoses(): any;
  getWatches(): WatchEntry[];
  getLogs(): any[];
  getWaypoints(): Waypoint[];
  getWaypointMap(): Map<number, Waypoint> | ReadonlyMap<number, Waypoint>;
  getWatchMarkers(): WatchMarker[];
  isLiveConnected(): boolean;
  isLivestreaming(): boolean;
  getLiveAutoFollowHead(): boolean;
  setLiveAutoFollowHead(enabled: boolean): void;
  getPlayRate(): number;
  setPlayButtonLabel(label: string): void;
  getFieldViewZoom(): number;
  getFieldScale(): number;
  worldToScreen(x: number, y: number): { x: number; y: number };
  screenToWorld(x: number, y: number): { x: number; y: number };
  isFieldPanning(): boolean;
  getSuppressNextClick(): boolean;
  consumeSuppressNextClick(): void;
  poseToInches(pose: any): Pose;
  interpolatePoseAtTime(timeMs: number | null): Pose | null;
  findFloorIndexByTime(timeMs: number | null): number;
  nearestIndexWithinTol(timeMs: number, toleranceMs: number): { idx: number; dt: number } | null;
  lastWatchAtTime(markers: readonly WatchMarker[], timeMs: number): WatchMarker | null;
  formatNumberString(value: unknown, decimals?: number, fallback?: string): string;
  formatFixedNumberString(value: unknown, decimals?: number, fallback?: string): string;
  fmtNum(value: unknown, decimals?: number): string;
  escapeHtml(value: unknown): string;
  clamp(value: number, min: number, max: number): number;
  angLerpDeg(a: number, b: number, t: number): number;
  heatColorFromNorm(value: number): string;
  levelStyle(level: unknown): { fill: string; text: string; name?: string };
  levelFillWithAlpha(level: unknown, alpha: number): string;
  levelSortRank(level: unknown): number;
  normalizeLogLevel(level: unknown): string;
  speedFromNorm(value: number | null | undefined): number | null;
  normFromSpeedRaw(value: number | null | undefined): number;
  watchGraphKeyForWatch(watch: Partial<WatchEntry> | null | undefined): string;
  normalizeWaypointType(value: unknown): string;
  svgIconHref(iconId: string): string;
  setSvgUseHref(useElement: SVGUseElement | null, href: string): void;
  isInsideField(cursor: { x: number; y: number } | null | undefined): boolean;
  isInsideTimeline(cursor: { x: number; y: number } | null | undefined): boolean;
  onFloatingInfoToggled(enabled: boolean): void;
  handlePlanningMouseMove(event: MouseEvent): void;
  handlePlanningMouseLeave(): void;
}

const WATCH_TOL_MS = 60;
const HOVER_PIXEL_TOL = 14;
const TRACK_HOVER_PAD_PX = 12;
const CANVAS_ZOOM_MIN = 0.15;
const WAYPOINT_OFFSET_PILL_MAX_W_PX = 150;
const floatingWindowBounds = {
  minWidth: 30,
  minHeight: 49,
  maxWidth: 400,
  maxHeight: 600,
};

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function fmtSecondsToString(ms: unknown, formatNumberString: CreateViewingUiOptions["formatNumberString"]) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return `${formatNumberString(ms / 1000, 2)}s`;
}

function watchSortValueKey(value: unknown) {
  if (value == null) return { t: 2, n: 0, s: "" };
  if (typeof value === "boolean") return { t: 0, n: value ? 1 : 0, s: String(value) };
  if (typeof value === "number") return { t: 1, n: value, s: "" };
  return { t: 0, n: 0, s: String(value) };
}

export function createViewingUi(options: CreateViewingUiOptions): ViewingUiController {
  const watchList = byId<HTMLElement>("watchList");
  const watchFilter = byId<HTMLSelectElement>("watchFilter");
  const watchSort = byId<HTMLSelectElement>("watchSort");
  const watchCount = byId<HTMLElement>("watchCount");
  const poseList = byId<HTMLElement>("poseList");
  const poseCount = byId<HTMLElement>("poseCount");
  const waypointList = byId<HTMLElement>("waypointList");
  const waypointCount = byId<HTMLElement>("waypointCount");
  const waypointFilter = byId<HTMLSelectElement>("waypointFilter");
  const logList = byId<HTMLElement>("logList");
  const logCount = byId<HTMLElement>("logCount");
  const logSort = byId<HTMLSelectElement>("logSort");
  const watchPopup = byId<HTMLElement>("watchPopup");
  const timePill = byId<HTMLElement>("timePill");
  const deltaPill = byId<HTMLElement>("deltaPill");
  const pointPill = byId<HTMLElement>("pointPill");
  const posePill = byId<HTMLElement>("posePill");
  const cursorPill = byId<HTMLElement>("cursorPill");
  const planCursorPill = byId<HTMLElement>("planCursorPill");

  let watchPopupOpen = false;
  let lastMouseClient = { x: 20, y: 20 };
  let lastPoseIndex = 0;
  let watchMarkersByTime: WatchMarker[] = [];
  let bound = false;

  const selection = createViewingSelection();

  function watchFilterValue() {
    return watchFilter?.value || "all";
  }

  const watchVisibility = createWatchVisibility({
    getWatches: options.getWatches,
    getFilterValue: watchFilterValue,
    graphKeyForWatch: options.watchGraphKeyForWatch,
    updateButtons: (key, iconId, title) => {
      const buttons = watchList?.querySelectorAll<HTMLButtonElement>(`.watchVisibilityBtn[data-watch-visibility-key="${key}"]`) ?? [];
      for (const button of buttons) {
        button.dataset.iconId = iconId;
        button.dataset.title = title;
      }
      updateWatchVisibilityButtons(key);
    },
  });

  function waypointFilterValue() {
    return waypointFilter?.value || "all";
  }

  function waypointFilterMatches(waypoint: Waypoint | null | undefined) {
    const filter = waypointFilterValue();
    if (filter === "all") return true;
    if (filter === "active") return !!waypoint?.active;
    return String(waypoint?.id) === filter;
  }

  function waypointVisibleEvents() {
    const visible: Array<{ waypoint: Waypoint; event: WaypointEvent }> = [];
    for (const waypoint of options.getWaypoints()) {
      if (!waypointFilterMatches(waypoint)) continue;
      for (const event of waypoint.events) visible.push({ waypoint, event });
    }
    return visible.sort((a, b) => (a.event.t ?? 0) - (b.event.t ?? 0));
  }

  function waypointTypeStyle(typeRaw: unknown) {
    const type = options.normalizeWaypointType(typeRaw);
    if (type === "TIMEDOUT") return { fill: "rgba(255, 120, 120, 0.18)", text: "#ffb0b0" };
    if (type === "REACHED") return { fill: "rgba(120, 220, 150, 0.18)", text: "#b6ffd0" };
    return { fill: "rgba(255,255,255,0.12)", text: "#f7fbff" };
  }

  function waypointEventLines(event: any) {
    if (!event) return [];
    const params = event.params || {};
    if (event.type === "CREATED") {
      const target = [`X: ${options.formatNumberString(params.tarX)}`, `Y: ${options.formatNumberString(params.tarY)}`];
      if (params.tarT != null) target.push(`θ: ${options.formatNumberString(params.tarT)}`);

      const lines = [`Target: ${target.join(", ")}`];
      const tolerances = [];
      if (params.linearTol != null) tolerances.push(`Linear: ${options.formatNumberString(params.linearTol)}`);
      if (params.thetaTol != null) tolerances.push(`Angular: ${options.formatNumberString(params.thetaTol)}`);
      if (tolerances.length) lines.push(`Tolerances: ${tolerances.join(", ")}`);
      if (params.timeoutMs != null) lines.push(`Timeout: ${fmtSecondsToString(params.timeoutMs, options.formatNumberString)}`);
      return lines;
    }

    if (event.type === "REACHED") {
      const lines = [];
      if (params.remainingTime != null) lines.push(`Time Left: ${fmtSecondsToString(params.remainingTime, options.formatNumberString)}`);
      return lines;
    }

    return [];
  }

  function recomputeWatchMarkers() {
    const watchMarkers = options.getWatchMarkers();
    watchMarkers.length = 0;
    for (const watch of options.getWatches()) {
      const t = watch.t;
      const near = options.nearestIndexWithinTol(t, WATCH_TOL_MS);
      if (near) {
        const pose = options.getPoses()[near.idx];
        watchMarkers.push({ watch, t, ok: true, dt: near.dt, pose: options.poseToInches(pose), idx: near.idx });
      } else {
        const interpolatedPose = options.interpolatePoseAtTime(t);
        watchMarkers.push({ watch, t, ok: false, dt: null, pose: interpolatedPose, idx: null });
      }
    }
    watchMarkersByTime = [...watchMarkers].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  }

  function updateWatchVisibilityButtons(key: string) {
    if (!watchList || !key) return;
    const buttons = watchList.querySelectorAll<HTMLButtonElement>(`.watchVisibilityBtn[data-watch-visibility-key="${key}"]`);
    for (const button of buttons) {
      const useElement = button.querySelector<SVGUseElement>("use");
      const iconId = button.dataset.iconId || "icon-visibleWatch";
      if (useElement) options.setSvgUseHref(useElement, options.svgIconHref(iconId));
      button.title = button.dataset.title || "Toggle watch visibility";
      button.setAttribute("aria-label", button.dataset.title || "Toggle watch visibility");
    }
    requestDrawAll();
  }

  function toggleWatchVisibilityForWatch(watch: WatchEntry) {
    watchVisibility.toggleWatchVisibilityForWatch(watch);
  }

  function fmtPose(pose: Pose | null) {
    if (!pose) return "—";
    const x = options.formatNumberString(pose.x, 1, "0");
    const y = options.formatNumberString(pose.y, 1, "0");
    const theta = options.formatNumberString(pose.theta, 1, "0");
    return `X: ${x} Y: ${y} θ: ${theta}°`;
  }

  function hideWatchPopup() {
    if (!watchPopup) return;
    watchPopup.hidden = true;
    watchPopupOpen = false;
  }

  function showWatchPopup(marker: WatchMarker, clickPos: { x: number; y: number } | null = null) {
    if (!watchPopup || !marker) return;
    if (!options.isInsideField(clickPos) && !options.isInsideTimeline(clickPos)) return;

    const watch = marker.watch || {};
    const pose = marker.pose || options.interpolatePoseAtTime(marker.t);
    const poseStr = fmtPose(pose);
    const tStr = marker.t != null ? `${options.fmtNum(marker.t / 1000)}s` : "—";
    const labelStr = watch.label || "—";
    const valStr = watch.value == null ? "—" : String(watch.value);

    watchPopup.innerHTML = `
      <div class="row"><div class="k">Time</div><div class="v">${options.escapeHtml(tStr)}</div></div>
      <div class="row"><div class="k">Pose</div><div class="v">${options.escapeHtml(poseStr)}</div></div>
      <div class="row"><div class="k">Name</div><div class="v">${options.escapeHtml(String(labelStr))}</div></div>
      <div class="row"><div class="k">Value</div><div class="v">${options.escapeHtml(valStr)}</div></div>
    `;

    const x = clickPos && Number.isFinite(clickPos.x) ? clickPos.x : lastMouseClient.x;
    const y = clickPos && Number.isFinite(clickPos.y) ? clickPos.y : lastMouseClient.y;

    watchPopup.hidden = false;
    watchPopupOpen = true;

    requestAnimationFrame(() => {
      const rect = watchPopup.getBoundingClientRect();
      let left = x - rect.width * 0.5;
      let top = y - rect.height - 10;

      left = options.clamp(left, 8, window.innerWidth - rect.width - 8);
      if (top < 8) top = options.clamp(y + 10, 8, window.innerHeight - rect.height - 8);

      watchPopup.style.left = `${left}px`;
      watchPopup.style.top = `${top}px`;
    });
  }

  function clearWaypointSelection() {
    selection.selectedWaypointId = null;
    selection.selectedWaypointEventTime = null;
    waypointListRenderer.highlight(null, null, false);
  }

  function waypointPoseIndexForSelection(waypoint: Waypoint, eventTime: number | null = null) {
    const poses = options.getPoses();
    if (!waypoint || !poses.length) return null;
    const startT = waypoint.createdTime;
    const endT = waypoint.terminalEvent?.t ?? Infinity;
    if (typeof startT !== "number") return null;

    let bestIdx: number | null = null;
    let bestDiff = Infinity;
    const targetTime = typeof eventTime === "number" ? eventTime : (waypoint.latestActiveEvent?.t ?? waypoint.createdTime);

    for (let index = 0; index < poses.length; index += 1) {
      const t = poses[index]?.t;
      if (typeof t !== "number") continue;
      if (t < startT || t > endT) continue;
      const diff = Math.abs(t - targetTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = index;
      }
    }

    return bestIdx;
  }

  function jumpToEventTime(
    timeMs: number,
    {
      exactStatus,
      interpolatedStatus,
      noPoseStatus,
      clearWatchSelection = false,
    }: {
      exactStatus?: (near: { idx: number; dt: number }) => void;
      interpolatedStatus?: () => void;
      noPoseStatus?: () => void;
      clearWatchSelection?: boolean;
    } = {},
  ) {
    selection.clearTrackHover(true);
    selection.clearTrackLock();

    if (options.isLiveConnected() && options.isLivestreaming()) options.setLiveAutoFollowHead(false);

    const poses = options.getPoses();
    if (!poses.length) {
      selection.selectedIndex = 0;
      lastPoseIndex = 0;
      playback.pause();
      selection.hoverTimelineTime = null;
      selection.timelineHoverSaved = null;

      if (clearWatchSelection) {
        selection.selectedWatch = null;
        watchListRenderer.highlight(null, false);
        hideWatchPopup();
      }

      noPoseStatus?.();
      poseListRenderer.highlight();
      updatePoseReadout();
      requestDrawAll();
      return;
    }

    const near = options.nearestIndexWithinTol(timeMs, WATCH_TOL_MS);
    if (near) {
      selection.selectedIndex = near.idx;
      exactStatus?.(near);
    } else {
      selection.selectedIndex = options.findFloorIndexByTime(timeMs);
      interpolatedStatus?.();
    }
    lastPoseIndex = selection.selectedIndex;

    playback.pause();
    selection.hoverTimelineTime = null;
    selection.timelineHoverSaved = null;

    if (clearWatchSelection) {
      selection.selectedWatch = null;
      watchListRenderer.highlight(null, false);
      hideWatchPopup();
    }

    poseListRenderer.highlight();
    updatePoseReadout();
    requestDrawAll();
  }

  function selectWaypointEvent(waypoint: Waypoint, event: WaypointEvent | null = null, fromUserClick = false) {
    if (!waypoint) return;
    selection.selectedWaypointId = waypoint.id;
    selection.selectedWaypointEventTime = event?.t ?? waypoint.latestActiveEvent?.t ?? waypoint.createdTime ?? null;
    selection.selectedWatch = null;
    selection.selectedLogTime = null;
    watchListRenderer.highlight(null, false);
    logListRenderer.highlight(null, false);
    hideWatchPopup();

    if (options.isLiveConnected() && options.isLivestreaming()) {
      requestDrawAll();
      setStatus(`Waypoint: ${waypoint.name || waypoint.id} selected.`);
      waypointListRenderer.highlight(waypoint.id, selection.selectedWaypointEventTime, fromUserClick);
      return;
    }

    const poseIdx = waypointPoseIndexForSelection(waypoint, selection.selectedWaypointEventTime);
    if (poseIdx != null) {
      selection.clearTrackHover(true);
      selection.clearTrackLock();
      playback.pause();
      selection.hoverTimelineTime = null;
      selection.timelineHoverSaved = null;
      selection.selectedIndex = poseIdx;
      lastPoseIndex = selection.selectedIndex;
      poseListRenderer.highlight();
      updatePoseReadout();
      requestDrawAll();
      setStatus(`Waypoint: ${waypoint.name || waypoint.id} mapped to pose @${options.getPoses()[poseIdx].t}ms.`);
    } else {
      setStatus(`Waypoint: ${waypoint.name || waypoint.id} has no poses while active.`);
      requestDrawAll();
    }

    waypointListRenderer.highlight(waypoint.id, selection.selectedWaypointEventTime, fromUserClick);
  }

  function selectWatchMarker(marker: WatchMarker, fromUserClick = false, clickPos: { x: number; y: number } | null = null) {
    selection.selectedWatch = { marker };
    selection.selectedLogTime = null;
    selection.selectedWaypointId = null;
    selection.selectedWaypointEventTime = null;
    const timeStr = marker.t != null ? `${options.fmtNum(marker.t / 1000)}s` : "—";

    jumpToEventTime(marker.t, {
      exactStatus: (near) => setStatus(`Watch @${timeStr} mapped to pose `
        + `@${options.getPoses()[near.idx].t != null ? `${options.fmtNum(options.getPoses()[near.idx].t / 1000)}s` : "—"} (Δ=${options.fmtNum(near.dt / 1000, 2)}s).`),
      interpolatedStatus: () => setStatus(`Watch @${timeStr} shown via interpolation (no pose within ±${WATCH_TOL_MS}ms).`),
      noPoseStatus: () => setStatus(`Watch @${timeStr} selected (no poses loaded).`),
    });

    watchListRenderer.highlight(marker.t, fromUserClick);
    logListRenderer.highlight(null, false);
    waypointListRenderer.highlight(null, null, false);

    if (fromUserClick) showWatchPopup(marker, clickPos);
    else hideWatchPopup();
  }

  function currentDisplayPose() {
    if (playback.isPlaying()) return playback.getPlayPose() || options.interpolatePoseAtTime(playback.getPlayTimeMs());
    if (!playback.isPlaying() && selection.hoverTimelineTime != null) return options.interpolatePoseAtTime(selection.hoverTimelineTime);
    if (!playback.isPlaying() && selection.trackHover?.pose) return selection.trackHover.pose as Pose;
    if (!playback.isPlaying() && selection.trackLockActive && selection.trackLockPose) return selection.trackLockPose;
    const poses = Array.from(options.getPoses()).map(options.poseToInches);
    return poses[selection.selectedIndex] || null;
  }

  function updateDeltaReadout() {
    const poses = options.getPoses();
    if (!options.getData() || !poses.length) return;
    const lockedTime = poses[selection.selectedIndex]?.t || 0;
    const hoveredTime = selection.hoverTimelineTime !== null ? selection.hoverTimelineTime : lockedTime;
    const delta = Math.abs(hoveredTime - lockedTime) / 1000;
    if (deltaPill) deltaPill.textContent = `Δ: ${options.formatFixedNumberString(delta, 2, "0.00")}s`;
  }

  function updatePoseReadout() {
    const poses = options.getPoses();
    if (!options.getData() || !poses.length) {
      if (timePill) timePill.textContent = "Time: —";
      if (pointPill) pointPill.textContent = "Point: —/—";
      if (posePill) posePill.textContent = "X: —  Y: — θ: —  Speed: —";
      floatingInfo.refreshPinnedPanels();
      return;
    }
    if (selection.selectedIndex < 0) selection.selectedIndex = 0;
    if (selection.selectedIndex >= poses.length) selection.selectedIndex = Math.max(0, poses.length - 1);

    let idx = selection.selectedIndex;
    let t = poses[idx]?.t ?? null;
    let pose: Pose | null = null;
    if (playback.isPlaying()) {
      t = playback.getPlayTimeMs();
      idx = options.findFloorIndexByTime(playback.getPlayTimeMs());
      pose = options.interpolatePoseAtTime(playback.getPlayTimeMs());
    } else if (selection.hoverTimelineTime != null) {
      t = selection.hoverTimelineTime;
      idx = options.findFloorIndexByTime(selection.hoverTimelineTime);
      pose = options.interpolatePoseAtTime(selection.hoverTimelineTime);
    } else if (!playback.isPlaying() && selection.trackHover?.pose) {
      const hoverTime = selection.trackHover.pose.t ?? null;
      if (hoverTime != null) {
        t = hoverTime;
        idx = options.findFloorIndexByTime(hoverTime);
        pose = options.interpolatePoseAtTime(hoverTime);
      } else {
        pose = selection.trackHover.pose as Pose;
        idx = selection.trackHover.idxNearest ?? selection.selectedIndex;
        t = poses[idx]?.t ?? null;
      }
    } else if (!playback.isPlaying() && selection.trackLockActive && selection.trackLockPose) {
      pose = selection.trackLockPose;
      idx = selection.trackLockIndex ?? selection.selectedIndex;
      t = poses[idx]?.t ?? null;
    } else {
      pose = options.poseToInches(poses[idx]);
    }

    if (timePill) timePill.textContent = t == null ? "Time: —" : `Time: ${options.formatFixedNumberString((t ?? 0) / 1000, 2)}s`;
    if (pointPill) pointPill.textContent = `Point: ${Math.max(1, idx + 1)}/${poses.length}`;

    const speedNorm = pose?.speed_norm != null ? pose.speed_norm : (poses[idx]?.speed_norm ?? null);
    const speedDisplay = options.speedFromNorm(speedNorm);
    if (posePill) {
      posePill.textContent = pose
        ? `X: ${formatDistanceFromInches(pose.x, 1)}  Y: ${formatDistanceFromInches(pose.y, 1)}  θ: ${options.fmtNum(pose.theta, 1)}°  Speed: ${speedDisplay == null ? "—" : options.fmtNum(speedDisplay, 2)}`
        : "X: —  Y: —  θ: —  Speed: —";
    }
    updateDeltaReadout();
    floatingInfo.updateInfo(pose, idx);
    watchGraph.refreshPanelData();
    floatingInfo.refreshPinnedPanels();
  }

  function setCursorPills(text: string) {
    if (cursorPill) cursorPill.textContent = text;
    if (planCursorPill) planCursorPill.textContent = text;
  }

  function updateCursorPillsFromClient(clientX: number, clientY: number) {
    if (!cursorPill && !planCursorPill) return;
    const rect = options.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const world = options.screenToWorld(mx, my);
    setCursorPills(`Cursor: X ${formatDistanceFromInches(world.x, 2)} Y ${formatDistanceFromInches(world.y, 2)}`);
  }

  const fieldOverlay = createViewingFieldOverlayRenderer({
    context: options.ctx,
    getWatchMarkers: options.getWatchMarkers,
    getWaypoints: options.getWaypoints,
    getSelectedWatch: () => selection.selectedWatch,
    getSelectedWaypointId: () => selection.selectedWaypointId,
    getHoverWatch: () => fieldInteraction.getHoverWatch(),
    isWatchMarkerVisible: (marker) => watchVisibility.isMarkerVisible(marker),
    waypointFilterMatches,
    levelFillWithAlpha: options.levelFillWithAlpha,
    scaledViewingFieldRadius,
    viewingFieldMarkerStyleScale,
  });

  const watchGraph = createWatchGraph({
    selection,
    panel: byId("watchGraphPanel"),
    header: byId("watchGraphHeader"),
    resizer: byId("watchGraphResizer"),
    closeButton: byId("btnCloseWatchGraph"),
    subtitle: byId("watchGraphSubtitle"),
    title: byId("watchGraphTitle"),
    compareSelect: byId("watchGraphCompareSelect"),
    latest: byId("watchGraphLatest"),
    compareLatest: byId("watchGraphCompareLatest"),
    count: byId("watchGraphCount"),
    avg: byId("watchGraphAvg"),
    min: byId("watchGraphMin"),
    max: byId("watchGraphMax"),
    compareCount: byId("watchGraphCompareCount"),
    compareAvg: byId("watchGraphCompareAvg"),
    compareMin: byId("watchGraphCompareMin"),
    compareMax: byId("watchGraphCompareMax"),
    canvas: byId("watchGraphCanvas"),
    empty: byId("watchGraphEmpty"),
    getData: options.getData,
    getWatches: options.getWatches,
    getWatchMarkers: options.getWatchMarkers,
    getWatchMarkersByTime: () => watchMarkersByTime,
    getReferenceTimeMs: () => selection.currentReferenceTime(options.getPoses(), playback.getPlayTimeMs(), playback.isPlaying()),
    getCurrentPoseTimeMs: () => currentDisplayPose()?.t ?? null,
    getLatestRobotTimeMs: () => options.getPoses()[options.getPoses().length - 1]?.t ?? null,
    isPlaying: () => playback.isPlaying(),
    isLivestreaming: options.isLivestreaming,
    lastWatchAtTime: options.lastWatchAtTime,
    formatNumber: options.formatNumberString,
    clamp: options.clamp,
    selectWatchMarker,
    updatePoseReadout,
  });

  const viewingLists = createViewingLists({
    elements: {
      watchList,
      watchFilter,
      watchSort,
      watchCount,
      poseList,
      poseCount,
      waypointList,
      waypointCount,
      waypointFilter,
      logList,
      logCount,
      logSort,
    },
    getWatchMarkers: options.getWatchMarkers,
    getWatches: options.getWatches,
    getLogs: options.getLogs,
    getWaypoints: options.getWaypoints,
    getVisibleWaypointEvents: waypointVisibleEvents,
    getSelectedWatch: () => selection.selectedWatch,
    getSelectedPoseIndex: () => selection.selectedIndex,
    getPoseCount: () => options.getPoses().length,
    getPose: (index) => options.getPoses()[index],
    getSelectedWaypointId: () => selection.selectedWaypointId,
    getSelectedWaypointEventTime: () => selection.selectedWaypointEventTime,
    getSelectedLogTime: () => selection.selectedLogTime,
    setSelectedLogTime: (time) => { selection.selectedLogTime = time; },
    clearWaypointSelectionState: () => {
      selection.selectedWaypointId = null;
      selection.selectedWaypointEventTime = null;
    },
    onPoseSelected: (index) => {
      playback.pause();
      selection.clearTrackHover(true);
      selection.clearTrackLock();
      selection.clearSelectedDetail();
      viewingLists.highlightWaypoint(null, null, false);
      selection.selectedIndex = index;
      if (options.isLiveConnected() && options.isLivestreaming()) options.setLiveAutoFollowHead(false);
      lastPoseIndex = selection.selectedIndex;
      setStatus(`Jumped to pose #${index + 1}.`);
      viewingLists.highlightPose();
      updatePoseReadout();
      requestDrawAll();
    },
    onWaypointEventSelected: (waypoint, event) => selectWaypointEvent(waypoint, event, true),
    selectWatchMarker,
    toggleFloatingWatch: (watchId) => floatingInfo.toggleWatch(watchId as string | number | null),
    toggleWatchVisibilityForWatch,
    openOrToggleWatchGraphPanel: (marker) => watchGraph.openOrTogglePanel(marker),
    refreshWatchGraphPanelData: () => watchGraph.refreshPanelData(),
    jumpToEventTime,
    getRawPoseTime: (index) => options.getPoses()[index]?.t,
    poseToInches: options.poseToInches,
    formatNumberString: options.formatNumberString,
    fmtNum: options.fmtNum,
    escapeHtml: options.escapeHtml,
    levelStyle: options.levelStyle as any,
    levelSortRank: options.levelSortRank,
    watchSortValueKey,
    watchFilterKeyForWatch: (watch) => watchVisibility.filterKeyForWatch(watch),
    watchFilterMatches: (watch) => watchVisibility.filterMatches(watch),
    watchFilterLabelForWatch: (watch) => watchVisibility.filterLabelForWatch(watch),
    watchVisibilityKeyForWatch: (watch) => watchVisibility.keyForWatch(watch),
    watchVisibilityIconId: (watch) => watchVisibility.iconId(watch),
    watchVisibilityTitle: (watch) => watchVisibility.title(watch),
    isGraphableWatchValue: (value) => watchGraph.isGraphableValue(value),
    svgIconHref: options.svgIconHref,
    setSvgUseHref: options.setSvgUseHref,
    waypointTypeStyle,
    waypointEventLines,
    fmtSecondsToString: (ms) => fmtSecondsToString(ms, options.formatNumberString),
    scrollIntoViewIfNeeded,
    watchToleranceMs: WATCH_TOL_MS,
  });

  const { watchListRenderer, poseListRenderer, waypointListRenderer, logListRenderer } = viewingLists.renderers;

  const rendering = createViewingRendering({
    watchListRenderer,
    logListRenderer,
    waypointListRenderer,
    poseListRenderer,
    updatePoseReadout,
  });

  const playback = createViewingPlayback({
    selection,
    getPoses: options.getPoses,
    getPlayRate: options.getPlayRate,
    isLivestreaming: options.isLivestreaming,
    setPlayButtonLabel: options.setPlayButtonLabel,
    formatTimeSeconds: (ms) => options.formatNumberString((ms ?? 0) / 1000, 1, "0"),
    interpolatePoseAtTime: (timeMs) => options.interpolatePoseAtTime(timeMs),
    findFloorIndexByTime: (timeMs) => options.findFloorIndexByTime(timeMs),
    lastWatchAtTime: (timeMs) => options.lastWatchAtTime(watchMarkersByTime, timeMs),
    highlightWatch: (timeMs, doScroll) => watchListRenderer.highlight(timeMs, doScroll),
    updatePoseReadout,
  });

  const input = createViewingInput({
    hasData: () => !!options.getData(),
    isLiveConnected: options.isLiveConnected,
    getLiveAutoFollowHead: options.getLiveAutoFollowHead,
    setLiveAutoFollowHead: options.setLiveAutoFollowHead,
    getSelectedIndex: () => selection.selectedIndex,
    getPoseCount: () => options.getPoses().length,
    setSelectedIndex: (index) => {
      selection.selectedIndex = options.clamp(index, 0, Math.max(0, options.getPoses().length - 1));
    },
    setLastPoseIndex: (index) => { lastPoseIndex = index; },
    clearTransientSelection: () => {
      selection.clearSelectedDetail();
      selection.clearTimelineHover(false);
      selection.clearTrackHover(false);
      selection.clearTrackLock();
      waypointListRenderer.highlight(null, null, false);
    },
    clearTrackHover: () => selection.clearTrackHover(true),
    clearTrackLock: () => selection.clearTrackLock(),
    isPlaying: () => playback.isPlaying(),
    play: playback.play,
    pause: playback.pause,
    highlightPoseList: () => poseListRenderer.highlight(),
    updatePoseReadout,
  });

  const timeline = createViewingTimeline({
    canvas: options.timelineCanvas,
    context: options.timelineContext,
    timelineBar: options.timelineBar,
    selection,
    hasData: () => !!options.getData(),
    getPoses: options.getPoses,
    getWatchMarkers: options.getWatchMarkers,
    isPlaying: () => playback.isPlaying(),
    getPlayTimeMs: () => playback.getPlayTimeMs(),
    isLivestreaming: options.isLivestreaming,
    findFloorIndexByTime: (timeMs) => options.findFloorIndexByTime(timeMs),
    isWatchMarkerVisible: (marker) => watchVisibility.isMarkerVisible(marker),
    selectWatchMarker,
    clearTrackHover: (restore) => selection.clearTrackHover(restore),
    clearTrackLock: () => selection.clearTrackLock(),
    clearWaypointHighlight: () => waypointListRenderer.highlight(null, null, false),
    setLastPoseIndex: (index) => { lastPoseIndex = index; },
    highlightPoseList: () => poseListRenderer.highlight(),
    updatePoseReadout,
    clamp: options.clamp,
    heatColorFromNorm: options.heatColorFromNorm,
    levelFillWithAlpha: options.levelFillWithAlpha,
  });

  const fieldInteraction = createViewingFieldInteraction({
    canvas: options.canvas,
    selection,
    getData: options.getData,
    isPlaying: () => playback.isPlaying(),
    isPanning: options.isFieldPanning,
    isLivestreaming: options.isLivestreaming,
    getPoses: options.getPoses,
    getWatchMarkers: options.getWatchMarkers,
    getWaypoints: options.getWaypoints,
    poseToInches: options.poseToInches,
    angLerpDeg: options.angLerpDeg,
    trackHoverTolerancePx: HOVER_PIXEL_TOL + TRACK_HOVER_PAD_PX,
    scaledViewingFieldRadius,
    isWatchMarkerVisible: (marker) => watchVisibility.isMarkerVisible(marker),
    waypointFilterMatches,
    updateCursorPillsFromClient,
    setCursorPills,
    handlePlanningMouseMove: options.handlePlanningMouseMove,
    handlePlanningMouseLeave: options.handlePlanningMouseLeave,
    selectWatchMarker,
    selectWaypointEvent,
    clearWaypointSelection,
    renderWaypointList: () => rendering.renderWaypointList(),
    clearWaypointHighlight: () => waypointListRenderer.highlight(null, null, false),
    pausePlayback: () => playback.pause(),
    setLastPoseIndex: (index) => { lastPoseIndex = index; },
    highlightPoseList: () => poseListRenderer.highlight(),
    updatePoseReadout,
    getSuppressNextClick: options.getSuppressNextClick,
    consumeSuppressNextClick: options.consumeSuppressNextClick,
  });

  const floatingInfo = createFloatingInfo({
    floatWindow: byId("floatingInfo"),
    toggleButton: byId("btnToggleFloat"),
    closeButton: byId("btnCloseFloat"),
    header: byId("floatHeader"),
    resizer: byId("floatResizer"),
    pinnedHost: byId("pinnedWatchHost"),
    pinnedTemplate: byId("pinnedWatchTemplate"),
    bounds: floatingWindowBounds,
    getWatches: options.getWatches,
    getReferenceTimeMs: () => selection.currentReferenceTime(options.getPoses(), playback.getPlayTimeMs(), playback.isPlaying()),
    getLockedTimeMs: () => options.getPoses()[selection.selectedIndex]?.t ?? null,
    getHoverTimeMs: () => selection.hoverTimelineTime,
    hasData: () => !!options.getData(),
    hasPoses: () => options.getPoses().length > 0,
    isWatchMarkerVisibleForClosestWatch: () => true,
    speedFromNorm: options.speedFromNorm,
    normFromSpeedRaw: options.normFromSpeedRaw,
    formatNumber: options.formatNumberString,
    setPlayTimeMs: (timeMs) => playback.setPlayTimeMs(timeMs),
    pausePlayback: () => playback.pause(),
    setSelectedIndex: (index) => { selection.selectedIndex = index; },
    findFloorIndexByTime: (timeMs) => options.findFloorIndexByTime(timeMs),
    updatePoseReadout,
    levelStyle: options.levelStyle as any,
    normalizeLogLevel: options.normalizeLogLevel,
    onToggle: options.onFloatingInfoToggled,
  });

  function waypointByIdLike(id: unknown) {
    if (id == null) return null;
    return options.getWaypointMap().get(Number(id))
      || options.getWaypoints().find((waypoint) => String(waypoint?.id) === String(id))
      || null;
  }

  function selectedWaypointForOverlay() {
    if (getMode() !== "viewing") return null;
    const filter = waypointFilterValue();
    const overlayWaypointId = filter !== "all" && filter !== "active"
      ? filter
      : selection.selectedWaypointId;
    if (overlayWaypointId == null) return null;
    const waypoint = waypointByIdLike(overlayWaypointId);
    return waypoint && waypointFilterMatches(waypoint) ? waypoint : null;
  }

  function normalizeSignedDeg(deg: unknown) {
    if (typeof deg !== "number" || !Number.isFinite(deg)) return null;
    return ((deg + 180) % 360 + 360) % 360 - 180;
  }

  function formatUnitsParts(inches: number, decimals = 1) {
    if (typeof inches !== "number" || !Number.isFinite(inches)) return [{ text: "—", kind: "value" }];
    return [
      { text: formatDistanceFromInches(inches, decimals), kind: "value" },
      { text: getCurrentUnits(), kind: "unit" },
    ];
  }

  function formatThetaParts(thetaDelta: number | null) {
    if (thetaDelta == null) return [{ text: "θ: —", kind: "unit" }];
    return [
      { text: options.fmtNum(thetaDelta, 1), kind: "value" },
      { text: "°", kind: "unit" },
    ];
  }

  function waypointOffsetUiScale() {
    return options.clamp(options.getFieldViewZoom(), 0.25, 1);
  }

  function viewingFieldMarkerScale() {
    return Math.max(options.getFieldViewZoom(), CANVAS_ZOOM_MIN);
  }

  function viewingFieldMarkerStyleScale() {
    return options.clamp(options.getFieldViewZoom(), CANVAS_ZOOM_MIN, 1.75);
  }

  function scaledViewingFieldDiameter(baseDiameterPx: number, maxDiameterPx = Infinity) {
    return Math.min(baseDiameterPx * viewingFieldMarkerScale(), maxDiameterPx);
  }

  function scaledViewingFieldRadius(baseDiameterPx: number, maxDiameterPx = Infinity) {
    return scaledViewingFieldDiameter(baseDiameterPx, maxDiameterPx) / 2;
  }

  function drawOffsetPill(
    x: number,
    y: number,
    parts: Array<{ text: string; kind: string }>,
    pillOptions: Record<string, any> = {},
  ) {
    if (!parts?.length) return;
    const uiScale = pillOptions.uiScale ?? waypointOffsetUiScale();
    const padX = (pillOptions.padX ?? 12) * uiScale;
    const padY = (pillOptions.padY ?? 4) * uiScale;
    const radius = pillOptions.radius ?? 999;
    const bg = pillOptions.bg ?? "rgba(30, 30, 30, 0.85)";
    const border = pillOptions.border ?? "rgba(255, 255, 255, 0.15)";
    const valueColor = pillOptions.valueColor ?? "rgba(255, 255, 255, 0.96)";
    const unitColor = pillOptions.unitColor ?? "rgba(255, 255, 255, 0.62)";
    const fontSize = (pillOptions.fontSize ?? 10) * uiScale;
    const valueFont = `300 ${fontSize}px ui-monospace, "SFMono-Regular", "SF Mono", Menlo, monospace`;
    const unitFont = `200 ${fontSize}px ui-monospace, "SFMono-Regular", "SF Mono", Menlo, monospace`;

    const ctx = options.ctx;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const gap = pillOptions.gap ?? 2;
    let textWidth = 0;
    for (const part of parts) {
      ctx.font = part.kind === "unit" ? unitFont : valueFont;
      textWidth += ctx.measureText(part.text).width;
    }
    textWidth += gap * Math.max(0, parts.length - 1);
    const naturalWidth = Math.ceil(textWidth + padX * 2);
    const maxWidth = (pillOptions.maxWidth ?? WAYPOINT_OFFSET_PILL_MAX_W_PX) * uiScale;
    const width = Math.min(naturalWidth, maxWidth);
    const height = Math.ceil(fontSize + padY * 2);
    const left = x - width / 2;
    const top = y - height / 2;

    ctx.shadowColor = "rgba(0, 0, 0, 0.30)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = bg;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, radius);
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = "transparent";
    const availableTextWidth = Math.max(1, width - padX * 2);
    const textScaleX = Math.min(1, availableTextWidth / Math.max(1, textWidth));
    ctx.translate(x, y + 0.5);
    ctx.scale(textScaleX, 1);
    let cursorX = -textWidth / 2;
    ctx.textAlign = "left";
    for (const part of parts) {
      ctx.font = part.kind === "unit" ? unitFont : valueFont;
      ctx.fillStyle = part.kind === "unit" ? unitColor : valueColor;
      ctx.fillText(part.text, cursorX, 0);
      cursorX += ctx.measureText(part.text).width + gap;
    }
    ctx.restore();
  }

  function drawWaypointOffsetOverlay(pose: Pose | null) {
    const waypoint = selectedWaypointForOverlay();
    if (!waypoint || !pose) return;

    const waypointScreen = options.worldToScreen(waypoint.target.x, waypoint.target.y);
    const robotScreen = options.worldToScreen(pose.x, pose.y);
    const elbowScreen = options.worldToScreen(pose.x, waypoint.target.y);
    const dxIn = Math.abs((pose.x ?? 0) - (waypoint.target.x ?? 0));
    const dyIn = Math.abs((pose.y ?? 0) - (waypoint.target.y ?? 0));
    const distanceIn = Math.hypot(dxIn, dyIn);
    const thetaDelta = typeof waypoint.target.theta === "number" && typeof pose.theta === "number"
      ? normalizeSignedDeg(waypoint.target.theta - pose.theta)
      : null;

    const legColor = "rgba(210, 245, 255, 0.46)";
    const hypColor = "rgba(218, 250, 255, 0.96)";
    const pillBg = "rgba(30, 30, 30, 0.85)";
    const pillBorder = "rgba(255, 255, 255, 0.15)";
    const xParts = formatUnitsParts(dxIn) as Array<{ text: string; kind: string }>;
    const yParts = formatUnitsParts(dyIn) as Array<{ text: string; kind: string }>;
    const hypParts = [
      ...formatUnitsParts(distanceIn),
      { text: thetaDelta ? " | " : "", kind: "unit" },
      ...(thetaDelta ? formatThetaParts(thetaDelta) : [{ text: "", kind: "unit" }]),
    ] as Array<{ text: string; kind: string }>;
    const uiScale = waypointOffsetUiScale();
    const ctx = options.ctx;

    ctx.save();
    ctx.strokeStyle = legColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(waypointScreen.x, waypointScreen.y);
    ctx.lineTo(elbowScreen.x, elbowScreen.y);
    ctx.moveTo(elbowScreen.x, elbowScreen.y);
    ctx.lineTo(robotScreen.x, robotScreen.y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = hypColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(robotScreen.x, robotScreen.y);
    ctx.lineTo(waypointScreen.x, waypointScreen.y);
    ctx.stroke();
    ctx.restore();

    const pillOffset = 16 * uiScale;
    const xMid = {
      x: (waypointScreen.x + elbowScreen.x) / 2,
      y: (waypointScreen.y + elbowScreen.y) / 2 - Math.sign(robotScreen.y - waypointScreen.y || 1) * pillOffset,
    };
    const yMid = {
      x: (robotScreen.x + elbowScreen.x) / 2 + Math.sign(robotScreen.x - waypointScreen.x || 1) * pillOffset,
      y: (robotScreen.y + elbowScreen.y) / 2,
    };
    const hx = robotScreen.x - waypointScreen.x;
    const hy = robotScreen.y - waypointScreen.y;
    const hLen = Math.hypot(hx, hy) || 1;
    const nx = -hy / hLen;
    const ny = hx / hLen;
    const hypMidX = robotScreen.x + (waypointScreen.x - robotScreen.x) * 0.75;
    const hypMidY = robotScreen.y + (waypointScreen.y - robotScreen.y) * 0.75;
    const normalScale = 18 * uiScale;
    const c1 = { x: hypMidX + nx * normalScale, y: hypMidY + ny * normalScale };
    const c2 = { x: hypMidX - nx * normalScale, y: hypMidY - ny * normalScale };
    const d1 = Math.hypot(c1.x - elbowScreen.x, c1.y - elbowScreen.y);
    const d2 = Math.hypot(c2.x - elbowScreen.x, c2.y - elbowScreen.y);
    const hypPill = d1 >= d2 ? c1 : c2;

    drawOffsetPill(xMid.x, xMid.y, xParts, { bg: pillBg, border: pillBorder, fontSize: 9.5, padX: 10, uiScale });
    drawOffsetPill(yMid.x, yMid.y, yParts, { bg: pillBg, border: pillBorder, fontSize: 9.5, padX: 10, uiScale });
    drawOffsetPill(hypPill.x, hypPill.y, hypParts, { bg: pillBg, border: pillBorder, fontSize: 11, padX: 12, uiScale });
  }

  function canAutoSyncPoseSelection() {
    return options.getPoses().length > 0
      && selection.hoverTimelineTime == null
      && !playback.isPlaying()
      && !selection.trackLockActive
      && !(selection.trackHover && (selection.trackHover.pose || selection.trackHover.t));
  }

  function syncLivePoseSelection() {
    if (!canAutoSyncPoseSelection()) return;
    const poses = options.getPoses();
    if (!poses.length) return;
    if (options.getLiveAutoFollowHead()) {
      selection.selectedIndex = poses.length - 1;
      lastPoseIndex = selection.selectedIndex;
      updatePoseReadout();
    } else {
      selection.selectedIndex = lastPoseIndex;
    }
  }

  function updateAfterDataChange(flags: ViewingRenderFlags = {}) {
    if (flags.watchesChanged) {
      recomputeWatchMarkers();
      rendering.renderWatchFilter();
      rendering.renderWatchList();
      floatingInfo.refreshPinnedPanels();
    }
    if (flags.logsChanged) rendering.renderLogList();
    if (flags.waypointsChanged) {
      rendering.renderWaypointFilter();
      rendering.renderWaypointList();
    }
    if (flags.posesChanged) {
      rendering.renderPoseList();
      syncLivePoseSelection();
      poseListRenderer.highlight();
    }
    if (flags.filtersChanged) {
      rendering.renderWatchFilter();
      rendering.renderLists();
      rendering.renderWaypointFilter();
    }
    updatePoseReadout();
  }

  function resetForLoadedData() {
    selection.reset();
    fieldInteraction.clearHoverWatch();
    playback.pause();
    watchGraph.hidePanel();
    recomputeWatchMarkers();
    rendering.renderWatchFilter();
    rendering.renderLists();
    rendering.renderWaypointFilter();
    floatingInfo.refreshPinnedPanels();
    updatePoseReadout();
  }

  function clearTransientState() {
    playback.pause();
    selection.hoverTimelineTime = null;
    selection.trackHover = null;
    selection.trackLockActive = false;
  }

  function bindEvents() {
    if (bound) return;
    bound = true;
    watchGraph.bindEvents();
    viewingLists.bindEvents();
    timeline.bindEvents();
    fieldInteraction.bindEvents();
    window.addEventListener("mousemove", (event) => {
      lastMouseClient = { x: event.clientX, y: event.clientY };
      floatingInfo.handleWindowMouseMove(event);
      watchGraph.handleWindowMouseMove(event);
    }, { passive: true });
    window.addEventListener("mouseup", () => {
      floatingInfo.handleWindowMouseUp();
      watchGraph.handleWindowMouseUp();
    });
    document.addEventListener("mousedown", (event) => {
      if (!watchPopupOpen) return;
      if (watchPopup && watchPopup.contains(event.target as Node)) return;
      hideWatchPopup();
    }, { capture: true });
    watchSort?.addEventListener("change", () => {
      rendering.renderWatchList();
      requestDrawAll();
    });
    watchFilter?.addEventListener("change", () => {
      rendering.renderWatchList();
      requestDrawAll();
    });
    logSort?.addEventListener("change", () => {
      rendering.renderLogList();
    });
    waypointFilter?.addEventListener("change", () => {
      rendering.renderWaypointList();
      requestDrawAll();
    });
  }

  const controller: ViewingUiController = {
    selection,
    playback,
    rendering,
    input,
    timeline,
    fieldOverlay,
    fieldInteraction,
    bindEvents,
    setPlaybackRate(rate) {
      playback.setPlayRate(rate);
    },
    currentDisplayPose,
    updatePoseReadout,
    drawWaypointOffsetOverlay,
    recomputeWatchMarkers,
    updateAfterDataChange,
    resetForLoadedData,
    clearTransientState,
    syncLivePoseSelection,
    currentVisibilityForWatch: (watch) => watchVisibility.currentVisibilityForWatch(watch),
    hasSelectedWaypoint: () => selection.selectedWaypointId != null,
    clearWaypointSelection,
    toggleFloatingInfo: () => floatingInfo.toggleInfo(),
    toggleWatchGraph: () => watchGraph.toggleCurrentPanel(),
    openFloatingWatch: (watchId = null) => { floatingInfo.openWatch(watchId); },
    resizeWatchGraph: () => watchGraph.resizeChart(),
    handleWindowMouseMove(event) {
      floatingInfo.handleWindowMouseMove(event);
      watchGraph.handleWindowMouseMove(event);
    },
    handleWindowMouseUp() {
      floatingInfo.handleWindowMouseUp();
      watchGraph.handleWindowMouseUp();
    },
  };

  return controller;
}
