import type { FieldRenderer } from "../../render/field";
import type { FieldOption } from "../../render/field/fieldImages";
import type { MotionViewApp } from "../MotionViewApp";
import type { AppMode } from "../modeController";
import type { TopBarDom } from "./TopBarDom";
import { TopBarEvents } from "./topBarEvents";

const CENTER_STATUS_GAP_PX = 16;
const CENTER_RIGHT_SCROLL_GAP_PX = 0;

/** Owns top-bar presentation, layout, controls, and application synchronization. */
export class TopBarView {
  readonly events = new TopBarEvents();

  #maximumObservedWidth = 0;
  #maximumCenteredStatusWidth = 0;
  #savedScrollLeft = 0;
  #layoutFrame = 0;
  #bound = false;
  #resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly app: MotionViewApp,
    private readonly fieldRenderer: FieldRenderer,
    private readonly dom: TopBarDom,
  ) {}

  get selectedField(): string {
    return this.dom.fieldSelect.value;
  }

  get playbackSpeed(): number {
    return Number(this.dom.speedSelect.value) || 1;
  }

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;

    this.dom.fitButton.addEventListener("click", () => this.fieldRenderer.resetFieldPosition());
    this.dom.sidebarFileButton.addEventListener("click", () => this.openFilePicker());
    this.dom.settingsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.events.actionRequested.emit({ kind: "settings-requested" });
    });
    this.dom.clearButton.addEventListener("click", (event) => {
      this.events.actionRequested.emit({
        kind: "clear-requested",
        clearAll: event.metaKey || event.ctrlKey,
      });
    });
    this.dom.helpButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.events.actionRequested.emit({ kind: "help-requested" });
    });
    this.dom.viewingModeButton.addEventListener("click", () => this.app.core.mode.setMode("viewing"));
    this.dom.planningModeButton.addEventListener("click", () => this.app.core.mode.setMode("planning"));
    this.dom.playButton.addEventListener("click", () => this.togglePlayback());
    this.dom.speedSelect.addEventListener("change", () => {
      this.setPlaybackSpeed(this.playbackSpeed);
      this.events.settingsChanged.emit({ kind: "playback-speed", speed: this.playbackSpeed });
    });
    this.dom.fieldSelect.addEventListener("change", () => void this.loadSelectedField());
    this.dom.fileInput.addEventListener("change", (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : this.dom.fileInput;
      this.events.actionRequested.emit({ kind: "file-selected", file: input.files?.[0] ?? null, input });
    });
    this.dom.robotImageInput.addEventListener("change", (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : this.dom.robotImageInput;
      this.events.actionRequested.emit({ kind: "robot-image-selected", file: input.files?.[0] ?? null, input });
    });

    this.app.core.status.subscribeStatus((message) => {
      this.dom.status.dataset.fullText = message;
      this.scheduleLayout();
    });
    this.app.core.mode.subscribeMode((mode) => {
      this.renderMode(mode);
      this.renderPlayback();
    });
    this.app.planning.events.playbackChanged.subscribe(() => this.renderPlayback());
    this.app.planning.events.documentChanged.subscribe(() => this.renderPlayback());
    this.app.viewing.events.playbackChanged.subscribe(() => this.renderPlayback());
    this.app.viewing.events.dataChanged.subscribe(() => this.renderPlayback());
    this.app.live.events.connectionChanged.subscribe(() => this.renderPlayback());
    this.app.live.events.streamChanged.subscribe(() => this.renderPlayback());

    if (typeof ResizeObserver === "function") {
      this.#resizeObserver = new ResizeObserver(() => this.scheduleLayout());
      this.#resizeObserver.observe(this.dom.root);
      this.#resizeObserver.observe(this.dom.content);
      this.#resizeObserver.observe(this.dom.left);
      this.#resizeObserver.observe(this.dom.center);
      this.#resizeObserver.observe(this.dom.right);
    }

    this.dom.root.addEventListener("scroll", () => {
      this.#savedScrollLeft = this.dom.root.scrollLeft || 0;
    }, { passive: true });
  }

  render(): void {
    this.renderMode(this.app.core.mode.getMode());
    this.renderPlayback();
    this.scheduleLayout();
  }

  scheduleLayout(): void {
    if (this.#layoutFrame) cancelAnimationFrame(this.#layoutFrame);
    this.#layoutFrame = requestAnimationFrame(() => {
      this.#layoutFrame = 0;
      this.updateStatusLayout();
    });
  }

  setFieldOptions(fields: readonly FieldOption[], selectedKey: string): void {
    this.dom.fieldSelect.replaceChildren();
    if (!fields.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No fields available";
      option.disabled = true;
      this.dom.fieldSelect.appendChild(option);
      this.dom.fieldSelect.value = "";
      return;
    }
    for (const field of fields) {
      const option = document.createElement("option");
      option.value = field.key;
      option.textContent = field.label;
      this.dom.fieldSelect.appendChild(option);
    }
    this.dom.fieldSelect.value = selectedKey;
  }

  setFieldEnabled(enabled: boolean): void {
    this.dom.fieldSelect.disabled = !enabled;
  }

  setPlaybackSpeed(speed: number): void {
    const nextSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    this.dom.speedSelect.value = String(nextSpeed);
    this.app.viewing.playback.setRate(nextSpeed);
    this.app.planning.playback.setRate(nextSpeed);
  }

  openFilePicker(): void {
    this.dom.fileInput.click();
  }

  openRobotImagePicker(): void {
    this.dom.robotImageInput.click();
  }

  private togglePlayback(): void {
    if (this.app.core.mode.getMode() === "planning") {
      this.app.planning.playback.toggle();
      return;
    }
    if (this.app.viewing.data.hasData) this.app.viewing.playback.toggle();
  }

  private async loadSelectedField(): Promise<void> {
    const fieldKey = this.selectedField;
    await this.fieldRenderer.loadFieldImage(fieldKey);
    this.events.settingsChanged.emit({ kind: "field", fieldKey });
  }

  private renderMode(mode: AppMode): void {
    const viewing = mode === "viewing";
    this.dom.viewingModeButton.classList.toggle("isActive", viewing);
    this.dom.viewingModeButton.setAttribute("aria-selected", viewing ? "true" : "false");
    this.dom.planningModeButton.classList.toggle("isActive", !viewing);
    this.dom.planningModeButton.setAttribute("aria-selected", viewing ? "false" : "true");
  }

  private renderPlayback(): void {
    const streaming = this.app.live.stream.streaming || this.app.live.stream.state === "stopping";
    const planning = this.app.core.mode.getMode() === "planning";
    const playing = planning ? this.app.planning.playback.isPlaying : this.app.viewing.playback.isPlaying;
    const hasPlayableData = planning
      ? this.app.planning.route.length >= 2
      : this.app.viewing.data.poses.length >= 2;
    this.dom.playButton.disabled = streaming || !hasPlayableData;
    this.dom.playButton.textContent = playing ? "⏸" : "▶";
    this.dom.playButton.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  private updateStatusLayout(): void {
    const fullText = this.dom.status.dataset.fullText ?? this.dom.status.textContent ?? "";
    const previousScrollLeft = Math.max(this.#savedScrollLeft, this.dom.root.scrollLeft || 0);
    this.dom.root.classList.remove("isOverflowing");
    this.dom.center.style.left = "50%";
    this.dom.center.style.top = "50%";
    this.dom.status.style.maxWidth = "";
    this.dom.status.textContent = fullText;
    this.dom.status.title = "";

    const topBarRect = this.dom.root.getBoundingClientRect();
    const centerRect = this.dom.center.getBoundingClientRect();
    const rightRect = this.dom.right.getBoundingClientRect();
    const statusRect = this.dom.status.getBoundingClientRect();
    const centerWidth = Math.ceil(centerRect.width);
    const idealCenterX = Math.floor(topBarRect.width / 2);
    const idealCenterLeft = idealCenterX - centerWidth / 2;
    const statusStartX = Math.floor(statusRect.left - topBarRect.left);
    const statusNaturalWidth = Math.ceil(this.dom.status.scrollWidth);
    const centeredStatusMaxWidth = Math.max(0, Math.floor(idealCenterLeft - statusStartX - CENTER_STATUS_GAP_PX));
    const currentBarWidth = Math.ceil(topBarRect.width);

    if (currentBarWidth >= this.#maximumObservedWidth) {
      this.#maximumObservedWidth = currentBarWidth;
      this.#maximumCenteredStatusWidth = centeredStatusMaxWidth;
    }

    this.dom.status.style.maxWidth = `${centeredStatusMaxWidth}px`;
    const centeredCurrentlyTruncates = this.dom.status.scrollWidth > this.dom.status.clientWidth;
    const centeredCenterRight = idealCenterX + centerWidth / 2;
    const centeredRightGap = rightRect.left - topBarRect.left - centeredCenterRight;

    if (!centeredCurrentlyTruncates && centeredRightGap >= CENTER_RIGHT_SCROLL_GAP_PX) {
      this.#savedScrollLeft = 0;
      return;
    }

    const preservedStatusWidth = Math.max(centeredStatusMaxWidth, this.#maximumCenteredStatusWidth);
    const desiredStatusWidth = Math.min(statusNaturalWidth, preservedStatusWidth);
    const centeredKeepsStatusUntruncated = centeredStatusMaxWidth >= desiredStatusWidth;
    const minimumCenterX = Math.ceil(statusStartX + desiredStatusWidth + CENTER_STATUS_GAP_PX + centerWidth / 2);
    const shiftedCenterX = Math.max(idealCenterX, minimumCenterX);
    const shiftedCenterRight = shiftedCenterX + centerWidth / 2;
    const shiftedRightGap = rightRect.left - topBarRect.left - shiftedCenterRight;

    if (centeredKeepsStatusUntruncated) {
      this.dom.status.style.maxWidth = `${Math.max(0, desiredStatusWidth)}px`;
      this.#savedScrollLeft = 0;
      return;
    }

    if (shiftedRightGap >= CENTER_RIGHT_SCROLL_GAP_PX) {
      this.dom.center.style.left = `${shiftedCenterX}px`;
      this.dom.status.style.maxWidth = `${Math.max(0, desiredStatusWidth)}px`;
      this.dom.status.title = this.dom.status.scrollWidth > this.dom.status.clientWidth ? fullText : "";
      this.#savedScrollLeft = 0;
      return;
    }

    this.dom.root.classList.add("isOverflowing");
    this.dom.center.style.left = "";
    this.dom.center.style.top = "";
    this.dom.status.style.maxWidth = `${Math.max(0, desiredStatusWidth)}px`;
    this.dom.status.textContent = fullText;
    this.dom.status.title = this.dom.status.scrollWidth > this.dom.status.clientWidth ? fullText : "";
    requestAnimationFrame(() => {
      if (!this.dom.root.classList.contains("isOverflowing")) return;
      const maximumScrollLeft = Math.max(0, this.dom.root.scrollWidth - this.dom.root.clientWidth);
      const restoredScrollLeft = Math.min(previousScrollLeft, maximumScrollLeft);
      this.dom.root.scrollLeft = restoredScrollLeft;
      this.#savedScrollLeft = restoredScrollLeft;
    });
  }
}
