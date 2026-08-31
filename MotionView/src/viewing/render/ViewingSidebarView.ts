import type { ViewingListsDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import { LogListView } from "./LogListView";
import { PoseListView } from "./PoseListView";
import { WatchListView } from "./WatchListView";
import { WaypointListView } from "./WaypointListView";
import type { FloatingInfoView } from "./FloatingInfoView";
import type { WatchGraphView } from "./WatchGraphView";

type SidebarSection = "watches" | "logs" | "waypoints" | "poses";

interface ShiftSyncSession {
  committed: boolean;
  readonly initialScrollPositions: Partial<Record<SidebarSection, number>>;
}

interface SidebarTabDrag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startScrollLeft: number;
  moved: boolean;
}

/** Owns the four virtualized Viewing lists and their coordinated updates. */
export class ViewingSidebarView {
  readonly poses: PoseListView;
  readonly logs: LogListView;
  readonly watches: WatchListView;
  readonly waypoints: WaypointListView;
  #activeSection: SidebarSection = "watches";
  #searchTerm = "";
  #sharedTimeSort: "time" | "-time" = "-time";
  #shiftHeld = false;
  #shiftSync: ShiftSyncSession | null = null;
  #handledSidebarSyncCommitId = 0;
  #tabDrag: SidebarTabDrag | null = null;
  #suppressTabClick = false;
  readonly #scrollPositions: Record<SidebarSection, number> = { watches: 0, logs: 0, waypoints: 0, poses: 0 };
  readonly #scrollRestoreGenerations: Record<SidebarSection, number> = { watches: 0, logs: 0, waypoints: 0, poses: 0 };

