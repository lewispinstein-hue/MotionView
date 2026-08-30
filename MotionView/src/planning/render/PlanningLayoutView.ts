import { getMode } from "../../app/modeController";
import type { FieldRenderer } from "../../render/field";
import type { PlanningView } from "../PlanningView";
import { TypedEvent } from "../../app/typedEvent";

const COLLAPSE_SIDEBAR_PX = 282;
const COLLAPSE_TIMELINE_PX = 24;
const COLLAPSE_LIST_PX = 56;
const MAX_SIDEBAR_PX = 550;
const TIMELINE_HEIGHT_PX = 144;
const LEGACY_TIMELINE_HEIGHT_PX = 170;

export interface PersistedPlanningLayout {
  readonly sidebarWidth?: unknown;
  readonly waypointListHeight?: unknown;
  readonly timelineHeight?: unknown;
}

function requiredElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`MotionView Planning layout requires #${id}.`);
  return element as T;
}

export class PlanningLayoutView {
  readonly changed = new TypedEvent<Record<string, never>>();
  readonly #root = document.documentElement;
  readonly #splitter: HTMLElement;
  readonly #timelineSplitter: HTMLElement;
  readonly #listSplitter: HTMLElement;
  readonly #sidebar: HTMLElement;
  readonly #timelineBar: HTMLElement;
  #sidebarDrag: { x: number; width: number } | null = null;
  #timelineDrag: { y: number; height: number } | null = null;
  #listDrag: { y: number; height: number } | null = null;
  #lastSidebarWidth = 360;

  constructor(
    document: Document,
    private readonly field: FieldRenderer,
    private readonly view: PlanningView,
  ) {
    this.#splitter = requiredElement(document, "vSplit");
    this.#timelineSplitter = requiredElement(document, "planningTimelineSplit");
    this.#listSplitter = requiredElement(document, "planSplit");
    this.#sidebar = requiredElement(document, "rightPlanning");
    this.#timelineBar = requiredElement(document, "timelineBar");
  }

