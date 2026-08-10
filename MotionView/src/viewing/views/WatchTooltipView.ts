import type { ViewingDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import type { WatchMarker } from "../viewingTypes";
import { formatNumber } from "../viewingPresentation";

/** Owns the popup shared by field and timeline watch interactions. */
export class WatchTooltipView {
  #positionFrame: number | null = null;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingDom,
  ) {}

  bind(): void {
    document.addEventListener("mousedown", (event) => {
      if (!this.dom.watchPopup.hidden && !this.dom.watchPopup.contains(event.target as Node)) this.hide();
    }, { capture: true });
  }

  show(marker: Readonly<WatchMarker>, position: Readonly<{ x: number; y: number }>): void {
    const pose = marker.pose ?? this.viewing.projection.interpolatePose(marker.t);
    this.dom.watchPopup.replaceChildren(
      this.row("Time", `${formatNumber(marker.t / 1000, 2)}s`),
      this.row("Pose", pose
        ? `X: ${formatNumber(pose.x, 1)} Y: ${formatNumber(pose.y, 1)} θ: ${formatNumber(pose.theta, 1)}°`
        : "—"),
      this.row("Name", marker.watch.label || "—"),
      this.row("Value", marker.watch.value == null ? "—" : String(marker.watch.value)),
    );
    this.dom.watchPopup.hidden = false;
    if (this.#positionFrame != null) cancelAnimationFrame(this.#positionFrame);
    this.#positionFrame = requestAnimationFrame(() => {
      this.#positionFrame = null;
      if (this.dom.watchPopup.hidden) return;
      const rect = this.dom.watchPopup.getBoundingClientRect();
      const maximumLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maximumTop = Math.max(8, window.innerHeight - rect.height - 8);
      const left = Math.max(8, Math.min(maximumLeft, position.x - rect.width / 2));
      const preferredTop = position.y - rect.height - 10;
      const top = preferredTop >= 8
        ? preferredTop
        : Math.max(8, Math.min(maximumTop, position.y + 10));
      this.dom.watchPopup.style.left = `${left}px`;
      this.dom.watchPopup.style.top = `${top}px`;
    });
  }

  hide(): void {
    if (this.#positionFrame != null) cancelAnimationFrame(this.#positionFrame);
    this.#positionFrame = null;
    this.dom.watchPopup.hidden = true;
  }

  private row(key: string, value: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "row";
    const keyElement = document.createElement("div");
    keyElement.className = "k";
    keyElement.textContent = key;
    const valueElement = document.createElement("div");
    valueElement.className = "v";
    valueElement.textContent = value;
    row.append(keyElement, valueElement);
    return row;
  }
}
