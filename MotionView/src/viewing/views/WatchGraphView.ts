import Chart from "chart.js/auto";
import type { ChartDataset } from "chart.js";
import type { ViewingDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import type { WatchMarker } from "../viewingTypes";
import { formatNumber, isGraphableWatchValue, watchGraphKey } from "../viewingPresentation";

function numericValue(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export class WatchGraphView {
  #key: string | null = null;
  #chart: Chart | null = null;
  #dragOffset: Readonly<{ x: number; y: number }> | null = null;
  #resizeStart: Readonly<{ x: number; y: number; width: number; height: number }> | null = null;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingDom,
  ) {}

  bind(): void {
    this.dom.closeWatchGraph.addEventListener("click", () => this.hide());
    this.dom.watchGraphCompareSelect.addEventListener("change", () => this.render());
    this.dom.watchGraphHeader.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button,select"))) return;
      const rect = this.dom.watchGraphPanel.getBoundingClientRect();
      this.#dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      this.dom.watchGraphHeader.setPointerCapture?.(event.pointerId);
    });
    this.dom.watchGraphResizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = this.dom.watchGraphPanel.getBoundingClientRect();
      this.#resizeStart = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
      this.dom.watchGraphResizer.setPointerCapture?.(event.pointerId);
    });
    window.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    window.addEventListener("pointerup", () => {
      this.#dragOffset = null;
      this.#resizeStart = null;
    });
    this.dom.watchGraphCanvas.addEventListener("wheel", (event) => {
      if (!this.#chart) return;
      event.preventDefault();
      const scale = this.#chart.scales.x;
      const range = Number(scale.max) - Number(scale.min);
      if (!Number.isFinite(range) || range <= 0) return;
      const factor = Math.exp(event.deltaY * 0.0012);
      const midpoint = (Number(scale.max) + Number(scale.min)) / 2;
      const nextRange = Math.max(0.1, range * factor);
      this.#chart.options.scales!.x!.min = midpoint - nextRange / 2;
      this.#chart.options.scales!.x!.max = midpoint + nextRange / 2;
      this.#chart.update("none");
    }, { passive: false });
  }

  open(marker: Readonly<WatchMarker>): void {
    const key = watchGraphKey(marker.watch);
    if (!isGraphableWatchValue(marker.watch.value)) return;
    if (this.#key === key && !this.dom.watchGraphPanel.classList.contains("hidden")) {
      this.hide();
      return;
    }
    this.#key = key;
    this.dom.watchGraphPanel.classList.remove("hidden");
    this.render();
  }

  toggle(): void {
    if (!this.#key) {
      const marker = this.viewing.navigation.selectedWatch;
      if (marker) this.open(marker);
      return;
    }
    this.dom.watchGraphPanel.classList.toggle("hidden");
    if (!this.dom.watchGraphPanel.classList.contains("hidden")) this.render();
  }

  hide(): void {
    this.dom.watchGraphPanel.classList.add("hidden");
  }

  resize(): void {
    this.#chart?.resize();
  }

  render(): void {
    if (!this.#key || this.dom.watchGraphPanel.classList.contains("hidden")) return;
    const primary = this.markersForKey(this.#key);
    const compareKey = this.dom.watchGraphCompareSelect.value;
    const comparison = compareKey ? this.markersForKey(compareKey) : [];
    const representative = primary[primary.length - 1]?.watch;
    this.dom.watchGraphTitle.textContent = representative?.label || "Watch";
    this.dom.watchGraphSubtitle.textContent = representative?.id == null ? "ID: —" : `ID: ${representative.id}`;
    this.renderCompareOptions();
    this.renderStats(primary, comparison);
    const datasets: ChartDataset<"line", Array<{ x: number; y: number }>>[] = [];
    const primaryData = this.points(primary);
    if (primaryData.length) datasets.push({ label: representative?.label || "Watch", data: primaryData, borderColor: "#58d7ff", backgroundColor: "rgba(88,215,255,.18)", pointRadius: 1.5, tension: 0.15 });
    const compareData = this.points(comparison);
    if (compareData.length) datasets.push({ label: comparison.at(-1)?.watch.label || "Compare", data: compareData, borderColor: "#ffca58", backgroundColor: "rgba(255,202,88,.14)", pointRadius: 1.5, tension: 0.15 });
    this.dom.watchGraphEmpty.classList.toggle("hidden", datasets.length > 0);
    this.#chart?.destroy();
    this.#chart = datasets.length ? new Chart(this.dom.watchGraphCanvas, {
      type: "line",
      data: { datasets },
      options: {
        animation: false,
        parsing: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "nearest" },
        scales: {
          x: { type: "linear", ticks: { callback: (value) => `${formatNumber(Number(value), 2)}s` } },
          y: { type: "linear" },
        },
      },
    }) : null;
  }

  private markersForKey(key: string): Readonly<WatchMarker>[] {
    return this.viewing.projection.watchMarkers.filter((marker) => watchGraphKey(marker.watch) === key);
  }

  private points(markers: readonly Readonly<WatchMarker>[]): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    for (const marker of markers) {
      const value = numericValue(marker.watch.value);
      if (value != null) points.push({ x: marker.t / 1000, y: value });
    }
    return points;
  }

  private renderCompareOptions(): void {
    const current = this.dom.watchGraphCompareSelect.value;
    this.dom.watchGraphCompareSelect.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Compare…";
    this.dom.watchGraphCompareSelect.appendChild(none);
    const keys = new Map<string, string>();
    for (const watch of this.viewing.data.watches) {
      const key = watchGraphKey(watch);
      if (key !== this.#key && isGraphableWatchValue(watch.value)) keys.set(key, watch.label || key);
    }
    for (const [key, label] of keys) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      this.dom.watchGraphCompareSelect.appendChild(option);
    }
    this.dom.watchGraphCompareSelect.value = keys.has(current) ? current : "";
  }

  private renderStats(primary: readonly Readonly<WatchMarker>[], comparison: readonly Readonly<WatchMarker>[]): void {
    const write = (markers: readonly Readonly<WatchMarker>[], latest: HTMLElement, count: HTMLElement, average: HTMLElement, minimum: HTMLElement, maximum: HTMLElement) => {
      const values = markers.map((marker) => numericValue(marker.watch.value)).filter((value): value is number => value != null);
      latest.textContent = values.length ? formatNumber(values.at(-1), 3) : "—";
      count.textContent = String(values.length);
      average.textContent = values.length ? formatNumber(values.reduce((sum, value) => sum + value, 0) / values.length, 3) : "—";
      minimum.textContent = values.length ? formatNumber(Math.min(...values), 3) : "—";
      maximum.textContent = values.length ? formatNumber(Math.max(...values), 3) : "—";
    };
    write(primary, this.dom.watchGraphLatest, this.dom.watchGraphCount, this.dom.watchGraphAverage, this.dom.watchGraphMinimum, this.dom.watchGraphMaximum);
    write(comparison, this.dom.watchGraphCompareLatest, this.dom.watchGraphCompareCount, this.dom.watchGraphCompareAverage, this.dom.watchGraphCompareMinimum, this.dom.watchGraphCompareMaximum);
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.#dragOffset) {
      const maxLeft = Math.max(12, window.innerWidth - this.dom.watchGraphPanel.offsetWidth - 12);
      const maxTop = Math.max(12, window.innerHeight - this.dom.watchGraphPanel.offsetHeight - 12);
      this.dom.watchGraphPanel.style.left = `${Math.max(12, Math.min(maxLeft, event.clientX - this.#dragOffset.x))}px`;
      this.dom.watchGraphPanel.style.top = `${Math.max(12, Math.min(maxTop, event.clientY - this.#dragOffset.y))}px`;
    } else if (this.#resizeStart) {
      this.dom.watchGraphPanel.style.width = `${Math.max(420, Math.min(980, this.#resizeStart.width + event.clientX - this.#resizeStart.x))}px`;
      this.dom.watchGraphPanel.style.height = `${Math.max(260, Math.min(window.innerHeight - 24, this.#resizeStart.height + event.clientY - this.#resizeStart.y))}px`;
      this.resize();
    }
  }
}
