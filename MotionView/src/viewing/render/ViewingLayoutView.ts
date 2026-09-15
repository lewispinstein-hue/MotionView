import { getMode } from "../../app/modeController";
import type { FieldRenderer } from "../../render/field";
import type { ViewingView } from "../ViewingView";
import { TypedEvent } from "../../app/typedEvent";

const COLLAPSE_SIDEBAR_PX = 282;
const COLLAPSE_TIMELINE_PX = 130;
const MAX_SIDEBAR_PX = 550;
const MAX_LEFT_SIDEBAR_PX = 800;
const MAX_TIMELINE_PX = 350;
const MIN_FIELD_WIDTH_PX = 100;
const COLLAPSE_LEFT_SIDEBAR_PX = 220;

export interface PersistedViewingLayout {
  readonly leftSidebarWidth?: unknown;
  readonly sidebarWidth?: unknown;
  readonly timelineHeight?: unknown;
}

function requiredElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`MotionView Viewing layout requires #${id}.`);
  return element as T;
}

export class ViewingLayoutView {
  readonly changed = new TypedEvent<Record<string, never>>();
  readonly #root = document.documentElement;
  readonly #splitter: HTMLElement;
  readonly #timelineSplitter: HTMLElement;
  readonly #sidebar: HTMLElement;
  readonly #leftSidebar: HTMLElement;
  readonly #leftSplitter: HTMLElement;
  readonly #row: HTMLElement;
  readonly #timelineBar: HTMLElement;
  #sidebarDrag: { x: number; width: number } | null = null;
  #leftSidebarDrag: { x: number; width: number } | null = null;
  #timelineDrag: { y: number; height: number } | null = null;
  #lastSidebarWidth = 360;
  #lastLeftSidebarWidth = 391;
  #lastTimelineHeight = 260;

  constructor(
    private readonly field: FieldRenderer,
    private readonly view: ViewingView,
    document: Document = globalThis.document,
  ) {
    this.#splitter = requiredElement(document, "vSplit");
    this.#timelineSplitter = requiredElement(document, "hSplit");
    this.#sidebar = requiredElement(document, "rightViewing");
    this.#leftSidebar = requiredElement(document, "left");
    this.#leftSplitter = requiredElement(document, "vSplitL");
    this.#row = this.#sidebar.closest<HTMLElement>(".row")
      ?? (() => { throw new Error("MotionView Viewing layout requires a .row container."); })();
    this.#timelineBar = requiredElement(document, "timelineBar");
  }