  constructor(
    private readonly viewing: ViewingFeature,
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
    for (const control of sortControls) control.value = this.#sharedTimeSort;
    for (const control of sortControls) {
      control.addEventListener("change", () => this.syncSharedTimeSort(control, sortControls));
    }
    for (const control of [this.dom.watchFilter, ...sortControls]) {
      control.addEventListener("change", () => this.refreshCounts());
    }
    for (const tab of this.dom.sectionTabs) {
      tab.addEventListener("click", () => this.setActiveSection(tab.dataset.viewingSection as SidebarSection));
    }
    this.bindSectionGrabScroll();
    this.dom.scrollContainer.addEventListener("scroll", () => {
      this.#scrollPositions[this.#activeSection] = this.dom.scrollContainer.scrollTop;
    }, { passive: true });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Shift") return;
      this.#shiftHeld = true;
      this.startShiftSync();
    });
    window.addEventListener("keyup", (event) => {
      if (event.key !== "Shift") return;
      this.#shiftHeld = false;
      this.finishShiftSync();
    });
    window.addEventListener("blur", () => {
      this.#shiftHeld = false;
      this.finishShiftSync();
    });
    this.viewing.events.navigationChanged.subscribe(({ kind }) => this.handleNavigationChanged(kind));
    this.dom.search.addEventListener("input", () => {
      this.#searchTerm = this.dom.search.value;
      this.watches.setSearch(this.#searchTerm);
      this.logs.setSearch(this.#searchTerm);
      this.waypoints.setSearch(this.#searchTerm);
      this.watches.render();
      this.logs.render();
      this.waypoints.render();
      this.poses.render();
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

  private bindSectionGrabScroll(): void {
    const scroller = this.dom.sectionScroller;
    scroller.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.pointerType !== "mouse") return;
      this.#tabDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScrollLeft: scroller.scrollLeft,
        moved: false,
      };
      scroller.setPointerCapture(event.pointerId);
    });
    scroller.addEventListener("pointermove", (event) => {
      const drag = this.#tabDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const distance = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(distance) < 4) return;
      drag.moved = true;
      scroller.scrollLeft = drag.startScrollLeft - distance;
      scroller.classList.add("isDragging");
      event.preventDefault();
    });
    const finishDrag = (event: PointerEvent) => {
      const drag = this.#tabDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      this.#tabDrag = null;
      scroller.classList.remove("isDragging");
      try { scroller.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      if (drag.moved && event.type === "pointerup") this.#suppressTabClick = true;
    };
    scroller.addEventListener("pointerup", finishDrag);
    scroller.addEventListener("pointercancel", finishDrag);
    scroller.addEventListener("click", (event) => {
      if (!this.#suppressTabClick) return;
      this.#suppressTabClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  private syncSharedTimeSort(source: HTMLSelectElement, controls: readonly HTMLSelectElement[]): void {
    if (source.value !== "time" && source.value !== "-time") return;
    this.#sharedTimeSort = source.value;
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
    this.#scrollPositions[this.#activeSection] = this.dom.scrollContainer.scrollTop;
    this.#activeSection = section;
    for (const tab of this.dom.sectionTabs) {
      const active = tab.dataset.viewingSection === section;
      tab.classList.toggle("isActive", active);
      tab.setAttribute("aria-selected", String(active));
    }
    for (const [name, panel] of Object.entries(this.dom.panels) as Array<[SidebarSection, HTMLElement]>) {
      panel.hidden = name !== section;
    }
    this.dom.searchWrap.hidden = false;
    this.dom.search.value = this.#searchTerm;
    const searchDisabled = section === "poses";
    this.dom.search.disabled = searchDisabled;
    this.dom.search.placeholder = searchDisabled ? "Searching poses is unavailable" : "Search events…";
    this.dom.search.setAttribute("aria-label", searchDisabled ? "Searching poses is unavailable" : "Search events");
    this.dom.watchFilter.disabled = section !== "watches";
    this.dom.watchFilter.hidden = false;
    this.dom.watchSort.hidden = section !== "watches";
    this.dom.logSort.hidden = section !== "logs";
    this.dom.waypointSort.hidden = section !== "waypoints";
    this.dom.poseSort.hidden = section !== "poses";
    const activeSort = this.sortFor(section);
    if (Array.from(activeSort.options).some((option) => option.value === this.#sharedTimeSort)) {
      activeSort.value = this.#sharedTimeSort;
    }
    this.renderSection(section);
    this.restoreScrollPosition(section);
    this.updateCounts();
  }

  private sortFor(section: SidebarSection): HTMLSelectElement {
    if (section === "watches") return this.dom.watchSort;
    if (section === "logs") return this.dom.logSort;
    if (section === "waypoints") return this.dom.waypointSort;
    return this.dom.poseSort;
  }

  private renderSection(section: SidebarSection): void {
    if (section === "watches") this.watches.render();
    else if (section === "logs") this.logs.render();
    else if (section === "waypoints") this.waypoints.render();
    else this.poses.render();
  }

  private restoreScrollPosition(section: SidebarSection): void {
    const generation = ++this.#scrollRestoreGenerations[section];
    const target = this.#scrollPositions[section];
    let attempts = 5;
    const restore = () => {
      if (section !== this.#activeSection || generation !== this.#scrollRestoreGenerations[section]) return;
      this.dom.scrollContainer.scrollTop = target;
      if (--attempts > 0) requestAnimationFrame(restore);
      else {
        if (this.#shiftHeld && this.#shiftSync) this.syncActiveSection();
        else this.#scrollPositions[section] = this.dom.scrollContainer.scrollTop;
      }
    };
    requestAnimationFrame(restore);
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

  private handleNavigationChanged(kind: "selection" | "hover" | "track-lock" | "live-state"): void {
    const commitId = this.viewing.navigation.sidebarSyncCommitId;
    if (commitId !== this.#handledSidebarSyncCommitId) {
      this.#handledSidebarSyncCommitId = commitId;
      if (this.#shiftHeld) {
        this.startShiftSync();
        if (this.#shiftSync) this.#shiftSync.committed = true;
      }
    }
    if (!this.#shiftHeld) return;
    if (kind === "hover" && !this.inputHoverTime()) {
      if (this.#shiftSync && !this.#shiftSync.committed) this.cancelShiftSync();
      else if (this.#shiftSync) this.syncActiveSection();
      return;
    }
    this.startShiftSync();
    this.syncActiveSection();
  }

  private startShiftSync(): void {
    if (this.#shiftSync) return;
    if (this.syncTime() == null) return;
    this.#shiftSync = { committed: false, initialScrollPositions: {} };
    this.syncActiveSection();
  }

  private finishShiftSync(): void {
    if (!this.#shiftSync) return;
    if (this.#shiftSync.committed) this.clearPreviewSelections();
    else this.cancelShiftSync();
    this.#shiftSync = null;
  }

  private cancelShiftSync(): void {
    const session = this.#shiftSync;
    if (!session) return;
    for (const [section, position] of Object.entries(session.initialScrollPositions) as Array<[SidebarSection, number]>) {
      this.#scrollPositions[section] = position;
    }
    this.clearPreviewSelections();
    this.#shiftSync = null;
    this.restoreScrollPosition(this.#activeSection);
  }

  private syncActiveSection(): void {
    const session = this.#shiftSync;
    const time = this.syncTime();
    if (!session || time == null) return;
    if (session.initialScrollPositions[this.#activeSection] == null) {
      session.initialScrollPositions[this.#activeSection] = this.dom.scrollContainer.scrollTop;
    }
    if (this.#activeSection === "watches") this.watches.setPreviewTime(time);
    else if (this.#activeSection === "logs") this.logs.setPreviewTime(time);
    else if (this.#activeSection === "waypoints") this.waypoints.setPreviewTime(time);
    else this.poses.setPreviewTime(time);
  }

  private clearPreviewSelections(): void {
    this.watches.clearPreview();
    this.logs.clearPreview();
    this.waypoints.clearPreview();
    this.poses.clearPreview();
  }

  private inputHoverTime(): number | null {
    const navigation = this.viewing.navigation;
    if (navigation.timelineHoverSource === "timeline" && navigation.hoverTimelineTime != null) return navigation.hoverTimelineTime;
    return navigation.trackHoverTime;
  }

  private syncTime(): number | null {
    const hoverTime = this.inputHoverTime();
    if (hoverTime != null) return hoverTime;
    if (this.viewing.playback.isPlaying) return this.viewing.playback.timeMs;
    return this.viewing.navigation.trackLockPose?.t
      ?? this.viewing.data.poses[this.viewing.navigation.selectedIndex]?.t
      ?? null;
  }
}
