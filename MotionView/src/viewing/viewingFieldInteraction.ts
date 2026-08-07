import type { Pose, Waypoint } from "../state/models";
import type { ViewingSelectionController } from "./viewingSelection";
import type { WatchMarker } from "./viewingTypes";

export interface ViewingFieldInteractionController {
  bindEvents(): void;
  getHoverWatch(): WatchMarker | null;
  clearHoverWatch(): void;
  pickTrackPose(clientX: number, clientY: number): { pose: Pose; nearestIdx: number } | null;
  hitTestWatchAtClient(clientX: number, clientY: number): WatchMarker | null;
  hitTestWaypointAtClient(clientX: number, clientY: number): Waypoint | null;
}

export interface CreateViewingFieldInteractionOptions {
  canvas: HTMLCanvasElement;
  selection: ViewingSelectionController;
  getData(): unknown;
  isPlaying(): boolean;
  isPanning(): boolean;
  isLivestreaming(): boolean;
  getPoses(): readonly Pose[];
  getWatchMarkers(): readonly WatchMarker[];
  getWaypoints(): readonly Waypoint[];
  worldToScreen(x: number, y: number): { x: number; y: number };
  poseToInches(pose: Pose): Pose;
  angLerpDeg(a: number, b: number, t: number): number;
  trackHoverTolerancePx: number;
  scaledViewingFieldRadius(baseDiameterPx: number): number;
  isWatchMarkerVisible(marker: WatchMarker): boolean;
  waypointFilterMatches(waypoint: Waypoint): boolean;
  updateCursorPillsFromClient(clientX: number, clientY: number): void;
  setCursorPills(text: string): void;
  getAppMode(): string;
  handlePlanningMouseMove(event: MouseEvent): void;
  handlePlanningMouseLeave(): void;
  selectWatchMarker(marker: WatchMarker, fromUserClick: boolean, position?: { x: number; y: number }): void;
  selectWaypointEvent(waypoint: Waypoint, event: unknown, fromUserClick: boolean): void;
  clearWaypointSelection(): void;
  renderWaypointList(): void;
  clearWaypointHighlight(): void;
  pausePlayback(): void;
  setLastPoseIndex(index: number): void;
  highlightPoseList(): void;
  updatePoseReadout(): void;
  requestDrawAll(): void;
  setStatus(message: string): void;
  getSuppressNextClick(): boolean;
  consumeSuppressNextClick(): void;
}

