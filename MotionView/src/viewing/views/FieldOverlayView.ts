import type { FieldPose, FieldRenderer } from "../../render/createFieldRenderer";
import { getMode } from "../../app/modeController";
import type { ViewingDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import type { WatchMarker, WaypointView } from "../viewingTypes";
import { levelFillWithAlpha } from "../viewingPresentation";
import type { WatchListView } from "./WatchListView";
import type { WaypointListView } from "./WaypointListView";
import type { WatchTooltipView } from "./WatchTooltipView";

export class FieldOverlayView {
  #hoverWatch: Readonly<WatchMarker> | null = null;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingDom,
    private readonly field: FieldRenderer,
    private readonly watchList: WatchListView,
    private readonly waypointList: WaypointListView,
    private readonly watchTooltip: WatchTooltipView,
  ) {}

  bind(): void {
    this.dom.canvas.addEventListener("mousemove", (event) => this.handleMouseMove(event));
    this.dom.canvas.addEventListener("mouseleave", () => {
      if (getMode() !== "viewing") return;
      this.#hoverWatch = null;
      this.viewing.navigation.setTrackHover(null);
      this.dom.canvas.style.cursor = "";
    });
    this.dom.canvas.addEventListener("click", (event) => this.handleClick(event));
  }

  draw(): void {
    this.drawWaypoints();
    this.drawWatches();
  }

  drawWaypointOffset(pose: Readonly<FieldPose> | null): void {
    const waypoint = this.selectedWaypoint();
    if (!pose || !waypoint) return;
    const context = this.field.ctx;
    const start = this.field.worldToScreen(pose.x, pose.y);
    const end = this.field.worldToScreen(waypoint.target.x, waypoint.target.y);
    context.save();
    context.strokeStyle = "rgba(218,250,255,.85)";
    context.setLineDash([7, 6]);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(30,30,30,.9)";
    const distance = Math.hypot(pose.x - waypoint.target.x, pose.y - waypoint.target.y);
    const x = (start.x + end.x) / 2;
    const y = (start.y + end.y) / 2;
    context.fillRect(x - 34, y - 12, 68, 24);
    context.fillStyle = "white";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "11px ui-monospace";
    context.fillText(`${distance.toFixed(1)} in`, x, y);
    context.restore();
  }

  private drawWatches(): void {
    const context = this.field.ctx;
    for (const marker of this.viewing.projection.watchMarkers) {
      if (!marker.pose || !this.watchList.isVisible(marker)) continue;
      const point = this.field.worldToScreen(marker.pose.x, marker.pose.y);
      const selected = this.viewing.navigation.selectedWatch?.t === marker.t;
      context.beginPath();
      context.fillStyle = levelFillWithAlpha(marker.watch.level, 0.95);
      context.arc(point.x, point.y, selected || this.#hoverWatch === marker ? 5.6 : 4.2, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(255,255,255,.8)";
      context.stroke();
    }
  }

  private drawWaypoints(): void {
    const context = this.field.ctx;
    for (const waypoint of this.viewing.data.waypoints) {
      if (!this.waypointList.filterMatches(waypoint)) continue;
      const point = this.field.worldToScreen(waypoint.target.x, waypoint.target.y);
      const selected = String(this.viewing.navigation.selectedWaypointId) === String(waypoint.id);
      context.beginPath();
      context.fillStyle = waypoint.active ? "rgba(0,150,230,.85)" : "rgba(120,135,150,.75)";
      context.arc(point.x, point.y, selected ? 7.5 : 6, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "white";
      context.stroke();
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (getMode() !== "viewing") return;
    if (this.viewing.playback.isPlaying || this.field.isPanning()) return;
    this.#hoverWatch = this.hitWatch(event.clientX, event.clientY);
    if (this.#hoverWatch) {
      this.dom.canvas.style.cursor = "pointer";
      return;
    }
    const waypoint = this.hitWaypoint(event.clientX, event.clientY);
    this.dom.canvas.style.cursor = waypoint ? "pointer" : "";
  }

  private handleClick(event: MouseEvent): void {
    if (getMode() !== "viewing") return;
    if (this.field.getSuppressNextClick()) {
      this.field.consumeSuppressNextClick();
      return;
    }
    const watch = this.hitWatch(event.clientX, event.clientY);
    if (watch && !this.viewing.navigation.livestreaming) {
      this.viewing.playback.pause();
      this.viewing.navigation.setTimelineHover(null);
      this.viewing.navigation.selectWatch(watch);
      const index = watch.idx ?? this.viewing.projection.findFloorIndex(watch.t);
      if (index >= 0) this.viewing.navigation.selectPose(index, { preserveDetails: true });
      this.watchTooltip.show(watch, { x: event.clientX, y: event.clientY });
      return;
    }
    this.watchTooltip.hide();
    const waypoint = this.hitWaypoint(event.clientX, event.clientY);
    if (waypoint) {
      this.viewing.playback.pause();
      this.viewing.navigation.selectWaypoint(waypoint, waypoint.latestActiveEvent);
      const index = this.viewing.projection.waypointPoseIndex(waypoint);
      if (index != null) this.viewing.navigation.selectPose(index, { preserveDetails: true });
      return;
    }
    if (!this.viewing.navigation.livestreaming) {
      const poseIndex = this.hitTrack(event.clientX, event.clientY);
      if (poseIndex != null) {
        this.viewing.playback.pause();
        this.viewing.navigation.selectPose(poseIndex);
        const pose = this.viewing.projection.poseAt(poseIndex);
        if (pose) this.viewing.navigation.lockTrack(pose, poseIndex);
      } else this.viewing.navigation.clearTrackLock();
    }
  }

  private hitWatch(clientX: number, clientY: number): Readonly<WatchMarker> | null {
    const rect = this.dom.canvas.getBoundingClientRect();
    let best: Readonly<WatchMarker> | null = null;
    let distance = 100;
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
    let distance = 144;
    for (const waypoint of this.viewing.data.waypoints) {
      if (!this.waypointList.filterMatches(waypoint)) continue;
      const point = this.field.worldToScreen(waypoint.target.x, waypoint.target.y);
      const next = (point.x - (clientX - rect.left)) ** 2 + (point.y - (clientY - rect.top)) ** 2;
      if (next <= distance) {
        distance = next;
        best = waypoint;
      }
    }
    return best;
  }

  private hitTrack(clientX: number, clientY: number): number | null {
    const rect = this.dom.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let bestIndex: number | null = null;
    let bestDistance = 144;
    const step = Math.max(1, Math.floor(this.viewing.data.poses.length / 2000));
    for (let index = 0; index < this.viewing.data.poses.length; index += step) {
      const pose = this.viewing.projection.poseAt(index);
      if (!pose) continue;
      const point = this.field.worldToScreen(pose.x, pose.y);
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  private selectedWaypoint(): WaypointView | null {
    const id = this.viewing.navigation.selectedWaypointId;
    if (id == null) return null;
    return this.viewing.data.waypointById.get(Number(id))
      ?? this.viewing.data.waypoints.find((waypoint) => String(waypoint.id) === String(id))
      ?? null;
  }
}
