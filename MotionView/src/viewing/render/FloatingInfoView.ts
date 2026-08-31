import { viewingTelemetry } from "../../telemetry/createTelemetry";
import type { WatchEntry } from "../../state/models";
import type { ViewingFloatingDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import { formatNumber, levelStyle } from "../viewingPresentation";

export class FloatingInfoView {
  #dragOffset: Readonly<{ x: number; y: number }> | null = null;
  #resizeStart: Readonly<{ x: number; y: number; width: number; height: number }> | null = null;
  #pinnedDrag: Readonly<{ panel: HTMLElement; x: number; y: number }> | null = null;
  #panelCount = 0;
  readonly #pinnedWatchListeners = new Set<() => void>();

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingFloatingDom,
  ) {}

  bind(): void {
    this.dom.toggle.addEventListener("click", () => this.toggle());
    this.dom.close.addEventListener("click", () => this.setVisible(false));
    this.dom.header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
      this.#dragOffset = { x: event.clientX - this.dom.panel.offsetLeft, y: event.clientY - this.dom.panel.offsetTop };
    });
    this.dom.resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.#resizeStart = { x: event.clientX, y: event.clientY, width: this.dom.panel.offsetWidth, height: this.dom.panel.offsetHeight };
      event.preventDefault();
    });
    window.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    window.addEventListener("pointerup", () => {
      this.#dragOffset = null;
      this.#resizeStart = null;
      this.#pinnedDrag = null;
    });
  }

  toggle(): void {
    this.setVisible(this.dom.panel.classList.contains("hidden"));
  }

  setVisible(visible: boolean): void {
    this.dom.panel.classList.toggle("hidden", !visible);
    this.dom.toggle.classList.toggle("active", visible);
    void viewingTelemetry.floatingInfoToggled({ enabled: visible });
    if (visible) this.update();
  }

  update(): void {
    const fieldPose = this.viewing.playback.currentDisplayPose();
    const pose = this.viewing.projection.displayPose(fieldPose);
    const index = this.viewing.playback.currentDisplayIndex();
    const deltaMs = this.viewing.playback.currentDisplayDeltaMs();
    const values = this.dom.values;
    if (!pose) {
      values.x.textContent = "—";
      values.y.textContent = "—";
      values.theta.textContent = "—";
      values.time.textContent = "—";
      values.averageSpeed.textContent = "—";
      values.leftVelocity.textContent = "—";
      values.rightVelocity.textContent = "—";
      values.deltaTime.textContent = "—";
      values.pointCount.textContent = "Point: —/—";
    } else {
      values.x.textContent = formatNumber(pose.x, 2);
      values.y.textContent = formatNumber(pose.y, 2);
      values.theta.textContent = `${formatNumber(pose.theta, 2)}°`;
      values.time.textContent = `${formatNumber((pose.t ?? 0) / 1000, 2)}s`;
      values.averageSpeed.textContent = formatNumber(pose.speed_raw, 2);
      values.leftVelocity.textContent = formatNumber(pose.l_vel, 2);
      values.rightVelocity.textContent = formatNumber(pose.r_vel, 2);
      values.deltaTime.textContent = deltaMs == null ? "—" : `${formatNumber(deltaMs / 1000, 3)}s`;
      values.pointCount.textContent = `Point: ${index + 1}/${this.viewing.data.poses.length}`;
    }
    const reference = fieldPose?.t ?? null;
    const closest = this.closestWatch(reference);
    values.watchTime.textContent = closest ? `${formatNumber(closest.t / 1000, 2)}s` : "—";
    values.watchLabel.textContent = closest?.label || "—";
    values.watchValue.textContent = closest?.value == null ? "—" : String(closest.value);
    this.refreshPinnedPanels();
  }

  toggleWatch(watchId: number | string | null): void {
    const existing = watchId == null ? null : this.dom.pinnedHost.querySelector<HTMLElement>(`.pinnedWatchPanel[data-watch-id="${CSS.escape(String(watchId))}"]`);
    if (existing) {
      existing.remove();
      this.notifyPinnedWatchChanged();
    }
    else this.openWatch(watchId);
  }

  onPinnedWatchChanged(listener: () => void): () => void {
    this.#pinnedWatchListeners.add(listener);
    return () => this.#pinnedWatchListeners.delete(listener);
  }

  isWatchPinned(watchId: number | string | null): boolean {
    return watchId != null && !!this.dom.pinnedHost.querySelector(`.pinnedWatchPanel[data-watch-id="${CSS.escape(String(watchId))}"]`);
  }

  openWatch(watchId: number | string | null): void {
    const panel = this.dom.pinnedTemplate.content.firstElementChild?.cloneNode(true) as HTMLElement | null;
    if (!panel) return;
    panel.dataset.watchId = watchId == null ? "" : String(watchId);
    panel.style.top = `${128 + this.#panelCount * 26}px`;
    panel.style.right = `${16 + this.#panelCount * 18}px`;
    this.#panelCount += 1;
    panel.querySelector(".pinnedWatchClose")?.addEventListener("click", () => {
      panel.remove();
      this.notifyPinnedWatchChanged();
    });
    panel.querySelector(".pinnedWatchHeader")?.addEventListener("pointerdown", (event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      this.#pinnedDrag = { panel, x: event.clientX - panel.offsetLeft, y: event.clientY - panel.offsetTop };
      panel.style.left = `${panel.offsetLeft}px`;
      panel.style.right = "auto";
      event.preventDefault();
    });
    this.dom.pinnedHost.appendChild(panel);
    this.updatePinnedPanel(panel);
    this.notifyPinnedWatchChanged();
  }

  refreshPinnedPanels(): void {
    for (const panel of this.dom.pinnedHost.querySelectorAll<HTMLElement>(".pinnedWatchPanel")) this.updatePinnedPanel(panel);
  }

  private notifyPinnedWatchChanged(): void {
    for (const listener of this.#pinnedWatchListeners) listener();
  }

  private closestWatch(time: number | null): Readonly<WatchEntry> | null {
    if (time == null) return null;
    let closest: Readonly<WatchEntry> | null = null;
    let best = Infinity;
    for (const watch of this.viewing.data.watches) {
      const delta = Math.abs(watch.t - time);
      if (delta < best) {
        closest = watch;
        best = delta;
      }
    }
    return closest;
  }

  private updatePinnedPanel(panel: HTMLElement): void {
    const id = panel.dataset.watchId;
    const time = this.viewing.playback.currentDisplayPose()?.t ?? null;
    let latest: Readonly<WatchEntry> | null = null;
    for (let index = this.viewing.data.watches.length - 1; index >= 0; index -= 1) {
      const watch = this.viewing.data.watches[index];
      if (String(watch?.id ?? "") === String(id ?? "") && (time == null || (watch?.t ?? Infinity) <= time)) {
        latest = watch ?? null;
        break;
      }
    }
    const name = panel.querySelector(".pinnedWatchName");
    const value = panel.querySelector<HTMLElement>(".pinnedWatchValue");
    if (name) name.textContent = latest?.label || (id ? `Watch ${id}` : "No watch selected");
    if (value) {
      value.textContent = latest?.value == null ? "—" : String(latest.value);
      const style = levelStyle(latest?.level);
      value.style.background = style.fill;
      value.style.color = style.text;
    }
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.#pinnedDrag) {
      this.#pinnedDrag.panel.style.left = `${Math.max(0, event.clientX - this.#pinnedDrag.x)}px`;
      this.#pinnedDrag.panel.style.top = `${Math.max(0, event.clientY - this.#pinnedDrag.y)}px`;
    } else if (this.#dragOffset) {
      this.dom.panel.style.left = `${Math.max(0, event.clientX - this.#dragOffset.x)}px`;
      this.dom.panel.style.top = `${Math.max(0, event.clientY - this.#dragOffset.y)}px`;
    } else if (this.#resizeStart) {
      this.dom.panel.style.width = `${Math.max(30, Math.min(400, this.#resizeStart.width + event.clientX - this.#resizeStart.x))}px`;
      this.dom.panel.style.height = `${Math.max(49, Math.min(600, this.#resizeStart.height + event.clientY - this.#resizeStart.y))}px`;
    }
  }
}
