import { requestDrawAll } from "../render/renderScheduler";
import type { Pose } from "../state/models";
import type { ViewingSelectionController } from "./viewingSelection";
import type { WatchMarker } from "./viewingTypes";

export interface ViewingTimelineController {
  bindEvents(): void;
  draw(): void;
  timeToX(timeMs: number): number;
  xToTime(x: number): number;
  pickWatchDot(x: number, y: number): WatchMarker | null;
}

export interface CreateViewingTimelineOptions {
  canvas: HTMLCanvasElement | null;
  context: CanvasRenderingContext2D | null;
  timelineBar: HTMLElement | null;
  selection: ViewingSelectionController;
  hasData(): boolean;
  getPoses(): readonly Pose[];
  getWatchMarkers(): readonly WatchMarker[];
  isPlaying(): boolean;
  getPlayTimeMs(): number | null;
  isLivestreaming(): boolean;
  findFloorIndexByTime(timeMs: number): number;
  isWatchMarkerVisible(marker: WatchMarker): boolean;
  selectWatchMarker(marker: WatchMarker, fromUserClick: boolean, position?: { x: number; y: number }): void;
  clearTrackHover(restore: boolean): void;
  clearTrackLock(): void;
  clearWaypointHighlight(): void;
  setLastPoseIndex(index: number): void;
  highlightPoseList(): void;
  updatePoseReadout(): void;
  clamp(value: number, min: number, max: number): number;
  heatColorFromNorm(value: number): string;
  levelFillWithAlpha(level: unknown, alpha: number): string;
}