export function createViewingFieldInteraction(options: CreateViewingFieldInteractionOptions): ViewingFieldInteractionController {
  let hoverWatch: WatchMarker | null = null;

  const pickTrackPose = (clientX: number, clientY: number) => {
    const rawPoses = options.getPoses();
    if (!rawPoses.length) return null;
    const rect = options.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    const poses = rawPoses.map((pose) => options.poseToInches(pose));
    if (poses.length < 2) return null;

    let best = { dist2: Infinity, i: -1, alpha: 0 };
    for (let i = 0; i < poses.length - 1; i += 1) {
      const a = poses[i];
      const b = poses[i + 1];
      const pa = options.worldToScreen(a.x, a.y);
      const pb = options.worldToScreen(b.x, b.y);

      const vx = pb.x - pa.x;
      const vy = pb.y - pa.y;
      const wx = mx - pa.x;
      const wy = my - pa.y;
      const vv = vx * vx + vy * vy || 1;
      let alpha = (wx * vx + wy * vy) / vv;
      alpha = Math.max(0, Math.min(alpha, 1));

      const px = pa.x + alpha * vx;
      const py = pa.y + alpha * vy;
      const dx = mx - px;
      const dy = my - py;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < best.dist2) best = { dist2, i, alpha };
    }

    const dist = Math.sqrt(best.dist2);
    if (dist > options.trackHoverTolerancePx) return null;

    const i0 = best.i;
    const i1 = best.i + 1;
    const p0 = poses[i0];
    const p1 = poses[i1];
    const a = best.alpha;
    const rt0 = rawPoses[i0]?.t ?? 0;
    const rt1 = rawPoses[i1]?.t ?? rt0;
    const tMs = rt0 + a * (rt1 - rt0);

    const pose = {
      t: tMs,
      x: p0.x + (p1.x - p0.x) * a,
      y: p0.y + (p1.y - p0.y) * a,
      theta: options.angLerpDeg(p0.theta ?? 0, p1.theta ?? 0, a),
      l_vel: (p0.l_vel ?? 0) + ((p1.l_vel ?? 0) - (p0.l_vel ?? 0)) * a,
      r_vel: (p0.r_vel ?? 0) + ((p1.r_vel ?? 0) - (p0.r_vel ?? 0)) * a,
      speed_raw: (p0.speed_raw ?? 0) + ((p1.speed_raw ?? 0) - (p0.speed_raw ?? 0)) * a,
      speed_norm: (p0.speed_norm ?? 0) + ((p1.speed_norm ?? 0) - (p0.speed_norm ?? 0)) * a,
    };

    return { pose, nearestIdx: a < 0.5 ? i0 : i1 };
  };

  const hitTestWatchAtClient = (clientX: number, clientY: number) => {
    const watchMarkers = options.getWatchMarkers();
    if (!watchMarkers.length) return null;
    const rect = options.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: WatchMarker | null = null;
    let bestD2 = Infinity;
    for (const marker of watchMarkers) {
      if (!options.isWatchMarkerVisible(marker)) continue;
      if (!marker.pose) continue;
      const p = options.worldToScreen(marker.pose.x, marker.pose.y);
      const baseDiameter = hoverWatch === marker ? 11.2 : 8.4;
      const tol = Math.max(8, options.scaledViewingFieldRadius(baseDiameter) + 5);
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= tol * tol && d2 <= bestD2) {
        bestD2 = d2;
        best = marker;
      }
    }
    return best;
  };

  const hitTestWaypointAtClient = (clientX: number, clientY: number) => {
    const waypoints = options.getWaypoints();
    if (!waypoints.length) return null;
    const rect = options.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: Waypoint | null = null;
    let bestD2 = Infinity;

    for (const waypoint of waypoints) {
      if (!options.waypointFilterMatches(waypoint)) continue;
      const p = options.worldToScreen(waypoint.target.x, waypoint.target.y);
      const isSelected = options.selection.selectedWaypointId === waypoint.id;
      const baseDiameter = isSelected ? 15 : 12;
      const tol = Math.max(9, options.scaledViewingFieldRadius(baseDiameter) + 6);
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= tol * tol && d2 <= bestD2) {
        bestD2 = d2;
        best = waypoint;
      }
    }
    return best;
  };

  const bindEvents = () => {
    options.canvas.addEventListener("mousemove", (event) => {
      options.updateCursorPillsFromClient(event.clientX, event.clientY);
    });

    options.canvas.addEventListener("mousemove", (event) => {
      if (options.getAppMode() === "planning") {
        options.handlePlanningMouseMove(event);
        return;
      }
      if (!options.getData() || options.isPlaying() || options.isPanning()) return;

      const watchHit = hitTestWatchAtClient(event.clientX, event.clientY);
      if (watchHit) {
        hoverWatch = watchHit;
        options.canvas.style.cursor = "pointer";
        options.requestDrawAll();
        return;
      }
      if (hoverWatch) {
        hoverWatch = null;
        options.requestDrawAll();
      }
      options.canvas.style.cursor = "";

      const waypointHit = hitTestWaypointAtClient(event.clientX, event.clientY);
      if (waypointHit) {
        options.canvas.style.cursor = "pointer";
        return;
      }

      const hit = pickTrackPose(event.clientX, event.clientY);
      if (!hit) {
        options.selection.hoverTimelineTime = null;
        if (options.selection.trackHover) {
          options.selection.clearTrackHover(!options.selection.trackLockActive);
          options.highlightPoseList();
          options.updatePoseReadout();
          options.requestDrawAll();
        }
        return;
      }

      if (options.selection.trackHoverSavedIndex == null) {
        options.selection.trackHoverSavedIndex = options.selection.selectedIndex;
      }
      options.selection.trackHover = { pose: hit.pose, t: hit.pose.t, idxNearest: hit.nearestIdx };
      options.selection.hoverTimelineTime = hit.pose.t ?? null;

      options.updatePoseReadout();
      options.requestDrawAll();
    });

    options.canvas.addEventListener("mouseleave", () => {
      options.setCursorPills("Cursor: —");
      if (options.getAppMode() === "planning") {
        options.handlePlanningMouseLeave();
        return;
      }
      hoverWatch = null;
      options.selection.hoverTimelineTime = null;
      options.selection.timelineHoverSaved = null;
      options.canvas.style.cursor = "";
      if (options.selection.trackHover) {
        options.selection.clearTrackHover(!options.selection.trackLockActive);
        options.highlightPoseList();
        options.updatePoseReadout();
        options.requestDrawAll();
      }
    });

    options.canvas.addEventListener("click", (event) => {
      if (options.getAppMode() === "planning") return;
      if (!options.getData()) return;
      if (options.getSuppressNextClick()) {
        options.consumeSuppressNextClick();
        return;
      }

      const liveStreaming = options.isLivestreaming();
      if (!liveStreaming) {
        const watchHit = hitTestWatchAtClient(event.clientX, event.clientY);
        if (watchHit) {
          options.selectWatchMarker(watchHit, true, { x: event.clientX, y: event.clientY });
          return;
        }
      }

      const waypointHit = hitTestWaypointAtClient(event.clientX, event.clientY);
      if (waypointHit) {
        if (options.selection.selectedWaypointId === waypointHit.id) {
          options.clearWaypointSelection();
          options.requestDrawAll();
          return;
        }
        options.renderWaypointList();
        options.selectWaypointEvent(waypointHit, waypointHit.latestActiveEvent, true);
        return;
      }

      if (options.isPlaying() || liveStreaming) return;

      const hit = pickTrackPose(event.clientX, event.clientY);
      if (hit) {
        options.pausePlayback();
        options.selection.clearSelectedDetail();
        options.clearWaypointHighlight();
        options.selection.lockTrackPose(hit.pose, hit.nearestIdx);
        options.setLastPoseIndex(options.selection.selectedIndex);
        options.selection.clearTrackHover(false);
        options.selection.trackHoverSavedIndex = null;
        options.selection.saveTimelineHoverIfNeeded();

        options.highlightPoseList();
        options.updatePoseReadout();
        options.requestDrawAll();
        return;
      }

      if (options.selection.trackLockActive) {
        options.selection.clearTrackLock();
        options.clearWaypointSelection();
        options.setStatus("Unlocked track lock.");
        options.updatePoseReadout();
        options.requestDrawAll();
      } else if (options.selection.selectedWaypointId != null) {
        options.clearWaypointSelection();
        options.requestDrawAll();
      }
    });
  };

  return {
    bindEvents,
    getHoverWatch: () => hoverWatch,
    clearHoverWatch() {
      hoverWatch = null;
    },
    pickTrackPose,
    hitTestWatchAtClient,
    hitTestWaypointAtClient,
  };
}
