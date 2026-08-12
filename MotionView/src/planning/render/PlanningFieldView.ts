import { getMode } from "../../app/modeController";
import type { FieldRenderer } from "../../render/createFieldRenderer";
import { requestDrawAll } from "../../render/renderScheduler";
import type { PlanningFeature } from "../PlanningFeature";
import type { PlanningDom } from "../PlanningDom";
import type { PlanningDialogs } from "../PlanningDialogs";
import { getPlanMethodTooltipName, getPlanNodeEffectiveMethod } from "../planningObjects";
import { planningTelemetry } from "../../telemetry/createTelemetry";
import { getUtf8ByteLength } from "../planningTemplate";
import { formatDistanceFromInches } from "../../shared/units";

interface SelectionRect { x0: number; y0: number; x1: number; y1: number }
interface DragPoint { index: number; x: number; y: number }
interface NodeMarker {
  readonly node: (PlanningFeature["timeline"]["nodes"])[number];
  readonly x: number;
  readonly y: number;
  readonly tx: number;
  readonly ty: number;
}

const WAYPOINT_RADIUS = 9;
const OVERLAY_WAYPOINT_RADIUS = 6;
const THETA_HANDLE_RADIUS = 4;
const THETA_HANDLE_OFFSET = 20;
const NODE_LONG = 12;
const NODE_THICK = 3.75;
const NODE_TICK = 10;
const NODE_BORDER = 1.5;

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
  #hoverNodeId: string | null = null;
  #tooltipTimer: number | null = null;

  constructor(
    private readonly planning: PlanningFeature,
    private readonly field: FieldRenderer,
    private readonly dom: PlanningDom,
    private readonly dialogs: PlanningDialogs,
  ) {}

  bind(): void {
    this.dom.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    this.dom.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    this.dom.canvas.addEventListener("pointerup", (event) => this.pointerEnd(event));
    this.dom.canvas.addEventListener("pointercancel", (event) => this.pointerEnd(event));
    this.dom.canvas.addEventListener("pointerleave", () => {
      if (getMode() === "planning") this.dom.cursorPill.textContent = "Cursor: —";
      if (this.#pointerId == null) {
        this.#hoverNodeId = null;
        this.hideNodeTooltip();
        requestDrawAll();
      }
    });
    this.dom.canvas.addEventListener("contextmenu", (event) => {
      if (getMode() === "planning") event.preventDefault();
    });
    this.dom.canvas.addEventListener("dblclick", (event) => {
      if (getMode() !== "planning") return;
      const point = this.canvasPoint(event as PointerEvent);
      const node = this.hitNode(point.x, point.y);
      if (node) { event.preventDefault(); void this.editNode(node.id); }
    });
  }

  draw(force = false): void {
    if (!force && getMode() !== "planning") return;
    if (getMode() !== "planning" && !this.planning.overlayVisible) return;
    const waypoints = this.planning.route.waypoints;
    if (!waypoints.length) return;
    const context = this.field.ctx;
    context.save();
    context.lineWidth = this.field.sizes.screen({ width: 2, height: 2 }).width;
    context.strokeStyle = "rgb(120,180,255)";
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
      const radius = this.waypointRadius(getMode() !== "planning");
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

    for (const marker of this.nodeMarkers()) {
      const object = this.planning.objects.get(marker.node.objectId);
      if (!object) continue;
      const screen = this.field.worldToScreen(marker.x, marker.y);
      const tangentStart = this.field.worldToScreen(marker.x - marker.tx, marker.y - marker.ty);
      const tangentEnd = this.field.worldToScreen(marker.x + marker.tx, marker.y + marker.ty);
      const normalAngle = Math.atan2(tangentEnd.y - tangentStart.y, tangentEnd.x - tangentStart.x) + Math.PI / 2;
      const selected = this.planning.selection.selectedNodeId === marker.node.id || this.#hoverNodeId === marker.node.id;
      const size = this.nodeScreenSize(getMode() === "planning");
      context.save();
      context.translate(screen.x, screen.y);
      context.rotate(normalAngle);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = object.color;
      context.lineWidth = size.border * (selected ? 5 / 3 : 4 / 3);
      context.beginPath();
      context.moveTo(-size.tick / 2, 0);
      context.lineTo(size.tick / 2, 0);
      context.stroke();
      context.fillStyle = selected ? "rgba(255,255,255,.98)" : "rgba(15,25,35,.7)";
      context.beginPath();
      context.roundRect(
        -(size.width + size.border * 2) / 2,
        -(size.height + size.border * 2) / 2,
        size.width + size.border * 2,
        size.height + size.border * 2,
        (size.height + size.border * 2) / 2,
      );
      context.fill();
      context.fillStyle = object.color;
      context.beginPath();
      context.roundRect(-size.width / 2, -size.height / 2, size.width, size.height, size.height / 2);
      context.fill();
      context.restore();
    }

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
    let distance = this.waypointRadius(false) ** 2;
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
    const node = hit < 0 ? this.hitNode(point.x, point.y) : null;
    if (node) {
      this.planning.selection.selectNode(node.id);
      this.releaseCapture(event.pointerId);
      this.#pointerId = null;
      return;
    }
    if (hit >= 0) {
      if (event.shiftKey) {
        this.planning.selection.toggleWaypoint(hit);
        this.releaseCapture(event.pointerId);
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
    const bounds = this.field.getBounds();
    if (world.x < bounds.minX || world.x > bounds.maxX || world.y < bounds.minY || world.y > bounds.maxY) {
      this.#pendingAdd = null;
      this.field.beginPan(event.pointerId, point.x, point.y);
      return;
    }
    this.#pendingAdd = { ...world, screenX: point.x, screenY: point.y, clearSelection: this.planning.selection.waypointIndices.size > 1 };
    this.field.beginPan(event.pointerId, point.x, point.y);
  }

  private pointerMove(event: PointerEvent): void {
    if (getMode() !== "planning") return;
    const point = this.canvasPoint(event);
    const world = this.field.screenToWorld(point.x, point.y);
    this.dom.cursorPill.textContent = `Cursor: X ${formatDistanceFromInches(world.x, 2)} Y ${formatDistanceFromInches(world.y, 2)}`;
    if (this.#pointerId !== event.pointerId) {
      const node = this.hitNode(point.x, point.y);
      const nextId = node?.id ?? null;
      if (nextId !== this.#hoverNodeId) {
        this.#hoverNodeId = nextId;
        if (node) this.showNodeTooltip(node.id, event.clientX, event.clientY);
        else this.hideNodeTooltip();
      } else if (node) this.positionNodeTooltip(event.clientX, event.clientY);
      requestDrawAll();
      return;
    }
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
      const dx = world.x - this.#dragStart.x;
      const dy = world.y - this.#dragStart.y;
      this.planning.route.updateMany(this.#dragPoints.map((entry) => {
        const current = this.planning.route.waypoints[entry.index];
        return [entry.index, this.planning.projection.constrain({ ...current, x: entry.x + dx, y: entry.y + dy })];
      }));
      requestDrawAll();
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
    this.releaseCapture(event.pointerId);
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
    const handle = this.thetaHandleGeometry(radius);
    const distance = handle.distance;
    const x = screen.x + Math.sin(angle) * distance;
    const y = screen.y - Math.cos(angle) * distance;
    context.beginPath();
    context.moveTo(screen.x, screen.y);
    context.lineTo(x, y);
    context.stroke();
    context.beginPath();
    context.arc(x, y, handle.radius, 0, Math.PI * 2);
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
      const handle = this.thetaHandleGeometry(this.waypointRadius(false));
      const distance = handle.distance;
      const handleX = screen.x + Math.sin(angle) * distance;
      const handleY = screen.y - Math.cos(angle) * distance;
      if ((handleX - x) ** 2 + (handleY - y) ** 2 <= handle.radius ** 2) return index;
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
    requestDrawAll();
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

  private releaseCapture(pointerId: number): void {
    try { this.dom.canvas.releasePointerCapture(pointerId); } catch { /* capture may already be released */ }
  }

  private hitNode(x: number, y: number) {
    let best: NodeMarker | null = null;
    let distance = Infinity;
    const size = this.nodeScreenSize(true);
    for (const marker of this.nodeMarkers()) {
      const screen = this.field.worldToScreen(marker.x, marker.y);
      const tangentStart = this.field.worldToScreen(marker.x - marker.tx, marker.y - marker.ty);
      const tangentEnd = this.field.worldToScreen(marker.x + marker.tx, marker.y + marker.ty);
      const angle = Math.atan2(tangentEnd.y - tangentStart.y, tangentEnd.x - tangentStart.x) + Math.PI / 2;
      const dx = x - screen.x;
      const dy = y - screen.y;
      const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
      const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
      const width = Math.max(size.width + size.border * 2, size.tick);
      const height = size.height + size.border * 2;
      if (Math.abs(localX) > width / 2 || Math.abs(localY) > height / 2) continue;
      const next = dx * dx + dy * dy;
      if (next < distance) { best = marker; distance = next; }
    }
    return best?.node ?? null;
  }

  private waypointRadius(overlay: boolean): number {
    const radius = overlay ? OVERLAY_WAYPOINT_RADIUS : WAYPOINT_RADIUS;
    return this.field.sizes.screen({ width: radius * 2, height: radius * 2 }).width / 2;
  }

  private thetaHandleGeometry(waypointRadius: number): Readonly<{ radius: number; distance: number }> {
    const diameter = this.field.sizes.screen({
      width: THETA_HANDLE_RADIUS * 2,
      height: THETA_HANDLE_RADIUS * 2,
    });
    const offset = this.field.sizes.screen({
      width: THETA_HANDLE_OFFSET,
      height: THETA_HANDLE_OFFSET,
    });
    return {
      radius: diameter.width / 2,
      distance: waypointRadius + offset.width,
    };
  }

  private nodeScreenSize(planningMode: boolean): Readonly<{
    width: number;
    height: number;
    tick: number;
    border: number;
  }> {
    const node = this.field.sizes.screen({ width: NODE_LONG, height: NODE_THICK });
    const tick = this.field.sizes.screen({ width: NODE_TICK, height: NODE_BORDER });
    if (planningMode) return { width: node.width, height: node.height, tick: tick.width, border: tick.height };
    const cap = this.field.sizes.world({ width: 2.12, height: 2.12 });
    return {
      width: Math.min(cap.width, node.width),
      height: Math.min(cap.height, node.height),
      tick: Math.min(cap.width, tick.width),
      border: tick.height,
    };
  }

  private nodeMarkers(): readonly NodeMarker[] {
    return this.planning.projection.nodePlacements.map((placement) => ({
      node: placement.node,
      x: placement.x,
      y: placement.y,
      tx: placement.tangentX,
      ty: placement.tangentY,
    }));
  }

  private showNodeTooltip(nodeId: string, clientX: number, clientY: number): void {
    this.hideNodeTooltip();
    const node = this.planning.timeline.get(nodeId);
    const object = node ? this.planning.objects.get(node.objectId) : null;
    const method = node ? getPlanNodeEffectiveMethod(this.planning.objects.items, node) : null;
    if (!node || !object || !method) return;
    this.#tooltipTimer = window.setTimeout(() => {
      this.dom.nodeTooltip.textContent = `${object.name || "Object"} • ${getPlanMethodTooltipName(method.name)}`;
      this.dom.nodeTooltip.classList.toggle("hasOverride", method.hasOverride);
      this.dom.nodeTooltip.hidden = false;
      this.dom.nodeTooltip.classList.add("isVisible");
      this.positionNodeTooltip(clientX, clientY);
    }, 250);
  }

  private positionNodeTooltip(clientX: number, clientY: number): void {
    const maxX = window.innerWidth - this.dom.nodeTooltip.offsetWidth - 8;
    const maxY = window.innerHeight - this.dom.nodeTooltip.offsetHeight - 8;
    this.dom.nodeTooltip.style.left = `${Math.max(8, Math.min(clientX + 12, maxX))}px`;
    this.dom.nodeTooltip.style.top = `${Math.max(8, Math.min(clientY + 14, maxY))}px`;
  }

  private hideNodeTooltip(): void {
    if (this.#tooltipTimer != null) window.clearTimeout(this.#tooltipTimer);
    this.#tooltipTimer = null;
    this.dom.nodeTooltip.classList.remove("isVisible", "hasOverride");
    this.dom.nodeTooltip.hidden = true;
  }

  private async editNode(nodeId: string): Promise<void> {
    const node = this.planning.timeline.get(nodeId);
    const method = node ? getPlanNodeEffectiveMethod(this.planning.objects.items, node) : null;
    if (!node || !method) return;
    const result = await this.dialogs.edit({ title: "Edit Placed Node", groupTitle: "Node Code", description: "These code changes only apply to this placed node.", code: method.code });
    if (!result) return;
    const changed = this.planning.timeline.setCodeOverride(nodeId, result.code);
    if (changed.changed) void planningTelemetry.timelineNodeUpdated(this.planning.telemetryProperties({ node_override_created: !changed.hadOverride && changed.hasOverride, node_override_cleared: changed.hadOverride && !changed.hasOverride, node_code_chars: result.code.length, node_code_bytes: getUtf8ByteLength(result.code) }));
  }
}
