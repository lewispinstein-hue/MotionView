import { captureScrollAnchor, restoreScrollAnchor } from "./scrollAnchor";

export interface WaypointListRendererDependencies {
  waypointList: HTMLElement | null;
  waypointCount: HTMLElement | null;
  waypointFilter: HTMLSelectElement | null;
  getWaypoints(): any[];
  getVisibleEvents(): Array<{ waypoint: any; event: any }>;
  getSelectedWaypointId(): unknown;
  getSelectedWaypointEventTime(): unknown;
  waypointTypeStyle(type: unknown): { fill: string; text: string };
  waypointEventLines(event: any): string[];
  fmtSecondsToString(ms: unknown): string | null;
  escapeHtml(value: unknown): string;
  scrollIntoViewIfNeeded(container: HTMLElement | null, element: Element | null, pad?: number): void;
  onWaypointEventSelected(waypoint: any, event: any): void;
}

export interface WaypointListRenderer {
  renderFilter(): void;
  renderList(): void;
  highlight(waypointId: unknown, eventTime: unknown, doScroll: boolean): void;
}

export function createWaypointListRenderer(deps: WaypointListRendererDependencies): WaypointListRenderer {
  function renderFilter() {
    if (!deps.waypointFilter) return;
    const current = deps.waypointFilter.value || "all";
    deps.waypointFilter.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All";
    deps.waypointFilter.appendChild(allOption);

    const activeOption = document.createElement("option");
    activeOption.value = "active";
    activeOption.textContent = "Active";
    deps.waypointFilter.appendChild(activeOption);

    for (const waypoint of deps.getWaypoints()) {
      const option = document.createElement("option");
      option.value = String(waypoint.id);
      option.textContent = waypoint.name || `Waypoint ${waypoint.id}`;
      deps.waypointFilter.appendChild(option);
    }

    const nextValue = Array.from(deps.waypointFilter.options).some((option) => option.value === current) ? current : "all";
    deps.waypointFilter.value = nextValue;
  }

  function highlight(waypointId: unknown, eventTime: unknown, doScroll: boolean) {
    if (!deps.waypointList) return;
    const items = deps.waypointList.querySelectorAll(".watchItem");
    items.forEach((element) => element.classList.remove("selected"));
    if (waypointId == null) return;

    let selector = `.watchItem[data-waypoint-id="${CSS.escape(String(waypointId))}"]`;
    if (eventTime != null) selector += `[data-event-time="${CSS.escape(String(eventTime))}"]`;
    let element = deps.waypointList.querySelector(selector);
    if (!element) element = deps.waypointList.querySelector(`.watchItem[data-waypoint-id="${CSS.escape(String(waypointId))}"]`);
    if (element) {
      element.classList.add("selected");
      if (doScroll) requestAnimationFrame(() => deps.scrollIntoViewIfNeeded(deps.waypointList, element, 12));
    }
  }

  function renderList() {
    if (!deps.waypointList || !deps.waypointCount) return;
    const scrollAnchor = captureScrollAnchor(
      deps.waypointList,
      ".watchItem",
      (element) => `${element.dataset.waypointId ?? ""}:${element.dataset.eventTime ?? ""}`,
    );
    deps.waypointList.innerHTML = "";

    const visible = deps.getVisibleEvents();
    deps.waypointCount.textContent = `${visible.length}`;

    const activeBackground = "rgba(0, 114, 176, 0.5)";
    const timedOutBackground = "rgba(211, 24, 24, 0.45)";
    const reachedBackground = "rgba(22, 183, 70, 0.4)";

    for (const { waypoint, event } of visible) {
      const div = document.createElement("div");
      div.className = "watchItem";
      div.dataset.waypointId = String(waypoint.id);
      div.dataset.eventTime = String(event.t);
      const stateLabel = waypoint.retriggerable ? "RETRIGGERABLE" : (waypoint.active ? "ACTIVE" : "INACTIVE");
      const stateFill = waypoint.retriggerable
        ? ((waypoint.terminalEvent?.type === "TIMEDOUT") ? timedOutBackground : activeBackground)
        : (waypoint.active ? activeBackground : (waypoint.terminalEvent?.type === "REACHED" ? reachedBackground : timedOutBackground));
      const stateText = waypoint.retriggerable
        ? "#f1e7ff"
        : (waypoint.active ? "#e7f2ff" : "#d5e3f3ff");
      const eventStyle = deps.waypointTypeStyle(event.type);
      const detailsHtml = deps.waypointEventLines(event)
        .map((line) => `<div class="waypointValue">${deps.escapeHtml(line)}</div>`)
        .join("");
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="pill" style="background:${stateFill};color:${stateText}">${deps.escapeHtml(stateLabel)}</span>
            <span class="pill" style="background:${eventStyle.fill};color:${eventStyle.text}">${deps.escapeHtml(event.type)}</span>
            <span style="font-weight:850;word-break:break-word">${deps.escapeHtml(waypoint.name || `Waypoint ${waypoint.id}`)}</span>
            <div class="subValue" style="margin-top: 0px !important;">(Id: ${deps.escapeHtml(String(waypoint.id))})</div>
          </div>
          <div class="muted">${deps.fmtSecondsToString(event.t) || "—"}</div>
        </div>
        ${detailsHtml}
      `;
      div.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        deps.onWaypointEventSelected(waypoint, event);
      }, { passive: false });
      deps.waypointList.appendChild(div);
    }

    if (deps.getSelectedWaypointId() != null) {
      highlight(deps.getSelectedWaypointId(), deps.getSelectedWaypointEventTime(), false);
    }
    restoreScrollAnchor(
      deps.waypointList,
      scrollAnchor,
      ".watchItem",
      (element) => `${element.dataset.waypointId ?? ""}:${element.dataset.eventTime ?? ""}`,
    );
  }

  return {
    renderFilter,
    renderList,
    highlight,
  };
}
