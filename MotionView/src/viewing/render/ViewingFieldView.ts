import type { FieldPose, ViewingFieldLayer } from "../../render/field/fieldTypes";
import type { FieldRenderer } from "../../render/field/FieldRenderer";
import { getMode } from "../../app/modeController";
import type { ViewingFieldDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import type { WatchMarker, WaypointView } from "../viewingTypes";
import { levelFillWithAlpha } from "../viewingPresentation";
import type { WatchListView } from "./WatchListView";
import type { WaypointListView } from "./WaypointListView";
import type { WatchTooltipView } from "./WatchTooltipView";
import { watchTooltipRows } from "./watchTooltipRows";
import { formatDistanceFromInches } from "../../shared/units";
import { heatColorFromNorm } from "./viewingColors";

const WATCH_RADIUS = 4.2;
const WATCH_ACTIVE_RADIUS = 5.6;
const WAYPOINT_RADIUS = 6;
const WAYPOINT_SELECTED_RADIUS = 7.5;
const MARKER_STROKE_WIDTH = 1;

export class ViewingFieldView implements ViewingFieldLayer {
  #hoverWatch: Readonly<WatchMarker> | null = null;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingFieldDom,
    private readonly field: FieldRenderer,
    private readonly watchList: WatchListView,
    private readonly waypointList: WaypointListView,
    private readonly watchTooltip: WatchTooltipView,
  ) {}

  bind(): void {
    this.dom.canvas.addEventListener("pointerdown", (event) => {
      if (getMode() !== "viewing" || event.button !== 0) return;
      const rect = this.dom.canvas.getBoundingClientRect();
      this.field.beginPan(event.pointerId, event.clientX - rect.left, event.clientY - rect.top);
      this.dom.canvas.setPointerCapture(event.pointerId);
    });
    this.dom.canvas.addEventListener("pointermove", (event) => {
      if (getMode() !== "viewing") return;
      const rect = this.dom.canvas.getBoundingClientRect();
      this.field.movePan(event.clientX - rect.left, event.clientY - rect.top, {
        onStart: () => this.viewing.navigation.setTrackHover(null),
      });
    });
    const endPan = (event: PointerEvent) => {
      if (getMode() === "viewing") this.field.endPan(event.pointerId);
    };
    this.dom.canvas.addEventListener("pointerup", endPan);
    this.dom.canvas.addEventListener("pointercancel", endPan);
    this.dom.canvas.addEventListener("mousemove", (event) => this.handleMouseMove(event));
    this.dom.canvas.addEventListener("mouseleave", () => {
      if (getMode() !== "viewing") return;
      this.#hoverWatch = null;
      this.viewing.navigation.setTrackHover(null);
      this.setCursorReadout(null);
      this.dom.canvas.style.cursor = "";
    });
    this.dom.canvas.addEventListener("click", (event) => this.handleClick(event));
  }

  currentPose(): FieldPose | null {
    return this.viewing.playback.currentDisplayPose();
  }

  drawPath(): void {
    const poses = this.viewing.data.poses;
    if (poses.length < 2) return;
    const context = this.field.ctx;
    context.save();
    context.lineWidth = this.field.sizes.screen({ width: 2, height: 2 }).width;
    for (let index = 1; index < poses.length; index += 1) {
      const previous = poses[index - 1];
      const pose = poses[index];
      if (!previous || !pose) continue;
      const start = this.field.worldToScreen(previous.x, previous.y);
      const end = this.field.worldToScreen(pose.x, pose.y);
      const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
      gradient.addColorStop(0, heatColorFromNorm(previous.speed_norm ?? 0));
      gradient.addColorStop(1, heatColorFromNorm(pose.speed_norm ?? 0));
      context.strokeStyle = gradient;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
    context.restore();
  }

  drawOverlay(): void {
    this.field.ctx.save();
    this.drawWaypoints();
    this.drawWatches();
    this.field.ctx.restore();
  }

  drawWaypointOffset(pose: Readonly<FieldPose> | null): void {
    const waypoint = this.selectedWaypoint();
    if (!pose || !waypoint) return;
    const context = this.field.ctx;
    const start = this.field.worldToScreen(pose.x, pose.y);
    const target = this.viewing.projection.waypointTarget(waypoint);
    const end = this.field.worldToScreen(target.x, target.y);
    const line = this.field.sizes.screen({ width: 1, height: 1 }).width;
    const dash = this.field.sizes.screen({ width: 7, height: 6 });
    const label = this.field.sizes.screen({ width: 68, height: 24 });
    const fontSize = this.field.sizes.screen({ width: 11, height: 11 }).height;
    context.save();
    context.strokeStyle = "rgba(218,250,255,.85)";
    context.lineWidth = line;
    context.setLineDash([dash.width, dash.height]);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(30,30,30,.9)";
    const distance = Math.hypot(pose.x - target.x, pose.y - target.y);
    const x = (start.x + end.x) / 2;
    const y = (start.y + end.y) / 2;
    context.fillRect(x - label.width / 2, y - label.height / 2, label.width, label.height);
    context.fillStyle = "white";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${fontSize}px ui-monospace`;
    context.fillText(`${distance.toFixed(1)} in`, x, y);
    context.restore();
  }

  private drawWatches(): void {
    const context = this.field.ctx;
    for (const marker of this.viewing.projection.watchMarkers) {
      if (!marker.pose || !this.watchList.isVisible(marker)) continue;
      const point = this.field.worldToScreen(marker.pose.x, marker.pose.y);
      const selected = this.viewing.navigation.selectedWatch?.t === marker.t;
      const radius = this.scaledRadius(selected || this.#hoverWatch === marker ? WATCH_ACTIVE_RADIUS : WATCH_RADIUS);
      context.beginPath();
      context.fillStyle = levelFillWithAlpha(marker.watch.level, 0.95);
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(255,255,255,.8)";
      context.lineWidth = this.scaledRadius(MARKER_STROKE_WIDTH);
      context.stroke();
    }
  }

  private drawWaypoints(): void {
    const context = this.field.ctx;
    for (const waypoint of this.viewing.data.waypoints) {
      if (!this.waypointList.filterMatches(waypoint)) continue;
      const target = this.viewing.projection.waypointTarget(waypoint);
      const point = this.field.worldToScreen(target.x, target.y);
      const selected = String(this.viewing.navigation.selectedWaypointId) === String(waypoint.id);
      const radius = this.scaledRadius(selected ? WAYPOINT_SELECTED_RADIUS : WAYPOINT_RADIUS);
      context.beginPath();
      context.fillStyle = waypoint.active ? "rgba(0,150,230,.85)" : "rgba(120,135,150,.75)";
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "white";
      context.lineWidth = this.scaledRadius(MARKER_STROKE_WIDTH);
      context.stroke();
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (getMode() !== "viewing") return;
    this.updateCursorReadout(event.clientX, event.clientY);
    if (this.viewing.playback.isPlaying || this.field.isPanning()) return;
    const trackHit = this.hitTrack(event.clientX, event.clientY);
    this.#hoverWatch = this.hitWatch(event.clientX, event.clientY);
    if (this.#hoverWatch) {
      this.viewing.navigation.setTrackHover(trackHit?.pose ?? null, trackHit?.time ?? null);
      this.dom.canvas.style.cursor = "pointer";
      return;
    }
    const waypoint = this.hitWaypoint(event.clientX, event.clientY);
    if (waypoint) {
      this.viewing.navigation.setTrackHover(null);
      this.dom.canvas.style.cursor = "pointer";
      return;
    }
    this.viewing.navigation.setTrackHover(trackHit?.pose ?? null, trackHit?.time ?? null);
    this.dom.canvas.style.cursor = trackHit ? "crosshair" : "";
  }

  private handleClick(event: MouseEvent): void {
    if (getMode() !== "viewing") return;
    if (this.field.getSuppressNextClick()) {
      this.field.consumeSuppressNextClick();
      return;
    }
    const trackHit = this.hitTrack(event.clientX, event.clientY);
    const watch = this.hitWatch(event.clientX, event.clientY);
    if (watch && !this.viewing.navigation.livestreaming) {
      this.viewing.playback.pause();
      this.viewing.navigation.clearTrackLock();
      this.viewing.navigation.setTrackHover(null);
      this.viewing.navigation.setTimelineHover(null);
      const index = watch.idx ?? this.viewing.projection.findFloorIndex(watch.t);
      const pose = trackHit?.pose ?? this.viewing.projection.interpolatePose(watch.t) ?? watch.pose;
      const poseIndex = trackHit?.index ?? index;
      if (poseIndex >= 0 && pose) this.viewing.navigation.lockTrack(pose, poseIndex);
      this.viewing.navigation.selectWatch(watch);
      this.watchTooltip.show(watchTooltipRows(watch, pose), { x: event.clientX, y: event.clientY });
      return;
    }
    this.watchTooltip.hide();
    const waypoint = this.hitWaypoint(event.clientX, event.clientY);
    if (waypoint) {
      this.viewing.playback.pause();
      this.viewing.navigation.clearTrackLock();
      this.viewing.navigation.setTrackHover(null);
      this.viewing.navigation.selectWaypoint(waypoint, waypoint.latestActiveEvent);
      const index = this.viewing.projection.waypointPoseIndex(waypoint);
      if (index != null) this.viewing.navigation.selectPose(index, { preserveDetails: true });
      return;
    }
    if (!this.viewing.navigation.livestreaming) {
      if (trackHit) {
        this.viewing.playback.pause();
        this.viewing.navigation.lockTrack(trackHit.pose, trackHit.index);
      } else this.viewing.navigation.clearTrackLock();
    }
  }

  private hitWatch(clientX: number, clientY: number): Readonly<WatchMarker> | null {
    const rect = this.dom.canvas.getBoundingClientRect();
    let best: Readonly<WatchMarker> | null = null;
    let distance = this.scaledRadius(10) ** 2;
    for (const marker of this.viewing.projection.watchMarkers) {
      if (!marker.pose || !this.watchList.isVisible(marker)) continue;
      const point = this.field.worldToScreen(marker.pose.x, marker.pose.y);
      const next = (point.x - (clientX - rect.left)) ** 2 + (point.y - (clientY - rect.top)) ** 2;
      if (next <= distance) {
        distance = next;
        best = marker;
      }
    }
    return best;
  }

  private hitWaypoint(clientX: number, clientY: number): WaypointView | null {
    const rect = this.dom.canvas.getBoundingClientRect();
    let best: WaypointView | null = null;
    let distance = this.scaledRadius(12) ** 2;
    for (const waypoint of this.viewing.data.waypoints) {
      if (!this.waypointList.filterMatches(waypoint)) continue;
      const target = this.viewing.projection.waypointTarget(waypoint);
      const point = this.field.worldToScreen(target.x, target.y);
      const next = (point.x - (clientX - rect.left)) ** 2 + (point.y - (clientY - rect.top)) ** 2;
      if (next <= distance) {
        distance = next;
        best = waypoint;
      }
    }
    return best;
  }

  private hitTrack(clientX: number, clientY: number): Readonly<{
    index: number;
    time: number;
    pose: NonNullable<ReturnType<ViewingFeature["projection"]["interpolatePose"]>>;
  }> | null {
    const rect = this.dom.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { startIndex: number; amount: number; distance: number; indexDelta: number } | null = null;
    const anchorIndex = this.viewing.navigation.trackLockIndex
      ?? this.viewing.navigation.selectedIndex;
    const distanceTieTolerance = 4;
    const step = Math.max(1, Math.floor(this.viewing.data.poses.length / 2000));
    for (let startIndex = 0; startIndex < this.viewing.data.poses.length - 1; startIndex += step) {
      const endIndex = Math.min(this.viewing.data.poses.length - 1, startIndex + step);
      const startPose = this.viewing.projection.poseAt(startIndex);
      const endPose = this.viewing.projection.poseAt(endIndex);
      if (!startPose || !endPose) continue;
      const start = this.field.worldToScreen(startPose.x, startPose.y);
      const end = this.field.worldToScreen(endPose.x, endPose.y);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const amount = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared))
        : 0;
      const projectedX = start.x + dx * amount;
      const projectedY = start.y + dy * amount;
      const distance = (projectedX - x) ** 2 + (projectedY - y) ** 2;
      const indexDelta = anchorIndex < startIndex
        ? startIndex - anchorIndex
        : anchorIndex > endIndex ? anchorIndex - endIndex : 0;
      const previousBest = best;
      const spatiallyBetter = !previousBest || distance < previousBest.distance - distanceTieTolerance;
      const spatialTie = previousBest && Math.abs(distance - previousBest.distance) <= distanceTieTolerance;
      if (distance <= this.scaledRadius(12) ** 2
        && (spatiallyBetter || (spatialTie && indexDelta < previousBest.indexDelta))) {
        best = { startIndex, amount, distance, indexDelta };
      }
    }
    if (!best) return null;
    const endIndex = Math.min(this.viewing.data.poses.length - 1, best.startIndex + step);
    const startTime = this.viewing.data.poses[best.startIndex]?.t;
    const endTime = this.viewing.data.poses[endIndex]?.t;
    if (typeof startTime !== "number" || typeof endTime !== "number") return null;
    const time = startTime + (endTime - startTime) * best.amount;
    const pose = this.viewing.projection.interpolatePose(time);
    if (!pose) return null;
    return { index: this.viewing.projection.findFloorIndex(time), time, pose };
  }

  private selectedWaypoint(): WaypointView | null {
    const id = this.viewing.navigation.selectedWaypointId;
    if (id == null) return null;
    return this.viewing.data.waypointById.get(Number(id))
      ?? this.viewing.data.waypoints.find((waypoint) => String(waypoint.id) === String(id))
      ?? null;
  }

  private scaledRadius(radius: number): number {
    return this.field.sizes.screen({ width: radius * 2, height: radius * 2 }).width / 2;
  }

  private updateCursorReadout(clientX: number, clientY: number): void {
    const rect = this.dom.canvas.getBoundingClientRect();
    const point = this.field.screenToWorld(clientX - rect.left, clientY - rect.top);
    this.setCursorReadout(`Cursor: X ${formatDistanceFromInches(point.x, 2)} Y ${formatDistanceFromInches(point.y, 2)}`);
  }

  private setCursorReadout(text: string | null): void {
    const value = text ?? "Cursor: —";
    this.dom.cursor.textContent = value;
    this.dom.planCursor.textContent = value;
  }
}
