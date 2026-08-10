import { getMode } from "../../app/modeController";
import type { FieldRenderer } from "../../render/createFieldRenderer";
import { CANVAS_ZOOM_MIN } from "../../render/createFieldRenderer";
import { requestDrawAll } from "../../render/renderScheduler";
import type { PlanningFeature } from "../PlanningFeature";
import type { PlanningDom } from "../PlanningDom";

interface SelectionRect { x0: number; y0: number; x1: number; y1: number }
interface DragPoint { index: number; x: number; y: number }

const POINT_RADIUS = 11;
const OVERLAY_POINT_RADIUS = 7;
const THETA_HANDLE_RADIUS = 6;
const THETA_HANDLE_OFFSET = 25;

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export class PlanningFieldView {
  #pointerId: number | null = null;
  #dragStart: Readonly<{ x: number; y: number }> | null = null;
  #dragPoints: readonly DragPoint[] = [];
  #selectionRect: SelectionRect | null = null;
  #thetaIndex = -1;
  #thetaStart = 0;
  #thetaOriginal: readonly Readonly<{ index: number; theta: number }>[] = [];
  #pendingAdd: Readonly<{ x: number; y: number; screenX: number; screenY: number; clearSelection: boolean }> | null = null;

  constructor(
    private readonly planning: PlanningFeature,
    private readonly field: FieldRenderer,
    private readonly dom: PlanningDom,
  ) {}

  bind(): void {
    this.dom.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    this.dom.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    this.dom.canvas.addEventListener("pointerup", (event) => this.pointerEnd(event));
    this.dom.canvas.addEventListener("pointercancel", (event) => this.pointerEnd(event));
    this.dom.canvas.addEventListener("contextmenu", (event) => {
      if (getMode() === "planning") event.preventDefault();
    });
  }

  draw(force = false): void {
    if (!force && getMode() !== "planning") return;
    if (getMode() !== "planning" && !this.planning.overlayVisible) return;
    const waypoints = this.planning.route.waypoints;
    if (!waypoints.length) return;
    const context = this.field.ctx;
    context.save();
    context.lineWidth = 2;
    context.strokeStyle = "rgba(120,180,255,0.7)";
    context.beginPath();
    waypoints.forEach((point, index) => {
      const screen = this.field.worldToScreen(point.x, point.y);
      if (index === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    });
    context.stroke();

    waypoints.forEach((point, index) => {
      const screen = this.field.worldToScreen(point.x, point.y);
      const selected = this.planning.selection.isWaypointSelected(index);
      const radius = Math.min(
        getMode() === "planning" ? POINT_RADIUS : OVERLAY_POINT_RADIUS,
        (getMode() === "planning" ? 3 : 1) * this.field.getScale(),
      );
      context.beginPath();
      context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      context.fillStyle = index === this.planning.selection.primaryWaypointIndex
        ? "rgba(180,220,255,1)"
        : selected ? "rgba(150,200,255,0.95)" : "rgba(120,180,255,0.9)";
      context.fill();
      context.strokeStyle = "rgba(15,25,35,0.8)";
      context.stroke();
      const angle = this.screenHeading(index) * Math.PI / 180;
      context.beginPath();
      context.moveTo(screen.x, screen.y);
      context.lineTo(screen.x + Math.sin(angle) * radius, screen.y - Math.cos(angle) * radius);
      context.strokeStyle = "rgba(0,0,0,0.9)";
      context.stroke();
      if (selected && getMode() === "planning") this.drawThetaHandle(index, radius, angle);
    });

    if (this.#selectionRect) {
      const rect = this.#selectionRect;
      const x = Math.min(rect.x0, rect.x1);
      const y = Math.min(rect.y0, rect.y1);
      const width = Math.abs(rect.x1 - rect.x0);
      const height = Math.abs(rect.y1 - rect.y0);
      context.fillStyle = "rgba(140,200,255,0.12)";
      context.strokeStyle = "rgba(140,200,255,0.8)";
      context.fillRect(x, y, width, height);
      context.strokeRect(x, y, width, height);
    }
    context.restore();
  }

  hitWaypoint(x: number, y: number): number {
    let index = -1;
    let distance = 12 * 12;
    this.planning.route.waypoints.forEach((point, candidate) => {
      const screen = this.field.worldToScreen(point.x, point.y);
      const next = (screen.x - x) ** 2 + (screen.y - y) ** 2;
      if (next <= distance) {
        index = candidate;
        distance = next;
      }
    });
    return index;
  }

  private pointerDown(event: PointerEvent): void {
    if (getMode() !== "planning") return;
    const point = this.canvasPoint(event);
    this.#pointerId = event.pointerId;
    this.dom.canvas.setPointerCapture(event.pointerId);
    if (event.button === 2) {
      this.#selectionRect = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
      requestDrawAll();
      return;
    }
    if (event.button !== 0) return;
    const thetaIndex = this.hitThetaHandle(point.x, point.y);
    if (thetaIndex >= 0) {
      this.planning.history.begin("route");
      this.#thetaIndex = thetaIndex;
      this.#thetaStart = this.displayTheta(thetaIndex);
      this.#thetaOriginal = [...this.planning.selection.waypointIndices].map((index) => ({ index, theta: this.displayTheta(index) }));
      this.updateTheta(point.x, point.y);
      return;
    }
    const hit = this.hitWaypoint(point.x, point.y);
    if (hit >= 0) {
      if (event.shiftKey) {
        this.planning.selection.toggleWaypoint(hit);
        this.#pointerId = null;
        return;
      }
      if (!this.planning.selection.isWaypointSelected(hit)) this.planning.selection.selectWaypoint(hit);
      const world = this.field.screenToWorld(point.x, point.y);
      this.#dragStart = world;
      const indices = this.planning.selection.isWaypointSelected(hit)
        ? [...this.planning.selection.waypointIndices]
        : [hit];
      this.#dragPoints = indices.flatMap((index) => {
        const waypoint = this.planning.route.waypoints[index];
        return waypoint ? [{ index, x: waypoint.x, y: waypoint.y }] : [];
      });
      this.planning.history.begin("route");
      return;
    }
    const world = this.field.screenToWorld(point.x, point.y);
    this.#pendingAdd = { ...world, screenX: point.x, screenY: point.y, clearSelection: this.planning.selection.waypointIndices.size > 1 };
    this.field.beginPan(event.pointerId, point.x, point.y);
  }

  private pointerMove(event: PointerEvent): void {
    if (getMode() !== "planning" || this.#pointerId !== event.pointerId) return;
    const point = this.canvasPoint(event);
    if (this.#selectionRect) {
      this.#selectionRect.x1 = point.x;
      this.#selectionRect.y1 = point.y;
      requestDrawAll();
      return;
    }
    if (this.#thetaIndex >= 0) {
      this.updateTheta(point.x, point.y);
      return;
    }
    if (this.#dragStart) {
      const world = this.field.screenToWorld(point.x, point.y);
      const dx = world.x - this.#dragStart.x;
      const dy = world.y - this.#dragStart.y;
      this.planning.route.updateMany(this.#dragPoints.map((entry) => {
        const current = this.planning.route.waypoints[entry.index];
        return [entry.index, this.planning.projection.constrain({ ...current, x: entry.x + dx, y: entry.y + dy })];
      }));
      return;
    }
    if (this.#pendingAdd && Math.abs(point.x - this.#pendingAdd.screenX) + Math.abs(point.y - this.#pendingAdd.screenY) > 3) {
      this.#pendingAdd = null;
    }
    this.field.movePan(point.x, point.y);
  }

  private pointerEnd(event: PointerEvent): void {
    if (getMode() !== "planning" || this.#pointerId !== event.pointerId) return;
    if (this.#selectionRect) {
      const rect = this.#selectionRect;
      const selected: number[] = [];
      this.planning.route.waypoints.forEach((point, index) => {
        const screen = this.field.worldToScreen(point.x, point.y);
        if (screen.x >= Math.min(rect.x0, rect.x1) && screen.x <= Math.max(rect.x0, rect.x1)
          && screen.y >= Math.min(rect.y0, rect.y1) && screen.y <= Math.max(rect.y0, rect.y1)) selected.push(index);
      });
      this.planning.selection.setWaypoints(selected);
      this.#selectionRect = null;
    } else if (this.#thetaIndex >= 0 || this.#dragStart) {
      if (event.type === "pointercancel") this.planning.history.cancel();
      else this.planning.history.commit();
    } else {
      const panned = this.field.endPan(event.pointerId);
      if (!panned && event.type !== "pointercancel" && this.#pendingAdd) {
        if (this.#pendingAdd.clearSelection) this.planning.selection.clear();
        else {
          const previous = this.planning.route.waypoints.at(-1);
          const index = this.planning.route.add(this.planning.projection.constrain({
            x: this.#pendingAdd.x,
            y: this.#pendingAdd.y,
            theta: 0,
            speed: Number(previous?.speed) || 127,
          }));
          this.planning.selection.selectWaypoint(index);
        }
      }
    }
    try { this.dom.canvas.releasePointerCapture(event.pointerId); } catch { /* capture may already be released */ }
    this.#pointerId = null;
    this.#dragStart = null;
    this.#dragPoints = [];
    this.#thetaIndex = -1;
    this.#thetaOriginal = [];
    this.#pendingAdd = null;
    requestDrawAll();
  }

  private drawThetaHandle(index: number, radius: number, angle: number): void {
    const point = this.planning.route.waypoints[index];
    if (!point) return;
    const context = this.field.ctx;
    const screen = this.field.worldToScreen(point.x, point.y);
    const distance = radius + THETA_HANDLE_OFFSET * Math.max(this.field.getViewZoom(), CANVAS_ZOOM_MIN);
    const x = screen.x + Math.sin(angle) * distance;
    const y = screen.y - Math.cos(angle) * distance;
    context.beginPath();
    context.moveTo(screen.x, screen.y);
    context.lineTo(x, y);
    context.stroke();
    context.beginPath();
    context.arc(x, y, THETA_HANDLE_RADIUS, 0, Math.PI * 2);
    context.fillStyle = "rgba(90,160,255,1)";
    context.fill();
    context.stroke();
  }

  private hitThetaHandle(x: number, y: number): number {
    for (const index of this.planning.selection.waypointIndices) {
      const point = this.planning.route.waypoints[index];
      if (!point) continue;
      const screen = this.field.worldToScreen(point.x, point.y);
      const angle = this.screenHeading(index) * Math.PI / 180;
      const distance = POINT_RADIUS + THETA_HANDLE_OFFSET * Math.max(this.field.getViewZoom(), CANVAS_ZOOM_MIN);
      const handleX = screen.x + Math.sin(angle) * distance;
      const handleY = screen.y - Math.cos(angle) * distance;
      if ((handleX - x) ** 2 + (handleY - y) ** 2 <= THETA_HANDLE_RADIUS ** 2) return index;
    }
    return -1;
  }

  private updateTheta(x: number, y: number): void {
    const point = this.planning.route.waypoints[this.#thetaIndex];
    if (!point) return;
    const screen = this.field.worldToScreen(point.x, point.y);
    const angle = normalizeDegrees(Math.atan2(x - screen.x, -(y - screen.y)) * 180 / Math.PI - this.field.getFieldRotationDeg());
    const delta = ((angle - this.#thetaStart + 540) % 360) - 180;
    this.planning.route.updateMany(this.#thetaOriginal.map((entry) => [entry.index, {
      theta: this.planning.projection.constrainTheta(normalizeDegrees(entry.theta + delta)),
    }]));
  }

  private displayTheta(index: number): number {
    return normalizeDegrees(Number(this.planning.route.waypoints[index]?.theta) || 0);
  }

  private screenHeading(index: number): number {
    return this.displayTheta(index) + this.field.getFieldRotationDeg();
  }

  private canvasPoint(event: PointerEvent): Readonly<{ x: number; y: number }> {
    const rect = this.dom.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
}
