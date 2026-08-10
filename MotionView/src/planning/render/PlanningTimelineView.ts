import { getMode } from "../../app/modeController";
import { requestDrawAll } from "../../render/renderScheduler";
import { planningTelemetry } from "../../telemetry/createTelemetry";
import type { PlanningDialogs } from "../PlanningDialogs";
import type { PlanningDom } from "../PlanningDom";
import type { PlanningFeature } from "../PlanningFeature";
import type { PlanningNodeView } from "../planningTypes";
import { getPlanMethodNumber, getPlanNodeEffectiveMethod, hasPlanNodeMethodOverride } from "../planningObjects";
import { getContrastTextColor, getDefaultPlanObjectColor } from "../planningState";
import { getUtf8ByteLength } from "../planningTemplate";
import type { PlanningMethodDrag, PlanningDragCoordinator } from "./PlanningDragCoordinator";

const PAD = 6;
const NODE_WIDTH = 18;
const NODE_GAP = 6;
const NODE_SLOT = NODE_WIDTH + NODE_GAP;
const NODE_START_OFFSET = 18;
const NODE_END_OFFSET = 18;
const EDGE_INSET = 14;
const INSERT_HALF = (NODE_WIDTH + NODE_GAP) / 2;
const WAYPOINT_MIN_GAP = 48;

interface TimelineBucketLayout {
  readonly beforeWaypoint: number;
  readonly start: number;
  readonly end: number;
  readonly nodeStart: number;
  readonly nodes: readonly PlanningNodeView[];
}

