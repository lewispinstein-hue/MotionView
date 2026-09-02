import { captureScrollAnchor, restoreScrollAnchor } from "../scrollAnchor";
import type { ViewingListsDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import type { WaypointEventView, WaypointView } from "../viewingTypes";
import { escapeHtml, formatNumber } from "../viewingPresentation";
import { formatDistanceFromInches, getCurrentUnits } from "../../shared/units";

function eventStyle(type: string): Readonly<{ fill: string; text: string }> {
  if (type === "TIMEDOUT") return { fill: "rgba(255, 120, 120, 0.18)", text: "#ffb0b0" };
  if (type === "REACHED") return { fill: "rgba(120, 220, 150, 0.18)", text: "#b6ffd0" };
  return { fill: "rgba(255,255,255,0.12)", text: "#f7fbff" };
}

function eventLevel(event: WaypointEventView): "DEBUG" | "INFO" | "ERROR" {
  if (event.type === "TIMEDOUT") return "ERROR";
  if (event.type === "REACHED") return "INFO";
  return "DEBUG";
}

function eventLines(viewing: ViewingFeature, waypoint: WaypointView, event: WaypointEventView): string[] {
  if (event.type === "CREATED") {
    const params = event.params;
    const target = [`X: ${formatNumber(params.tarX)}`, `Y: ${formatNumber(params.tarY)}`];
    if (params.tarT != null) target.push(`θ: ${formatNumber(params.tarT)}`);
    const lines = [`Target: ${target.join(", ")}`];
    const tolerances: string[] = [];
    if (params.linearTol != null) tolerances.push(`Linear: ${formatNumber(params.linearTol)}`);
    if (params.thetaTol != null) tolerances.push(`Angular: ${formatNumber(params.thetaTol)}`);
    if (tolerances.length) lines.push(`Tolerances: ${tolerances.join(", ")}`);
    if (params.timeoutMs != null) lines.push(`Timeout: ${formatNumber(Number(params.timeoutMs) / 1000, 2)}s`);
    return lines;
  }
  if (event.type === "REACHED" || event.type === "TIMEDOUT") {
    const lines: string[] = [];
    if (event.params.remainingTime != null) lines.push(`Time Left: ${formatNumber(Number(event.params.remainingTime) / 1000, 2)}s`);
    const nearest = viewing.projection.nearestIndex(event.t, Number.POSITIVE_INFINITY);
    const pose = viewing.projection.interpolatePose(event.t) ?? (nearest ? viewing.projection.poseAt(nearest.index) : null);
    const target = viewing.projection.waypointTarget(waypoint);
    if (!pose) return [...lines, "Off Target: unavailable (no pose recorded)"];
    const offsetX = target.x - pose.x;
    const offsetY = target.y - pose.y;
    const distance = Math.hypot(offsetX, offsetY);
    const unit = getCurrentUnits();
    const thetaOffset = target.theta == null ? null : ((target.theta - pose.theta + 540) % 360) - 180;
    const angularOffset = thetaOffset == null ? "" : `, θ: ${formatNumber(thetaOffset, 2)}°`;
    lines.push(`Off Target: ${formatDistanceFromInches(distance, 2)} ${unit} (X: ${formatDistanceFromInches(offsetX, 2)}, Y: ${formatDistanceFromInches(offsetY, 2)}${angularOffset})`);
    return lines;
  }
  return [];
}

export class WaypointListView {
  #searchTerm = "";
  #itemCount = 0;
  readonly #eventKeys = new WeakMap<object, string>();
  #nextEventKey = 1;
  #previewEventKey: string | null = null;
  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingListsDom,
  ) {}

  bind(): void {
    this.dom.waypointSort.addEventListener("change", () => this.render());
  }

  get itemCount(): number { return this.#itemCount; }

  setSearch(value: string): void {
    this.#searchTerm = value.trim().toLocaleLowerCase();
  }

  filterMatches(_waypoint: WaypointView): boolean {
    // Sidebar list filters should not hide route geometry in the field or timeline.
    return true;
  }

  render(): void {
    const itemSelector = "#waypointList .watchItem";
    const anchor = this.dom.panels.waypoints.hidden ? null : captureScrollAnchor(
      this.dom.scrollContainer,
      itemSelector,
      (element) => `${element.dataset.waypointId}:${element.dataset.eventTime}`,
    );
    this.dom.waypointList.replaceChildren();
    const visible: Array<{ waypoint: WaypointView; event: WaypointEventView }> = [];
    for (const waypoint of this.viewing.data.waypoints) {
      for (const event of waypoint.events) {
        if (this.matchesLevel(event) && (!this.#searchTerm || `${waypoint.name ?? ""} ${event.type} ${eventLines(this.viewing, waypoint, event).join(" ")}`.toLocaleLowerCase().includes(this.#searchTerm))) {
          visible.push({ waypoint, event });
        }
      }
    }
    const mode = this.dom.waypointSort.value;
    visible.sort((left, right) => mode === "name"
      ? (left.waypoint.name || `Waypoint ${left.waypoint.id}`).localeCompare(right.waypoint.name || `Waypoint ${right.waypoint.id}`, undefined, { numeric: true })
      : mode === "active" ? Number(right.waypoint.active) - Number(left.waypoint.active) || right.event.t - left.event.t
      : mode === "-time" ? right.event.t - left.event.t : left.event.t - right.event.t);
    this.#itemCount = visible.length;
    for (const item of visible) this.dom.waypointList.appendChild(this.createItem(item.waypoint, item.event));
    this.highlight(false);
    restoreScrollAnchor(
      this.dom.scrollContainer,
      anchor,
      itemSelector,
      (element) => `${element.dataset.waypointId}:${element.dataset.eventTime}`,
    );
  }

  private matchesLevel(event: WaypointEventView): boolean {
    const filter = this.dom.levelFilter.value || "all";
    return filter === "all" || eventLevel(event) === filter;
  }

  highlight(scroll: boolean): void {
    for (const element of this.dom.waypointList.querySelectorAll(".watchItem")) element.classList.remove("selected");
    const event = this.viewing.navigation.selectedWaypointEvent;
    if (!event) return;
    const selected = this.dom.waypointList.querySelector(`.watchItem[data-waypoint-event-key="${CSS.escape(this.eventKeyFor(event))}"]`);
    selected?.classList.add("selected");
    if (scroll && selected) selected.scrollIntoView({ block: "nearest" });
  }

  setPreviewTime(time: number): void {
    let nearest: HTMLElement | null = null;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (const element of this.dom.waypointList.querySelectorAll<HTMLElement>(".watchItem")) {
      const timestamp = Number(element.dataset.eventTime);
      const delta = Math.abs(timestamp - time);
      if (!Number.isFinite(timestamp) || delta >= nearestDelta) continue;
      nearest = element;
      nearestDelta = delta;
    }
    this.#previewEventKey = nearest?.dataset.waypointEventKey ?? null;
    for (const element of this.dom.waypointList.querySelectorAll<HTMLElement>(".watchItem")) {
      element.classList.toggle("previewSelected", element.dataset.waypointEventKey === this.#previewEventKey);
    }
    nearest?.scrollIntoView({ block: "center" });
  }

  clearPreview(): void {
    if (!this.#previewEventKey) return;
    this.#previewEventKey = null;
    for (const element of this.dom.waypointList.querySelectorAll<HTMLElement>(".watchItem")) {
      element.classList.remove("previewSelected");
    }
  }

  private createItem(waypoint: WaypointView, event: WaypointEventView): HTMLElement {
    const style = eventStyle(event.type);
    const stateLabel = waypoint.retriggerable ? "RETRIGGERABLE" : waypoint.active ? "ACTIVE" : "INACTIVE";
    const stateFill = waypoint.retriggerable ? "rgba(0, 114, 176, 0.5)"
      : waypoint.active ? "rgba(0, 114, 176, 0.5)" : "rgba(211, 24, 24, 0.45)";
    const element = document.createElement("div");
    element.className = "watchItem";
    if (this.#previewEventKey === this.eventKeyFor(event)) element.classList.add("previewSelected");
    element.dataset.waypointId = String(waypoint.id);
    element.dataset.eventTime = String(event.t);
    element.dataset.waypointEventKey = this.eventKeyFor(event);
    element.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="pill waypointPill" style="background:${stateFill};color:#e7f2ff">${stateLabel}</span>
        <span class="pill waypointPill" style="background:${style.fill};color:${style.text}">${escapeHtml(event.type)}</span>
        <span class="eventSelectableText" style="font-weight:850;word-break:break-word">${escapeHtml(waypoint.name || `Waypoint ${waypoint.id}`)}</span>
        <div class="subValue" style="margin-top:0!important"></div>
      </div><div class="muted"><span class="eventSelectableText">${formatNumber(event.t / 1000, 2)}s</span></div>
    </div>${eventLines(this.viewing, waypoint, event).map((line) => `<div class="waypointValue"><span class="eventSelectableText">${escapeHtml(line)}</span></div>`).join("")}`;
    element.addEventListener("pointerenter", () => {
      this.viewing.navigation.setHoveredWaypoint(waypoint);
      if (!this.viewing.playback.isPlaying) this.viewing.navigation.setTimelineHover(event.t);
    });
    element.addEventListener("pointerleave", () => {
      if (String(this.viewing.navigation.hoveredWaypointId) === String(waypoint.id)) {
        this.viewing.navigation.setHoveredWaypoint(null);
      }
      if (this.viewing.navigation.hoverTimelineTime === event.t) this.viewing.navigation.setTimelineHover(null);
    });
    const selectWaypoint = () => {
      if (this.viewing.navigation.selectedWaypointEvent === event) {
        this.viewing.navigation.clearWaypointSelection();
        return;
      }
      this.viewing.playback.pause();
      this.viewing.navigation.setTimelineHover(null);
      this.viewing.navigation.selectWaypoint(waypoint, event);
      const poseIndex = this.viewing.projection.waypointPoseIndex(waypoint, event.t);
      if (poseIndex != null) this.viewing.navigation.selectPose(poseIndex, { preserveDetails: true });
      this.highlight(true);
    };
    element.addEventListener("pointerdown", (pointerEvent) => {
      if (pointerEvent.button !== 0 || (pointerEvent.target instanceof Element && pointerEvent.target.closest(".eventSelectableText"))) return;
      pointerEvent.preventDefault();
      selectWaypoint();
    }, { passive: false });
    element.addEventListener("click", (clickEvent) => {
      if (!(clickEvent.target instanceof Element) || !clickEvent.target.closest(".eventSelectableText") || window.getSelection()?.toString()) return;
      selectWaypoint();
    });
    return element;
  }

  private eventKeyFor(event: Readonly<WaypointEventView>): string {
    const object = event as object;
    let key = this.#eventKeys.get(object);
    if (!key) {
      key = `waypoint-event:${this.#nextEventKey}`;
      this.#nextEventKey += 1;
      this.#eventKeys.set(object, key);
    }
    return key;
  }
}