  bind(): void {
    this.#splitter.addEventListener("mousedown", (event) => {
      if (getMode() !== "planning") return;
      this.#sidebarDrag = { x: event.clientX, width: this.sidebarWidth };
      document.body.style.cursor = "col-resize";
      event.preventDefault();
    });
    this.#timelineSplitter.addEventListener("mousedown", (event) => {
      if (getMode() !== "planning") return;
      this.#timelineDrag = { y: event.clientY, height: this.timelineHeight };
      document.body.style.cursor = "row-resize";
      event.preventDefault();
    });
    this.#listSplitter.addEventListener("mousedown", (event) => {
      if (getMode() !== "planning") return;
      this.#listDrag = { y: event.clientY, height: this.listHeight };
      document.body.style.cursor = "row-resize";
      event.preventDefault();
    });
    window.addEventListener("mousemove", (event) => this.move(event));
    window.addEventListener("mouseup", () => this.end());
    this.#splitter.addEventListener("dblclick", () => {
      if (getMode() !== "planning") return;
      this.toggleRightSidebar();
    });
    this.#timelineSplitter.addEventListener("dblclick", () => {
      if (getMode() !== "planning") return;
      this.toggleTimeline();
    });
    window.addEventListener("resize", () => {
      if (getMode() !== "planning") return;
      this.field.updateFieldLayout(true);
      this.resize();
    });
  }

  activate(): void {
    if (getMode() !== "planning") return;
    this.#timelineBar.classList.toggle("isCollapsed", this.timelineHeight <= COLLAPSE_TIMELINE_PX);
    this.resize();
  }

  applyPersistedLayout(layout: PersistedPlanningLayout): void {
    const sidebarWidth = this.parseNumber(layout.sidebarWidth);
    if (sidebarWidth !== null) {
      const width = Math.max(0, Math.min(MAX_SIDEBAR_PX, sidebarWidth));
      this.setSidebarWidth(width);
      if (width > COLLAPSE_SIDEBAR_PX) this.#lastSidebarWidth = width;
    }

    const waypointListHeight = this.parseNumber(layout.waypointListHeight);
    if (waypointListHeight !== null) {
      const maximum = Math.max(COLLAPSE_LIST_PX, this.#sidebar.getBoundingClientRect().height - 180);
      const height = Math.max(0, Math.min(maximum, waypointListHeight));
      this.#root.style.setProperty("--planListH", `${height}px`);
      this.#sidebar.classList.toggle("planListCollapsed", height <= COLLAPSE_LIST_PX);
    }

    const timelineHeight = this.parseNumber(layout.timelineHeight);
    if (timelineHeight !== null) {
      const migratedHeight = Math.abs(timelineHeight - LEGACY_TIMELINE_HEIGHT_PX) < 2
        ? TIMELINE_HEIGHT_PX
        : timelineHeight;
      this.setTimelineCollapsed(migratedHeight <= COLLAPSE_TIMELINE_PX);
    }

    this.activate();
  }

  resize(): void {
    this.field.resizeCanvas();
    this.view.resizeTimeline();
  }

  toggleRightSidebar(): void {
    if (this.sidebarWidth <= COLLAPSE_SIDEBAR_PX) this.setSidebarWidth(Math.max(COLLAPSE_SIDEBAR_PX + 1, this.#lastSidebarWidth));
    else { this.#lastSidebarWidth = this.sidebarWidth; this.setSidebarWidth(0); }
    this.field.resetFieldPosition();
    this.resize();
    this.changed.emit({});
  }

  toggleTimeline(): void {
    this.setTimelineCollapsed(this.timelineHeight > COLLAPSE_TIMELINE_PX);
    this.resize();
    this.changed.emit({});
  }

  private get sidebarWidth(): number { return this.cssNumber("--rightSidebarWPlanning", 360); }
  private get timelineHeight(): number { return this.cssNumber("--planningTimelineH", TIMELINE_HEIGHT_PX); }
  private get listHeight(): number { return this.cssNumber("--planListH", 240); }

  private move(event: MouseEvent): void {
    if (this.#sidebarDrag) {
      const width = Math.max(0, Math.min(MAX_SIDEBAR_PX, window.innerWidth - 240, this.#sidebarDrag.width - (event.clientX - this.#sidebarDrag.x)));
      this.setSidebarWidth(width <= COLLAPSE_SIDEBAR_PX ? 0 : width);
      if (width > COLLAPSE_SIDEBAR_PX) this.#lastSidebarWidth = width;
      this.resize();
    }
    if (this.#timelineDrag) {
      const collapse = event.clientY >= window.innerHeight - COLLAPSE_TIMELINE_PX
        || event.clientY - this.#timelineDrag.y >= Math.max(this.#timelineDrag.height, TIMELINE_HEIGHT_PX) * 0.5;
      this.setTimelineCollapsed(collapse);
      this.resize();
    }
    if (this.#listDrag) {
      const maxHeight = Math.max(COLLAPSE_LIST_PX, this.#sidebar.getBoundingClientRect().height - 180);
      let height = Math.max(0, Math.min(maxHeight, this.#listDrag.height + event.clientY - this.#listDrag.y));
      if (height <= COLLAPSE_LIST_PX) height = 0;
      else if (height < 120) height = 120;
      this.#root.style.setProperty("--planListH", `${height}px`);
      this.#sidebar.classList.toggle("planListCollapsed", height <= COLLAPSE_LIST_PX);
    }
  }

  private end(): void {
    if (!this.#sidebarDrag && !this.#timelineDrag && !this.#listDrag) return;
    this.#sidebarDrag = null;
    this.#timelineDrag = null;
    this.#listDrag = null;
    document.body.style.cursor = "";
    this.activate();
    this.changed.emit({});
  }

  private setSidebarWidth(width: number): void {
    this.#root.style.setProperty("--rightSidebarWPlanning", `${width}px`);
    this.#sidebar.classList.toggle("isCollapsed", width <= COLLAPSE_SIDEBAR_PX);
  }

  private setTimelineCollapsed(collapsed: boolean): void {
    this.#root.style.setProperty("--planningTimelineH", `${collapsed ? 0 : TIMELINE_HEIGHT_PX}px`);
    this.#timelineBar.classList.toggle("isCollapsed", collapsed);
  }

  private cssNumber(property: string, fallback: number): number {
    const value = Number.parseFloat(getComputedStyle(this.#root).getPropertyValue(property));
    return Number.isFinite(value) ? value : fallback;
  }

  private parseNumber(value: unknown): number | null {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
}
