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
  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingListsDom,
  ) {}

  bind(): void {
    this.dom.waypointFilter.addEventListener("change", () => this.render());
  }

  filterMatches(waypoint: WaypointView): boolean {
    const filter = this.dom.waypointFilter.value || "all";
    return filter === "all" || (filter === "active" ? waypoint.active : String(waypoint.id) === filter);
  }

  renderFilter(): void {
    const current = this.dom.waypointFilter.value || "all";
    this.dom.waypointFilter.replaceChildren();
    for (const [value, label] of [["all", "All"], ["active", "Active"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      this.dom.waypointFilter.appendChild(option);
    }
    for (const waypoint of this.viewing.data.waypoints) {
      const option = document.createElement("option");
      option.value = String(waypoint.id);
      option.textContent = waypoint.name || `Waypoint ${waypoint.id}`;
      this.dom.waypointFilter.appendChild(option);
    }
    this.dom.waypointFilter.value = Array.from(this.dom.waypointFilter.options).some((option) => option.value === current)
      ? current : "all";
  }

  render(): void {
    const anchor = captureScrollAnchor(this.dom.waypointList, ".watchItem", (element) => `${element.dataset.waypointId}:${element.dataset.eventTime}`);
    this.dom.waypointList.replaceChildren();
    const visible: Array<{ waypoint: WaypointView; event: WaypointEventView }> = [];
    for (const waypoint of this.viewing.data.waypoints) {
      if (!this.filterMatches(waypoint)) continue;
      for (const event of waypoint.events) visible.push({ waypoint, event });
    }
    visible.sort((left, right) => left.event.t - right.event.t);
    this.dom.waypointCount.textContent = String(visible.length);
    for (const item of visible) this.dom.waypointList.appendChild(this.createItem(item.waypoint, item.event));
    this.highlight(false);
    restoreScrollAnchor(this.dom.waypointList, anchor, ".watchItem", (element) => `${element.dataset.waypointId}:${element.dataset.eventTime}`);
  }

  highlight(scroll: boolean): void {
    for (const element of this.dom.waypointList.querySelectorAll(".watchItem")) element.classList.remove("selected");
    const id = this.viewing.navigation.selectedWaypointId;
    if (id == null) return;
    const eventTime = this.viewing.navigation.selectedWaypointEventTime;
    const selector = `.watchItem[data-waypoint-id="${CSS.escape(String(id))}"]${eventTime == null ? "" : `[data-event-time="${CSS.escape(String(eventTime))}"]`}`;
    const selected = this.dom.waypointList.querySelector(selector)
      ?? this.dom.waypointList.querySelector(`.watchItem[data-waypoint-id="${CSS.escape(String(id))}"]`);
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
    element.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="pill" style="background:${stateFill};color:#e7f2ff">${stateLabel}</span>
        <span class="pill" style="background:${style.fill};color:${style.text}">${escapeHtml(event.type)}</span>
        <span style="font-weight:850;word-break:break-word">${escapeHtml(waypoint.name || `Waypoint ${waypoint.id}`)}</span>
        <div class="subValue" style="margin-top:0!important">(Id: ${waypoint.id})</div>
      </div><div class="muted">${formatNumber(event.t / 1000, 2)}s</div>
    </div>${eventLines(event).map((line) => `<div class="waypointValue">${escapeHtml(line)}</div>`).join("")}`;
    element.addEventListener("pointerdown", (pointerEvent) => {
      if (pointerEvent.button !== 0) return;
      pointerEvent.preventDefault();
      this.viewing.playback.pause();
      this.viewing.navigation.selectWaypoint(waypoint, event);
      const poseIndex = this.viewing.projection.waypointPoseIndex(waypoint, event.t);
      if (poseIndex != null) this.viewing.navigation.selectPose(poseIndex, { preserveDetails: true });
      this.highlight(true);
    }, { passive: false });
    return element;
  }
}
