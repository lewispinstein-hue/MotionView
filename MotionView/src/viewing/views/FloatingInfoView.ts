import { viewingTelemetry } from "../../telemetry/createTelemetry";
import type { WatchEntry } from "../../state/models";
import type { ViewingDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import { formatNumber, levelStyle } from "../viewingPresentation";

export class FloatingInfoView {
  #dragOffset: Readonly<{ x: number; y: number }> | null = null;
  #resizeStart: Readonly<{ x: number; y: number; width: number; height: number }> | null = null;
  #pinnedDrag: Readonly<{ panel: HTMLElement; x: number; y: number }> | null = null;
  #panelCount = 0;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingDom,
  ) {}

  bind(): void {
    this.dom.toggleFloatingInfo.addEventListener("click", () => this.toggle());
    this.dom.closeFloatingInfo.addEventListener("click", () => this.setVisible(false));
    this.dom.floatingHeader.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
      this.#dragOffset = { x: event.clientX - this.dom.floatingInfo.offsetLeft, y: event.clientY - this.dom.floatingInfo.offsetTop };
    });
    this.dom.floatingResizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.#resizeStart = { x: event.clientX, y: event.clientY, width: this.dom.floatingInfo.offsetWidth, height: this.dom.floatingInfo.offsetHeight };
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
    this.setVisible(this.dom.floatingInfo.classList.contains("hidden"));
  }

  setVisible(visible: boolean): void {
    this.dom.floatingInfo.classList.toggle("hidden", !visible);
    this.dom.toggleFloatingInfo.classList.toggle("active", visible);
    void viewingTelemetry.floatingInfoToggled({ enabled: visible });
    if (visible) this.update();
  }

  update(): void {
    const pose = this.viewing.playback.currentDisplayPose();
    const index = this.viewing.playback.currentDisplayIndex();
    const set = (id: string, value: string) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };
    if (!pose) {
      for (const id of ["fx", "fy", "ft", "ftime", "favg", "flv", "frv", "fdeltat"]) set(id, "—");
      set("fcount", "Point: —/—");
    } else {
      set("fx", formatNumber(pose.x, 2));
      set("fy", formatNumber(pose.y, 2));
      set("ft", `${formatNumber(pose.theta, 2)}°`);
      set("ftime", `${formatNumber((pose.t ?? 0) / 1000, 2)}s`);
      set("favg", formatNumber(pose.speed_raw, 2));
      set("flv", formatNumber(pose.l_vel, 2));
      set("frv", formatNumber(pose.r_vel, 2));
      const previous = index > 0 ? this.viewing.data.poses[index - 1]?.t : null;
      set("fdeltat", previous != null && pose.t != null ? `${formatNumber((pose.t - previous) / 1000, 3)}s` : "—");
      set("fcount", `Point: ${index + 1}/${this.viewing.data.poses.length}`);
    }
    const reference = pose?.t ?? null;
    const closest = this.closestWatch(reference);
    set("fwatchtime", closest ? `${formatNumber(closest.t / 1000, 2)}s` : "—");
    set("fwatchlabel", closest?.label || "—");
    set("fwatchvalue", closest?.value == null ? "—" : String(closest.value));
    this.refreshPinnedPanels();
  }

  toggleWatch(watchId: number | string | null): void {
    const existing = watchId == null ? null : this.dom.pinnedWatchHost.querySelector<HTMLElement>(`.pinnedWatchPanel[data-watch-id="${CSS.escape(String(watchId))}"]`);
    if (existing) existing.remove();
    else this.openWatch(watchId);
  }

  openWatch(watchId: number | string | null): void {
    const panel = this.dom.pinnedWatchTemplate.content.firstElementChild?.cloneNode(true) as HTMLElement | null;
    if (!panel) return;
    panel.dataset.watchId = watchId == null ? "" : String(watchId);
    panel.style.top = `${128 + this.#panelCount * 26}px`;
    panel.style.right = `${16 + this.#panelCount * 18}px`;
    this.#panelCount += 1;
    panel.querySelector(".pinnedWatchClose")?.addEventListener("click", () => panel.remove());
    panel.querySelector(".pinnedWatchHeader")?.addEventListener("pointerdown", (event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      this.#pinnedDrag = { panel, x: event.clientX - panel.offsetLeft, y: event.clientY - panel.offsetTop };
      panel.style.left = `${panel.offsetLeft}px`;
      panel.style.right = "auto";
      event.preventDefault();
    });
    this.dom.pinnedWatchHost.appendChild(panel);
    this.updatePinnedPanel(panel);
  }

  refreshPinnedPanels(): void {
    for (const panel of this.dom.pinnedWatchHost.querySelectorAll<HTMLElement>(".pinnedWatchPanel")) this.updatePinnedPanel(panel);
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
      this.dom.floatingInfo.style.left = `${Math.max(0, event.clientX - this.#dragOffset.x)}px`;
      this.dom.floatingInfo.style.top = `${Math.max(0, event.clientY - this.#dragOffset.y)}px`;
    } else if (this.#resizeStart) {
      this.dom.floatingInfo.style.width = `${Math.max(30, Math.min(400, this.#resizeStart.width + event.clientX - this.#resizeStart.x))}px`;
      this.dom.floatingInfo.style.height = `${Math.max(49, Math.min(600, this.#resizeStart.height + event.clientY - this.#resizeStart.y))}px`;
    }
  }
}
