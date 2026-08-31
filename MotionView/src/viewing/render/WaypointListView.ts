import { captureScrollAnchor, restoreScrollAnchor } from "../scrollAnchor";
import type { ViewingListsDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import type { WaypointEventView, WaypointView } from "../viewingTypes";
import { escapeHtml, formatNumber } from "../viewingPresentation";

function eventStyle(type: string): Readonly<{ fill: string; text: string }> {
  if (type === "TIMEDOUT") return { fill: "rgba(255, 120, 120, 0.18)", text: "#ffb0b0" };
  if (type === "REACHED") return { fill: "rgba(120, 220, 150, 0.18)", text: "#b6ffd0" };
  return { fill: "rgba(255,255,255,0.12)", text: "#f7fbff" };
}

function eventLines(event: WaypointEventView): string[] {
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
    lines.push(`Retriggerable: ${params.retriggerable ? "Yes" : "No"}`);
    return lines;
  }
  if (event.type === "REACHED" && event.params.remainingTime != null) {
    return [`Time Left: ${formatNumber(Number(event.params.remainingTime) / 1000, 2)}s`];
  }
  return [];
}

export class WaypointListView {
  #searchTerm = "";
  #itemCount = 0;
  readonly #eventKeys = new WeakMap<object, string>();
  #nextEventKey = 1;
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
    // The shared sidebar search only narrows its list; it should not hide route
    // geometry in the field or timeline.
    return true;
  }

  render(): void {
    const anchor = captureScrollAnchor(this.dom.waypointList, ".watchItem", (element) => `${element.dataset.waypointId}:${element.dataset.eventTime}`);
    this.dom.waypointList.replaceChildren();
    const visible: Array<{ waypoint: WaypointView; event: WaypointEventView }> = [];
    for (const waypoint of this.viewing.data.waypoints) {
      for (const event of waypoint.events) {
        if (!this.#searchTerm || `${waypoint.name ?? ""} ${event.type} ${eventLines(event).join(" ")}`.toLocaleLowerCase().includes(this.#searchTerm)) {
          visible.push({ waypoint, event });
        }
      }
    }
    const mode = this.dom.waypointSort.value;
    visible.sort((left, right) => mode === "name"
      ? (left.waypoint.name || `Waypoint ${left.waypoint.id}`).localeCompare(right.waypoint.name || `Waypoint ${right.waypoint.id}`, undefined, { numeric: true })
      : mode === "-time" ? right.event.t - left.event.t : left.event.t - right.event.t);
    this.#itemCount = visible.length;
    for (const item of visible) this.dom.waypointList.appendChild(this.createItem(item.waypoint, item.event));
    this.highlight(false);
    restoreScrollAnchor(this.dom.waypointList, anchor, ".watchItem", (element) => `${element.dataset.waypointId}:${element.dataset.eventTime}`);
  }

  highlight(scroll: boolean): void {
    for (const element of this.dom.waypointList.querySelectorAll(".watchItem")) element.classList.remove("selected");
    const event = this.viewing.navigation.selectedWaypointEvent;
    if (!event) return;
    const selected = this.dom.waypointList.querySelector(`.watchItem[data-waypoint-event-key="${CSS.escape(this.eventKeyFor(event))}"]`);
    selected?.classList.add("selected");
    if (scroll && selected) selected.scrollIntoView({ block: "nearest" });
  }

  private createItem(waypoint: WaypointView, event: WaypointEventView): HTMLElement {
    const style = eventStyle(event.type);
    const stateLabel = waypoint.retriggerable ? "RETRIGGERABLE" : waypoint.active ? "ACTIVE" : "INACTIVE";
    const stateFill = waypoint.retriggerable ? "rgba(0, 114, 176, 0.5)"
      : waypoint.active ? "rgba(0, 114, 176, 0.5)"
        : waypoint.terminalEvent?.type === "REACHED" ? "rgba(22, 183, 70, 0.4)" : "rgba(211, 24, 24, 0.45)";
    const element = document.createElement("div");
    element.className = "watchItem";
    element.dataset.waypointId = String(waypoint.id);
    element.dataset.eventTime = String(event.t);
    element.dataset.waypointEventKey = this.eventKeyFor(event);
    element.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="pill" style="background:${stateFill};color:#e7f2ff">${stateLabel}</span>
        <span class="pill" style="background:${style.fill};color:${style.text}">${escapeHtml(event.type)}</span>
        <span class="eventSelectableText" style="font-weight:850;word-break:break-word">${escapeHtml(waypoint.name || `Waypoint ${waypoint.id}`)}</span>
        <div class="subValue" style="margin-top:0!important"><span class="eventSelectableText">(Id: ${waypoint.id})</span></div>
      </div><div class="muted"><span class="eventSelectableText">${formatNumber(event.t / 1000, 2)}s</span></div>
    </div>${eventLines(event).map((line) => `<div class="waypointValue"><span class="eventSelectableText">${escapeHtml(line)}</span></div>`).join("")}`;
    element.addEventListener("pointerenter", () => {
      if (!this.viewing.playback.isPlaying) this.viewing.navigation.setTimelineHover(event.t);
    });
    element.addEventListener("pointerleave", () => {
      if (this.viewing.navigation.hoverTimelineTime === event.t) this.viewing.navigation.setTimelineHover(null);
    });
    const selectWaypoint = () => {
      if (this.viewing.navigation.selectedWaypointEvent === event) {
        this.viewing.navigation.clearDetails();
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