  bind(): void {
    this.#leftSplitter.addEventListener("mousedown", (event) => {
      if (getMode() !== "viewing") return;
      this.#leftSidebarDrag = { x: event.clientX, width: this.leftSidebarWidth };
      document.body.style.cursor = "col-resize";
      event.preventDefault();
    });
    this.#splitter.addEventListener("mousedown", (event) => {
      if (getMode() !== "viewing") return;
      this.#sidebarDrag = { x: event.clientX, width: this.sidebarWidth };
      document.body.style.cursor = "col-resize";
      event.preventDefault();
    });
    this.#timelineSplitter.addEventListener("mousedown", (event) => {
      if (getMode() !== "viewing") return;
      this.#timelineDrag = { y: event.clientY, height: this.timelineHeight };
      document.body.style.cursor = "row-resize";
      event.preventDefault();
    });
    window.addEventListener("mousemove", (event) => this.move(event));
    window.addEventListener("mouseup", () => this.end());
    this.#splitter.addEventListener("dblclick", () => {
      if (getMode() !== "viewing") return;
      this.toggleRightSidebar();
    });
    this.#leftSplitter.addEventListener("dblclick", () => {
      if (getMode() !== "viewing") return;
      this.toggleLeftSidebar();
    });
    this.#timelineSplitter.addEventListener("dblclick", () => {
      if (getMode() !== "viewing") return;
      this.toggleTimeline();
    });
    window.addEventListener("resize", () => {
      if (getMode() !== "viewing") return;
      this.field.updateFieldLayout(true);
      this.resize();
    });
  }

  activate(): void {
    if (getMode() !== "viewing") return;
    this.#timelineBar.classList.toggle("isCollapsed", this.timelineHeight <= COLLAPSE_TIMELINE_PX);
    this.resize();
  }

  applyPersistedLayout(layout: PersistedViewingLayout): void {
    const leftSidebarWidth = this.parseNumber(layout.leftSidebarWidth);
    if (leftSidebarWidth !== null) {
      const width = Math.max(0, Math.min(this.maxLeftSidebarWidth, leftSidebarWidth));
      this.setLeftSidebarWidth(width);
      if (width > COLLAPSE_LEFT_SIDEBAR_PX) this.#lastLeftSidebarWidth = width;
    }

    const sidebarWidth = this.parseNumber(layout.sidebarWidth);
    if (sidebarWidth !== null) {
      const width = Math.max(0, Math.min(MAX_SIDEBAR_PX, sidebarWidth));
      this.setSidebarWidth(width);
      if (width > COLLAPSE_SIDEBAR_PX) this.#lastSidebarWidth = width;
    }

    const timelineHeight = this.parseNumber(layout.timelineHeight);
    if (timelineHeight !== null) {
      const height = Math.max(0, Math.min(MAX_TIMELINE_PX, timelineHeight));
      this.setTimelineHeight(height);
      if (height > COLLAPSE_TIMELINE_PX) this.#lastTimelineHeight = height;
    }

    this.activate();
  }

  resize(): void {
    this.field.resizeCanvas();
    this.view.resize();
  }

  toggleLeftSidebar(): void {
    if (this.leftSidebarWidth <= COLLAPSE_LEFT_SIDEBAR_PX) {
      this.setLeftSidebarWidth(Math.max(COLLAPSE_LEFT_SIDEBAR_PX + 1, Math.min(this.maxLeftSidebarWidth, this.#lastLeftSidebarWidth)));
    } else {
      this.#lastLeftSidebarWidth = this.leftSidebarWidth;
      this.setLeftSidebarWidth(0);
    }
    this.finishSidebarToggle();
  }

  toggleRightSidebar(): void {
    if (this.sidebarWidth <= COLLAPSE_SIDEBAR_PX) this.setSidebarWidth(Math.max(COLLAPSE_SIDEBAR_PX + 1, this.#lastSidebarWidth));
    else { this.#lastSidebarWidth = this.sidebarWidth; this.setSidebarWidth(0); }
    this.finishSidebarToggle();
  }

  toggleTimeline(): void {
    if (this.timelineHeight <= COLLAPSE_TIMELINE_PX) {
      this.setTimelineHeight(Math.max(160, this.#lastTimelineHeight));
    } else {
      this.#lastTimelineHeight = this.timelineHeight;
      this.setTimelineHeight(0);
    }
    this.field.resetFieldPosition();
    this.resize();
    this.changed.emit({});
  }

  private get sidebarWidth(): number { return this.cssNumber("--rightSidebarWViewing", 360); }
  private get leftSidebarWidth(): number { return this.cssNumber("--leftSidebarW", 391); }
  private get timelineHeight(): number { return this.cssNumber("--timelineH", 260); }

  private move(event: MouseEvent): void {
    if (this.#leftSidebarDrag) {
      const width = Math.max(0, Math.min(
        this.maxLeftSidebarWidth,
        this.#leftSidebarDrag.width + event.clientX - this.#leftSidebarDrag.x,
      ));
      this.setLeftSidebarWidth(width <= COLLAPSE_LEFT_SIDEBAR_PX ? 0 : width);
      if (width > COLLAPSE_LEFT_SIDEBAR_PX) this.#lastLeftSidebarWidth = width;
      this.resize();
    }
    if (this.#sidebarDrag) {
      const splitterWidth = this.#splitter.getBoundingClientRect().width;
      const leftSplitterWidth = this.#leftSplitter.getBoundingClientRect().width;
      const availableWidth = this.#row.clientWidth
        - this.#leftSidebar.getBoundingClientRect().width
        - splitterWidth
        - leftSplitterWidth
        - MIN_FIELD_WIDTH_PX;
      const width = Math.max(0, Math.min(
        MAX_SIDEBAR_PX,
        availableWidth,
        this.#sidebarDrag.width - (event.clientX - this.#sidebarDrag.x),
      ));
      this.setSidebarWidth(width <= COLLAPSE_SIDEBAR_PX ? 0 : width);
      if (width > COLLAPSE_SIDEBAR_PX) this.#lastSidebarWidth = width;
      this.resize();
    }
    if (this.#timelineDrag) {
      const height = Math.max(0, Math.min(MAX_TIMELINE_PX, window.innerHeight * 0.8, this.#timelineDrag.height - (event.clientY - this.#timelineDrag.y)));
      this.setTimelineHeight(height <= COLLAPSE_TIMELINE_PX ? 0 : height);
      if (height > COLLAPSE_TIMELINE_PX) this.#lastTimelineHeight = height;
      this.resize();
    }
  }

  private end(): void {
    if (!this.#leftSidebarDrag && !this.#sidebarDrag && !this.#timelineDrag) return;
    this.#leftSidebarDrag = null;
    this.#sidebarDrag = null;
    this.#timelineDrag = null;
    document.body.style.cursor = "";
    this.activate();
    this.changed.emit({});
  }

  private get maxLeftSidebarWidth(): number {
    const reservedWidth = this.#sidebar.getBoundingClientRect().width
      + this.#splitter.getBoundingClientRect().width
      + this.#leftSplitter.getBoundingClientRect().width
      + MIN_FIELD_WIDTH_PX;
    return Math.max(0, Math.min(MAX_LEFT_SIDEBAR_PX, this.#row.clientWidth - reservedWidth));
  }

  private setLeftSidebarWidth(width: number): void {
    this.#root.style.setProperty("--leftSidebarW", `${width}px`);
    const collapsed = width <= COLLAPSE_LEFT_SIDEBAR_PX;
    this.#leftSidebar.classList.toggle("isCollapsed", collapsed);
    this.#row.classList.toggle("leftCollapsed", collapsed);
  }

  private finishSidebarToggle(): void {
    this.field.resetFieldPosition();
    this.resize();
    this.changed.emit({});
  }

  private setSidebarWidth(width: number): void {
    this.#root.style.setProperty("--rightSidebarWViewing", `${width}px`);
    this.#sidebar.classList.toggle("isCollapsed", width <= COLLAPSE_SIDEBAR_PX);
  }

  private setTimelineHeight(height: number): void {
    this.#root.style.setProperty("--timelineH", `${height}px`);
    this.#timelineBar.classList.toggle("isCollapsed", height <= COLLAPSE_TIMELINE_PX);
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
