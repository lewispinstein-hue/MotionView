import { getMode } from "../../app/modeController";
import { requestDrawAll } from "../../render/renderScheduler";
import { planningTelemetry } from "../../telemetry/createTelemetry";
import type { PlanningDialogs } from "../PlanningDialogs";
import type { PlanningDom } from "../PlanningDom";
import type { PlanningFeature } from "../PlanningFeature";
import { getPlanMethodNumber, getPlanNodeEffectiveMethod, hasPlanNodeMethodOverride } from "../planningObjects";
import { getContrastTextColor, getDefaultPlanObjectColor } from "../planningState";
import { getUtf8ByteLength } from "../planningTemplate";
import type { PlanningMethodDrag, PlanningDragCoordinator } from "./PlanningDragCoordinator";

const PAD = 20;
const NODE_WIDTH = 34;
const NODE_GAP = 6;

interface ActiveDrag extends PlanningMethodDrag {
  readonly ghost: HTMLElement;
  started: boolean;
}

export class PlanningTimelineView {
  readonly #context: CanvasRenderingContext2D;
  #activeDrag: ActiveDrag | null = null;
  #drop: Readonly<{ beforeWaypoint: number; index: number; x: number }> | null = null;
  #scrubbing = false;
  #tooltipTimer: number | null = null;
  #bound = false;