interface TimelineLayout {
  readonly contentWidth: number;
  readonly waypointX: readonly number[];
  readonly buckets: readonly TimelineBucketLayout[];
}

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
  #layout: TimelineLayout | null = null;
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
    const layout = this.buildLayout(nodes);
    this.#layout = layout;
    this.dom.timelineNodeLayer.replaceChildren();
    this.dom.timelineWaypointLayer.replaceChildren();
    this.dom.eventTimelineHint.hidden = this.planning.route.length >= 2;
    this.dom.timelineContent.style.width = `${layout.contentWidth}px`;
    this.planning.route.waypoints.forEach((_point, index) => {
      const marker = document.createElement("div");
      marker.className = "planningTimelineWaypointConnector";
      marker.style.left = `${layout.waypointX[index] ?? PAD}px`;
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
      const bucket = layout.buckets[node.beforeWaypoint];
      if (!bucket) continue;
      element.style.left = `${bucket.nodeStart + node.index * NODE_SLOT}px`;
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
    const layout = this.#layout ?? this.buildLayout([...this.planning.timeline.nodes]);
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
    const startX = layout.waypointX[0] ?? PAD + EDGE_INSET;
    const endX = layout.waypointX.at(-1) ?? rect.width - PAD - EDGE_INSET;
    this.#context.moveTo(startX, y);
    this.#context.lineTo(endX, y);
    this.#context.stroke();
    const progress = this.xForDistance(this.planning.playback.distance, layout);
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

  private scrub(clientX: number): void {
    const rect = this.dom.timelineCanvas.getBoundingClientRect();
    this.planning.playback.setDistance(this.distanceForX(clientX - rect.left, this.#layout ?? this.buildLayout([...this.planning.timeline.nodes])));
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
      this.#drop = this.dropTarget(event.clientX);
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

  private buildLayout(nodes: readonly PlanningNodeView[]): TimelineLayout {
    const waypointCount = this.planning.route.length;
    const viewportWidth = Math.max(1, this.dom.timelineViewport.clientWidth || this.dom.timelineViewport.getBoundingClientRect().width || 1);
    const baseContentWidth = Math.max(
      viewportWidth,
      PAD * 2 + EDGE_INSET * 2 + Math.max(0, waypointCount - 1) * WAYPOINT_MIN_GAP,
      PAD * 2 + 120,
    );
    const buckets = Array.from({ length: waypointCount + 1 }, (_, beforeWaypoint) => ({
      beforeWaypoint,
      nodes: nodes.filter((node) => node.beforeWaypoint === beforeWaypoint).sort((a, b) => a.index - b.index || a.id.localeCompare(b.id)),
    }));
    const total = this.planning.projection.totalLength;
    const baseWaypointX = Array.from({ length: waypointCount }, (_, index) => {
      if (waypointCount === 1) return PAD + EDGE_INSET;
      const ratio = total > 0
        ? (this.planning.projection.distances[index] ?? 0) / total
        : index / Math.max(1, waypointCount - 1);
      return PAD + EDGE_INSET + (baseContentWidth - PAD * 2 - EDGE_INSET * 2) * ratio;
    });
    const baseWidths = waypointCount
      ? [
          Math.max(0, (baseWaypointX[0] ?? PAD) - PAD),
          ...baseWaypointX.slice(1).map((x, index) => Math.max(0, x - (baseWaypointX[index] ?? x))),
          Math.max(0, baseContentWidth - PAD - (baseWaypointX.at(-1) ?? PAD)),
        ]
      : [baseContentWidth - PAD * 2];
    const widths = baseWidths.map((width, beforeWaypoint) => {
      const count = buckets[beforeWaypoint]?.nodes.length ?? 0;
      if (!count || !waypointCount) return width;
      const needed = NODE_START_OFFSET + NODE_WIDTH + (count - 1) * NODE_SLOT
        + (beforeWaypoint > 0 && beforeWaypoint < waypointCount ? NODE_END_OFFSET : 0);
      return Math.max(width, needed);
    });
    const waypointX: number[] = [];
    let cursor = PAD;
    for (let index = 0; index < waypointCount; index += 1) {
      cursor += widths[index] ?? 0;
      waypointX.push(cursor);
    }
    cursor += widths[waypointCount] ?? 0;
    const contentWidth = Math.max(viewportWidth, cursor + PAD);
    const layouts = buckets.map((bucket, beforeWaypoint): TimelineBucketLayout => {
      const start = beforeWaypoint === 0 ? PAD : waypointX[beforeWaypoint - 1] ?? PAD;
      const width = widths[beforeWaypoint] ?? 0;
      return {
        beforeWaypoint,
        start,
        end: start + width,
        nodeStart: start + (beforeWaypoint === 0 ? 10 : NODE_START_OFFSET),
        nodes: bucket.nodes,
      };
    });
    return { contentWidth, waypointX, buckets: layouts };
  }

  private dropTarget(clientX: number): Readonly<{ beforeWaypoint: number; index: number; x: number }> | null {
    const layout = this.#layout ?? this.buildLayout([...this.planning.timeline.nodes]);
    if (this.planning.route.length < 2) return null;
    const innerRect = this.dom.eventTimelineInner.getBoundingClientRect();
    const x = Math.max(PAD, Math.min(layout.contentWidth - PAD, clientX - innerRect.left));
    let bucket: TimelineBucketLayout | null = layout.buckets[0] ?? null;
    if (layout.waypointX.length && x > (layout.waypointX.at(-1) ?? 0)) bucket = layout.buckets.at(-1) ?? null;
    else if (layout.waypointX.length && x >= layout.waypointX[0]!) {
      bucket = layout.buckets.slice(1, -1).find((candidate) => x <= candidate.end) ?? layout.buckets[1] ?? bucket;
    }
    if (!bucket) return null;
    const dragId = this.#activeDrag?.nodeId;
    const count = bucket.nodes.filter((node) => node.id !== dragId).length;
    const local = x - bucket.nodeStart;
    const index = Math.max(0, Math.min(count, count ? Math.floor((local + NODE_SLOT / 2) / NODE_SLOT) : 0));
    const lineX = Math.max(PAD + 2, Math.min(layout.contentWidth - PAD - 2, bucket.nodeStart + index * NODE_SLOT - INSERT_HALF));
    return { beforeWaypoint: bucket.beforeWaypoint, index, x: lineX };
  }

  private xForDistance(distance: number, layout: TimelineLayout): number {
    const distances = this.planning.projection.distances;
    if (!layout.waypointX.length) return PAD + EDGE_INSET;
    const total = this.planning.projection.totalLength;
    const clamped = Math.max(0, Math.min(total, distance));
    if (clamped <= 0) return layout.waypointX[0]!;
    if (clamped >= total) return layout.waypointX.at(-1)!;
    for (let index = 1; index < distances.length; index += 1) {
      const end = distances[index] ?? 0;
      if (clamped > end) continue;
      const start = distances[index - 1] ?? 0;
      const ratio = end > start ? (clamped - start) / (end - start) : 1;
      return (layout.waypointX[index - 1] ?? 0) + ((layout.waypointX[index] ?? 0) - (layout.waypointX[index - 1] ?? 0)) * ratio;
    }
    return layout.waypointX.at(-1)!;
  }

  private distanceForX(x: number, layout: TimelineLayout): number {
    const waypointX = layout.waypointX;
    const distances = this.planning.projection.distances;
    if (!waypointX.length || x <= waypointX[0]!) return 0;
    if (x >= waypointX.at(-1)!) return this.planning.projection.totalLength;
    for (let index = 1; index < waypointX.length; index += 1) {
      const endX = waypointX[index] ?? 0;
      if (x > endX) continue;
      const startX = waypointX[index - 1] ?? 0;
      const ratio = endX > startX ? (x - startX) / (endX - startX) : 1;
      const start = distances[index - 1] ?? 0;
      return start + ((distances[index] ?? start) - start) * ratio;
    }
    return this.planning.projection.totalLength;
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
      this.dom.nodeTooltip.classList.toggle("hasOverride", edited);
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
