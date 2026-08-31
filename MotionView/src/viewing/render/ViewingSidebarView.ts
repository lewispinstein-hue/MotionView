import type { ViewingListsDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import { LogListView } from "./LogListView";
import { PoseListView } from "./PoseListView";
import { WatchListView } from "./WatchListView";
import { WaypointListView } from "./WaypointListView";
import type { FloatingInfoView } from "./FloatingInfoView";
import type { WatchGraphView } from "./WatchGraphView";

type SidebarSection = "watches" | "logs" | "waypoints" | "poses";

/** Owns the four virtualized Viewing lists and their coordinated updates. */
export class ViewingSidebarView {
  readonly poses: PoseListView;
  readonly logs: LogListView;
  readonly watches: WatchListView;
  readonly waypoints: WaypointListView;
  #activeSection: SidebarSection = "watches";
  #searchTerm = "";

  constructor(
    viewing: ViewingFeature,
    private readonly dom: ViewingListsDom,
    private readonly floatingInfo: FloatingInfoView,
    private readonly watchGraph: WatchGraphView,
  ) {
    this.poses = new PoseListView(viewing, dom);
    this.logs = new LogListView(viewing, dom);
    this.watches = new WatchListView(viewing, dom, floatingInfo, watchGraph);
    this.waypoints = new WaypointListView(viewing, dom);
  }

  bind(): void {
    this.logs.bind();
    this.watches.bind();
    this.waypoints.bind();
    this.poses.bind();
    this.floatingInfo.onPinnedWatchChanged(() => this.watches.render());
    this.watchGraph.onStateChanged(() => this.watches.render());
    const sortControls = [this.dom.watchSort, this.dom.logSort, this.dom.waypointSort, this.dom.poseSort];
    for (const control of sortControls) {
      control.addEventListener("change", () => this.syncSharedTimeSort(control, sortControls));
    }
    for (const control of [this.dom.watchFilter, ...sortControls]) {
      control.addEventListener("change", () => this.refreshCounts());
    }
    for (const tab of this.dom.sectionTabs) {
      tab.addEventListener("click", () => this.setActiveSection(tab.dataset.viewingSection as SidebarSection));
    }
    this.dom.search.addEventListener("input", () => {
      this.#searchTerm = this.dom.search.value;
      this.watches.setSearch(this.#searchTerm);
      this.logs.setSearch(this.#searchTerm);
      this.waypoints.setSearch(this.#searchTerm);
      this.watches.render();
      this.logs.render();
      this.waypoints.render();
      this.updateCounts();
    });
    this.setActiveSection("watches");
  }

  render(): void {
    this.watches.renderFilter();
    this.watches.render();
    this.logs.render();
    this.waypoints.render();
    this.poses.render();
    this.updateCounts();
  }

  highlight(): void {
    this.poses.highlight();
    this.watches.highlight();
    this.logs.highlight();
    this.waypoints.highlight(false);
  }

  refreshCounts(): void {
    this.updateCounts();
  }

  private syncSharedTimeSort(source: HTMLSelectElement, controls: readonly HTMLSelectElement[]): void {
    if (source.value !== "time" && source.value !== "-time") return;
    for (const control of controls) {
      if (control === source || !Array.from(control.options).some((option) => option.value === source.value)) continue;
      control.value = source.value;
    }
    this.watches.render();
    this.logs.render();
    this.waypoints.render();
    this.poses.render();
  }

  private setActiveSection(section: SidebarSection): void {
    if (!(["watches", "logs", "waypoints", "poses"] as const).includes(section)) return;
    this.#activeSection = section;
    for (const tab of this.dom.sectionTabs) {
      const active = tab.dataset.viewingSection === section;
      tab.classList.toggle("isActive", active);
      tab.setAttribute("aria-selected", String(active));
    }
    for (const [name, panel] of Object.entries(this.dom.panels) as Array<[SidebarSection, HTMLElement]>) {
      panel.hidden = name !== section;
    }
    const searchable = section !== "poses";
    this.dom.searchWrap.hidden = !searchable;
    this.dom.search.value = this.#searchTerm;
    this.dom.search.placeholder = section === "watches" ? "Search watches…"
      : section === "logs" ? "Search logs…" : "Search waypoints…";
    this.dom.search.setAttribute("aria-label", section === "watches" ? "Search watches by label or value"
      : section === "logs" ? "Search logs" : "Search waypoint events");
    this.dom.watchFilter.disabled = section !== "watches";
    this.dom.watchFilter.hidden = false;
    this.dom.watchSort.hidden = section !== "watches";
    this.dom.logSort.hidden = section !== "logs";
    this.dom.waypointSort.hidden = section !== "waypoints";
    this.dom.poseSort.hidden = section !== "poses";
    this.updateCounts();
  }

  private updateCounts(): void {
    this.dom.watchTabCount.textContent = String(this.watches.itemCount);
    this.dom.logTabCount.textContent = String(this.logs.itemCount);
    this.dom.waypointTabCount.textContent = String(this.waypoints.itemCount);
    this.dom.poseTabCount.textContent = String(this.poses.itemCount);
    const count = this.#activeSection === "watches" ? this.watches.itemCount
      : this.#activeSection === "logs" ? this.logs.itemCount
        : this.#activeSection === "waypoints" ? this.waypoints.itemCount : this.poses.itemCount;
    this.dom.searchCount.textContent = String(count);
  }
}