  constructor(
    private readonly planning: PlanningFeature,
    private readonly dom: PlanningDom,
    private readonly dialogs: PlanningDialogs,
    drag: PlanningDragCoordinator,
  ) {
    const context = dom.timelineCanvas.getContext("2d");
    if (!context) throw new Error("MotionView could not initialize the Planning timeline canvas.");
    this.#context = context;
    drag.started.subscribe((event) => this.beginDrag(event));
  }

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.dom.timelineCanvas.addEventListener("pointerdown", (event) => {
      if (getMode() !== "planning") return;
      this.#scrubbing = true;
      this.dom.timelineCanvas.setPointerCapture(event.pointerId);
      this.scrub(event.clientX);
    });
    this.dom.timelineCanvas.addEventListener("pointermove", (event) => { if (this.#scrubbing) this.scrub(event.clientX); });
    this.dom.timelineCanvas.addEventListener("pointerup", (event) => {
      this.#scrubbing = false;
      try { this.dom.timelineCanvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    });
    this.dom.timelineCanvas.addEventListener("pointercancel", () => { this.#scrubbing = false; });
    this.dom.eventTimeline.addEventListener("click", (event) => {
      if (event.target === this.dom.eventTimeline || event.target === this.dom.eventTimelineInner) this.planning.selection.selectNode(null);
    });
    window.addEventListener("pointermove", (event) => this.moveDrag(event));
    window.addEventListener("pointerup", () => this.finishDrag());
    window.addEventListener("pointercancel", () => this.cancelDrag());
    window.addEventListener("blur", () => this.cancelDrag());
  }

  render(): void {
    const nodes = [...this.planning.timeline.nodes].sort((a, b) => a.beforeWaypoint - b.beforeWaypoint || a.index - b.index || a.id.localeCompare(b.id));
    this.dom.timelineNodeLayer.replaceChildren();
    this.dom.timelineWaypointLayer.replaceChildren();
    this.dom.eventTimelineHint.hidden = this.planning.route.length >= 2;
    const width = Math.max(this.dom.timelineViewport.clientWidth, 360);
    this.dom.timelineContent.style.width = `${width}px`;
    this.planning.route.waypoints.forEach((_point, index) => {
      const marker = document.createElement("div");
      marker.className = "planningTimelineWaypointConnector";
      marker.style.left = `${this.xForWaypoint(index, width)}px`;
      this.dom.timelineWaypointLayer.appendChild(marker);
    });
    for (const node of nodes) {
      const object = this.planning.objects.get(node.objectId);
      const method = getPlanNodeEffectiveMethod(this.planning.objects.items, node);
      if (!object || !method) continue;
      const element = document.createElement("button");
      element.type = "button";
      element.className = `planningTimelineNode${this.planning.selection.selectedNodeId === node.id ? " isSelected" : ""}${hasPlanNodeMethodOverride(node as any) ? " hasOverride" : ""}`;
      element.dataset.nodeId = node.id;
      element.style.left = `${this.xForBucket(node.beforeWaypoint, width) + node.index * (NODE_WIDTH + NODE_GAP)}px`;
      element.style.background = object.color || getDefaultPlanObjectColor(0);
      element.style.color = getContrastTextColor(object.color);
      element.textContent = String(getPlanMethodNumber(this.planning.objects.items, node.objectId, node.methodId) ?? "");
      element.addEventListener("click", (event) => { event.stopPropagation(); this.planning.selection.selectNode(node.id); });
      element.addEventListener("dblclick", (event) => { event.stopPropagation(); void this.editNode(node.id); });
      element.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        this.beginDrag({ source: "timeline", objectId: node.objectId, methodId: node.methodId, nodeId: node.id, sourceElement: element, startX: event.clientX, startY: event.clientY });
      });
      element.addEventListener("pointerenter", (event) => this.showTooltip(method.name, event.clientX, event.clientY, method.hasOverride));
      element.addEventListener("pointermove", (event) => this.positionTooltip(event.clientX, event.clientY));
      element.addEventListener("pointerleave", () => this.hideTooltip());
      this.dom.timelineNodeLayer.appendChild(element);
    }
    this.updateDropLine();
    this.draw();
  }

  draw(): void {
    if (getMode() !== "planning") return;
    const rect = this.dom.timelineCanvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(rect.width * ratio));
    const pixelHeight = Math.max(1, Math.floor(rect.height * ratio));
    if (this.dom.timelineCanvas.width !== pixelWidth || this.dom.timelineCanvas.height !== pixelHeight) {
      this.dom.timelineCanvas.width = pixelWidth;
      this.dom.timelineCanvas.height = pixelHeight;
      this.#context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    this.#context.clearRect(0, 0, rect.width, rect.height);
    if (this.planning.projection.totalLength <= 0) return;
    const y = rect.height / 2;
    this.#context.strokeStyle = "rgba(255,255,255,0.12)";
    this.#context.lineWidth = 2;
    this.#context.beginPath();
    this.#context.moveTo(PAD, y);
    this.#context.lineTo(rect.width - PAD, y);
    this.#context.stroke();
    const progress = PAD + (rect.width - PAD * 2) * this.planning.playback.distance / this.planning.projection.totalLength;
    this.#context.strokeStyle = "rgba(120,180,255,0.9)";
    this.#context.beginPath();
    this.#context.moveTo(PAD, y);
    this.#context.lineTo(progress, y);
    this.#context.stroke();
    this.#context.beginPath();
    this.#context.arc(progress, y, 8, 0, Math.PI * 2);
    this.#context.fillStyle = "rgba(90,162,250,0.9)";
    this.#context.fill();
  }

  resize(): void { this.render(); }

  private xForWaypoint(index: number, width: number): number {
    const total = this.planning.projection.totalLength;
    const distance = this.planning.projection.distances[index] ?? 0;
    return PAD + (width - PAD * 2) * (total > 0 ? distance / total : 0);
  }

  private xForBucket(bucket: number, width: number): number {
    if (bucket >= this.planning.route.length) return width - PAD;
    return this.xForWaypoint(Math.max(0, bucket), width);
  }

  private scrub(clientX: number): void {
    const rect = this.dom.timelineCanvas.getBoundingClientRect();
    const amount = Math.max(0, Math.min(1, (clientX - rect.left - PAD) / Math.max(1, rect.width - PAD * 2)));
    this.planning.playback.setDistance(this.planning.projection.totalLength * amount);
  }

  private beginDrag(event: Readonly<PlanningMethodDrag>): void {
    if (getMode() !== "planning" || this.planning.route.length < 2) return;
    this.cancelDrag();
    const ghost = event.sourceElement.cloneNode(true) as HTMLElement;
    ghost.classList.add("planMethodDragGhost");
    document.body.appendChild(ghost);
    this.#activeDrag = { ...event, ghost, started: false };
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.#activeDrag;
    if (!drag) return;
    if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    drag.started = true;
    drag.ghost.style.left = `${event.clientX + 12}px`;
    drag.ghost.style.top = `${event.clientY + 12}px`;
    const rect = this.dom.timelineViewport.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      this.#drop = null;
    } else {
      const amount = Math.max(0, Math.min(1, (event.clientX - rect.left - PAD) / Math.max(1, rect.width - PAD * 2)));
      const distance = amount * this.planning.projection.totalLength;
      let bucket = this.planning.route.length;
      for (let index = 0; index < this.planning.projection.distances.length; index += 1) {
        if ((this.planning.projection.distances[index] ?? 0) >= distance) { bucket = index; break; }
      }
      const count = this.planning.timeline.nodes.filter((node) => node.beforeWaypoint === bucket && node.id !== drag.nodeId).length;
      this.#drop = { beforeWaypoint: bucket, index: count, x: event.clientX - rect.left + this.dom.timelineViewport.scrollLeft };
    }
    this.updateDropLine();
  }

  private finishDrag(): void {
    const drag = this.#activeDrag;
    const drop = this.#drop;
    if (drag?.started && drop) {
      const node = drag.source === "sidebar"
        ? this.planning.timeline.insert(drag.objectId, drag.methodId, drop.beforeWaypoint, drop.index)
        : drag.nodeId ? this.planning.timeline.move(drag.nodeId, drop.beforeWaypoint, drop.index) : null;
      if (node) {
        this.planning.selection.selectNode(node.id);
        const telemetry = drag.source === "sidebar" ? planningTelemetry.timelineNodeCreated : planningTelemetry.timelineNodeMoved;
        void telemetry.call(planningTelemetry, this.planning.telemetryProperties({ before_waypoint: node.beforeWaypoint, node_index: node.index }));
      }
    }
    this.cancelDrag();
  }

  private cancelDrag(): void {
    this.#activeDrag?.ghost.remove();
    this.#activeDrag = null;
    this.#drop = null;
    this.updateDropLine();
  }

  private updateDropLine(): void {
    this.dom.timelineDropLine.hidden = !this.#drop;
    if (this.#drop) this.dom.timelineDropLine.style.left = `${this.#drop.x}px`;
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

  private showTooltip(text: string, x: number, y: number, edited: boolean): void {
    this.hideTooltip();
    this.#tooltipTimer = window.setTimeout(() => {
      this.dom.nodeTooltip.textContent = text;
      this.dom.nodeTooltip.classList.toggle("isEdited", edited);
      this.dom.nodeTooltip.hidden = false;
      this.dom.nodeTooltip.classList.add("isVisible");
      this.positionTooltip(x, y);
    }, 250);
  }

  private positionTooltip(x: number, y: number): void {
    this.dom.nodeTooltip.style.left = `${x + 12}px`;
    this.dom.nodeTooltip.style.top = `${y + 12}px`;
  }

  private hideTooltip(): void {
    if (this.#tooltipTimer != null) window.clearTimeout(this.#tooltipTimer);
    this.#tooltipTimer = null;
    this.dom.nodeTooltip.classList.remove("isVisible");
    this.dom.nodeTooltip.hidden = true;
  }
}