function timelineMousePos(canvas: HTMLCanvasElement, event: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export function createViewingTimeline(options: CreateViewingTimelineOptions): ViewingTimelineController {
  const indexToX = (index: number) => {
    const canvas = options.canvas;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 1;
    const poses = options.getPoses();
    const n = Math.max(1, poses.length - 1);
    return (options.clamp(index, 0, n) / n) * width;
  };

  const indexToTime = (index: number) => {
    const poses = options.getPoses();
    const clamped = options.clamp(index, 0, poses.length - 1);
    return poses[clamped]?.t ?? 0;
  };

  const timeToX = (timeMs: number) => {
    const poses = options.getPoses();
    if (!poses.length) return 0;
    let lo = 0;
    let hi = poses.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const tm = poses[mid]?.t ?? 0;
      if (tm <= timeMs) lo = mid;
      else hi = mid - 1;
    }
    const i0 = lo;
    const i1 = Math.min(poses.length - 1, i0 + 1);
    const t0 = poses[i0]?.t ?? 0;
    const t1 = poses[i1]?.t ?? t0;
    const frac = (t1 === t0) ? 0 : options.clamp((timeMs - t0) / (t1 - t0), 0, 1);
    return indexToX(i0 + frac);
  };

  const xToTime = (x: number) => {
    const canvas = options.canvas;
    const poses = options.getPoses();
    if (!canvas || !poses.length) return 0;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 1;
    const n = Math.max(1, poses.length - 1);
    const fractionalIndex = options.clamp(x / width, 0, 1) * n;
    const i0 = Math.floor(fractionalIndex);
    const i1 = Math.min(poses.length - 1, i0 + 1);
    const frac = fractionalIndex - i0;
    const t0 = indexToTime(i0);
    const t1 = indexToTime(i1);
    return t0 + (t1 - t0) * frac;
  };

  const pickWatchDot = (mx: number, my: number) => {
    let best: WatchMarker | null = null;
    let bestD2 = Infinity;
    for (const marker of options.getWatchMarkers()) {
      if (!options.isWatchMarkerVisible(marker)) continue;
      const dx = mx - timeToX(marker.t);
      const dy = my - 10;
      const d2 = dx * dx + dy * dy;
      if (d2 <= 12 * 12 && d2 < bestD2) {
        bestD2 = d2;
        best = marker;
      }
    }
    return best;
  };

  const draw = () => {
    const canvas = options.canvas;
    const context = options.context;
    if (!canvas || !context || !options.timelineBar) return;
    if (options.timelineBar.classList.contains("isCollapsed")) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(255,255,255,0.03)";
    context.fillRect(0, 0, width, height);

    const poses = options.getPoses();
    if (!poses.length) return;

    context.strokeStyle = "rgba(255,255,255,0.08)";
    context.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const x = (width * i) / 10;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    context.lineWidth = 2;
    for (let i = 1; i < poses.length; i += 1) {
      const a = poses[i - 1];
      const b = poses[i];
      if (typeof a.t !== "number" || typeof b.t !== "number") continue;
      const xa = timeToX(a.t);
      const xb = timeToX(b.t);
      const ya = height - 6 - (options.clamp(a.speed_norm ?? 0, 0, 1) * (height - 12));
      const yb = height - 6 - (options.clamp(b.speed_norm ?? 0, 0, 1) * (height - 12));
      const grad = context.createLinearGradient(xa, ya, xb, yb);
      grad.addColorStop(0, options.heatColorFromNorm(a.speed_norm ?? 0));
      grad.addColorStop(1, options.heatColorFromNorm(b.speed_norm ?? 0));
      context.strokeStyle = grad;
      context.beginPath();
      context.moveTo(xa, ya);
      context.lineTo(xb, yb);
      context.stroke();
    }

    for (const marker of options.getWatchMarkers()) {
      if (!options.isWatchMarkerVisible(marker)) continue;
      const x = timeToX(marker.t);
      const y = 10;
      context.save();
      context.fillStyle = options.levelFillWithAlpha(marker.watch.level, 0.25);
      context.strokeStyle = "rgba(255,255,255,0.95)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, 4.2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.restore();
    }

    let selectedTime: number | null = null;
    if (options.isPlaying()) selectedTime = options.getPlayTimeMs();
    else if (options.selection.trackLockActive && options.selection.trackLockIndex != null) {
      selectedTime = poses[options.selection.trackLockIndex]?.t ?? null;
    } else {
      selectedTime = poses[options.selection.selectedIndex]?.t ?? null;
    }

    if (selectedTime != null) {
      const x = timeToX(selectedTime);
      context.strokeStyle = "rgba(255,255,255,0.95)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    if (options.selection.hoverTimelineTime != null) {
      const x = timeToX(options.selection.hoverTimelineTime);
      context.strokeStyle = "rgba(255,255,255,0.5)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    const selectedWatch = options.selection.selectedWatch?.marker;
    if (selectedWatch?.t != null && options.isWatchMarkerVisible(selectedWatch)) {
      const x = timeToX(selectedWatch.t);
      const y = 10;
      context.save();
      context.strokeStyle = "rgba(255,255,255,0.95)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, 9.0, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  };

  const bindEvents = () => {
    const canvas = options.canvas;
    if (!canvas) return;

    canvas.addEventListener("mousemove", (event) => {
      if (!options.hasData() || options.isPlaying() || !options.getPoses().length) return;
      const { x, y } = timelineMousePos(canvas, event);
      const hit = pickWatchDot(x, y);
      canvas.style.cursor = hit ? "pointer" : "crosshair";
      options.selection.saveTimelineHoverIfNeeded();
      options.selection.hoverTimelineTime = xToTime(x);
      options.updatePoseReadout();
      requestDrawAll();
    });

    canvas.addEventListener("mouseleave", () => {
      if (!options.hasData() || options.isPlaying()) return;
      options.selection.clearTimelineHover(true);
      canvas.style.cursor = "default";
      options.updatePoseReadout();
      requestDrawAll();
    });

    canvas.addEventListener("mousedown", (event) => {
      if (!options.hasData() || options.isPlaying() || !options.getPoses().length) return;
      if (options.isLivestreaming()) return;
      const { x, y } = timelineMousePos(canvas, event);
      const hit = pickWatchDot(x, y);
      if (hit) {
        options.selectWatchMarker(hit, true, { x: event.clientX, y: event.clientY });
        return;
      }
      options.clearTrackHover(true);
      options.clearTrackLock();
      options.selection.clearSelectedDetail();
      options.clearWaypointHighlight();
      const timeMs = xToTime(x);
      options.selection.selectedIndex = options.findFloorIndexByTime(timeMs);
      options.setLastPoseIndex(options.selection.selectedIndex);
      options.selection.clearTimelineHover(false);
      options.highlightPoseList();
      options.updatePoseReadout();
      requestDrawAll();
    });
  };

  return { bindEvents, draw, timeToX, xToTime, pickWatchDot };
}
