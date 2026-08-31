import Chart from "chart.js/auto";
import type { ChartDataset } from "chart.js";
import type { ViewingGraphDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import type { WatchMarker } from "../viewingTypes";
import { formatNumber, isGraphableWatchValue, watchGraphKey } from "../viewingPresentation";

const PRIMARY_COLOR = "#6ea8ff";
const COMPARISON_COLOR = "#ff810c";

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return null;
}

function numericValue(value: unknown): number | null {
  const boolean = booleanValue(value);
  if (boolean != null) return boolean ? 1 : 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export class WatchGraphView {
  #key: string | null = null;
  #chart: Chart | null = null;
  #xBounds: Readonly<{ minimum: number; maximum: number }> | null = null;
  #primaryMarkers: readonly Readonly<WatchMarker>[] = [];
  #comparisonMarkers: readonly Readonly<WatchMarker>[] = [];
  #dragOffset: Readonly<{ x: number; y: number }> | null = null;
  #resizeStart: Readonly<{ x: number; y: number; width: number; height: number }> | null = null;
  readonly #stateListeners = new Set<() => void>();

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingGraphDom,
  ) {}

  bind(): void {
    this.dom.close.addEventListener("click", () => this.hide());
    this.dom.compareSelect.addEventListener("change", () => this.render());
    this.dom.header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button,select"))) return;
      const rect = this.dom.panel.getBoundingClientRect();
      this.#dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      this.dom.header.setPointerCapture?.(event.pointerId);
    });
    this.dom.resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = this.dom.panel.getBoundingClientRect();
      this.#resizeStart = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
      this.dom.resizer.setPointerCapture?.(event.pointerId);
    });
    window.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    window.addEventListener("pointerup", () => {
      this.#dragOffset = null;
      this.#resizeStart = null;
    });
    this.dom.canvas.addEventListener("wheel", (event) => {
      if (!this.#chart) return;
      event.preventDefault();
      const scale = this.#chart.scales.x;
      const range = Number(scale.max) - Number(scale.min);
      const bounds = this.#xBounds;
      if (!bounds || !Number.isFinite(range) || range <= 0) return;
      const dataRange = bounds.maximum - bounds.minimum;
      if (dataRange <= 0) return;
      const factor = Math.exp(event.deltaY * 0.0012);
      const currentMinimum = Number(scale.min);
      const cursorValue = Number(scale.getValueForPixel(event.offsetX));
      const anchor = Number.isFinite(cursorValue)
        ? Math.max(Number(scale.min), Math.min(Number(scale.max), cursorValue))
        : (Number(scale.max) + currentMinimum) / 2;
      const anchorRatio = Math.max(0, Math.min(1, (anchor - currentMinimum) / range));
      const nextRange = Math.min(dataRange, Math.max(Math.min(0.1, dataRange), range * factor));
      let minimum = anchor - nextRange * anchorRatio;
      let maximum = minimum + nextRange;
      if (minimum < bounds.minimum) {
        minimum = bounds.minimum;
        maximum = minimum + nextRange;
      }
      if (maximum > bounds.maximum) {
        maximum = bounds.maximum;
        minimum = maximum - nextRange;
      }
      this.#chart.options.scales!.x!.min = minimum;
      this.#chart.options.scales!.x!.max = maximum;
      this.#chart.update("none");
    }, { passive: false });
    this.dom.canvas.addEventListener("mousemove", (event) => {
      if (!this.#chart || this.viewing.playback.isPlaying) return;
      const marker = this.nearestMarkerAtPixel(event.offsetX);
      this.dom.canvas.style.cursor = marker ? "crosshair" : "default";
      this.viewing.navigation.setTimelineHover(marker?.t ?? null);
    });
    this.dom.canvas.addEventListener("mouseleave", () => {
      this.dom.canvas.style.cursor = "default";
      this.viewing.navigation.setTimelineHover(null);
    });
    this.dom.canvas.addEventListener("mousedown", (event) => {
      if (!this.#chart || this.viewing.playback.isPlaying || this.viewing.navigation.livestreaming) return;
      const marker = this.nearestMarkerAtPixel(event.offsetX);
      if (!marker) return;
      const pose = this.viewing.projection.interpolatePose(marker.t) ?? marker.pose;
      const index = marker.idx ?? this.viewing.projection.findFloorIndex(marker.t);
      if (!pose || index < 0) return;
      this.viewing.navigation.setTimelineHover(null);
      this.viewing.navigation.lockTrack(pose, index);
      this.viewing.navigation.selectWatch(marker);
    });
  }

  open(marker: Readonly<WatchMarker>): void {
    const key = watchGraphKey(marker.watch);
    if (!isGraphableWatchValue(marker.watch.value)) return;
    if (this.#key === key && !this.dom.panel.classList.contains("hidden")) {
      this.hide();
      return;
    }
    this.#key = key;
    this.dom.panel.classList.remove("hidden");
    this.render();
    this.notifyStateChanged();
  }

  onStateChanged(listener: () => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  isOpenFor(marker: Readonly<WatchMarker>): boolean {
    return this.#key === watchGraphKey(marker.watch) && !this.dom.panel.classList.contains("hidden");
  }

  toggle(): void {
    if (!this.#key) {
      const marker = this.viewing.navigation.selectedWatch;
      if (marker) this.open(marker);
      return;
    }
    this.dom.panel.classList.toggle("hidden");
    if (!this.dom.panel.classList.contains("hidden")) this.render();
    this.notifyStateChanged();
  }

  hide(): void {
    if (this.dom.panel.classList.contains("hidden")) return;
    this.dom.panel.classList.add("hidden");
    this.notifyStateChanged();
  }

  resize(): void {
    this.#chart?.resize();
  }

  private notifyStateChanged(): void {
    for (const listener of this.#stateListeners) listener();
  }

  updatePlayhead(): void {
    if (!this.#key || this.dom.panel.classList.contains("hidden")) return;
    this.renderLatestValues(this.viewing.playback.currentDisplayPose()?.t ?? null);
  }

  render(): void {
    if (!this.#key || this.dom.panel.classList.contains("hidden")) return;
    const previousViewport = this.captureViewport();
    const previousBounds = this.#xBounds;
    const primary = this.markersForKey(this.#key);
    const compareKey = this.dom.compareSelect.value;
    const comparison = compareKey ? this.markersForKey(compareKey) : [];
    this.#primaryMarkers = primary;
    this.#comparisonMarkers = comparison;
    const representative = primary[primary.length - 1]?.watch;
    this.dom.title.textContent = representative?.label || "Watch";
    this.dom.subtitle.textContent = representative?.id == null ? "ID: —" : `ID: ${representative.id}`;
    this.renderCompareOptions();
    this.renderStats(primary, comparison);
    const datasets: ChartDataset<"line", Array<{ x: number; y: number }>>[] = [];
    const primaryData = this.points(primary);
    const primaryBoolean = this.isBooleanSeries(primary);
    if (primaryData.length) datasets.push(this.dataset(representative?.label || "Watch", primaryData, PRIMARY_COLOR, primaryBoolean));
    const compareData = this.points(comparison);
    const comparisonBoolean = this.isBooleanSeries(comparison);
    if (compareData.length) datasets.push(this.dataset(comparison.at(-1)?.watch.label || "Compare", compareData, COMPARISON_COLOR, comparisonBoolean));
    const allPoints = [...primaryData, ...compareData];
    const times = allPoints.map((point) => point.x);
    const minimumTime = times.length ? Math.min(...times) : 0;
    const maximumTime = times.length ? Math.max(...times) : 0;
    this.#xBounds = times.length ? { minimum: minimumTime, maximum: maximumTime } : null;
    const viewport = this.nextViewport(previousViewport, previousBounds, this.#xBounds);
    const allBoolean = datasets.length > 0 && (!primaryData.length || primaryBoolean) && (!compareData.length || comparisonBoolean);
    this.dom.empty.classList.toggle("hidden", datasets.length > 0);
    this.#chart?.destroy();
    this.#chart = datasets.length ? new Chart(this.dom.canvas, {
      type: "line",
      data: { datasets },
      options: {
        animation: false,
        parsing: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "nearest" },
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            type: "linear",
            min: minimumTime === maximumTime ? undefined : viewport?.minimum ?? minimumTime,
            max: minimumTime === maximumTime ? undefined : viewport?.maximum ?? maximumTime,
            grid: { color: "rgba(255,255,255,.08)" },
            border: { color: "rgba(255,255,255,.18)" },
            ticks: { color: "rgba(255,255,255,.62)", callback: (value) => `${formatNumber(Number(value), 2)}s` },
          },
          y: {
            type: "linear",
            min: allBoolean ? 0 : undefined,
            max: allBoolean ? 1 : undefined,
            grid: { color: "rgba(255,255,255,.08)" },
            border: { color: "rgba(255,255,255,.18)" },
            ticks: {
              color: "rgba(255,255,255,.62)",
              stepSize: allBoolean ? 1 : undefined,
              callback: allBoolean ? (value) => Number(value) === 0 || Number(value) === 1 ? String(value) : "" : undefined,
            },
          },
        },
      },
    }) : null;
  }

  private captureViewport(): Readonly<{ minimum: number; maximum: number }> | null {
    const scale = this.#chart?.scales.x;
    if (!scale) return null;
    const minimum = Number(scale.min);
    const maximum = Number(scale.max);
    return Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum
      ? { minimum, maximum }
      : null;
  }

  private nextViewport(
    viewport: Readonly<{ minimum: number; maximum: number }> | null,
    previousBounds: Readonly<{ minimum: number; maximum: number }> | null,
    nextBounds: Readonly<{ minimum: number; maximum: number }> | null,
  ): Readonly<{ minimum: number; maximum: number }> | null {
    if (!viewport || !previousBounds || !nextBounds) return nextBounds;
    const dataRange = previousBounds.maximum - previousBounds.minimum;
    const viewRange = viewport.maximum - viewport.minimum;
    const epsilon = Math.max(0.0001, dataRange * 0.001);
    if (viewRange >= dataRange - epsilon) return nextBounds;

    const followsLatest = Math.abs(viewport.maximum - previousBounds.maximum) <= epsilon;
    let maximum = followsLatest ? nextBounds.maximum : viewport.maximum;
    let minimum = followsLatest ? maximum - viewRange : viewport.minimum;
    if (minimum < nextBounds.minimum) {
      minimum = nextBounds.minimum;
      maximum = minimum + viewRange;
    }
    if (maximum > nextBounds.maximum) {
      maximum = nextBounds.maximum;
      minimum = maximum - viewRange;
    }
    return {
      minimum: Math.max(nextBounds.minimum, minimum),
      maximum: Math.min(nextBounds.maximum, maximum),
    };
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

  private isBooleanSeries(markers: readonly Readonly<WatchMarker>[]): boolean {
    return markers.length > 0 && markers.every((marker) => booleanValue(marker.watch.value) != null);
  }

  private dataset(
    label: string,
    data: Array<{ x: number; y: number }>,
    color: string,
    stepped: boolean,
  ): ChartDataset<"line", Array<{ x: number; y: number }>> {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      stepped,
      tension: 0,
      fill: false,
    };
  }

  private renderCompareOptions(): void {
    const current = this.dom.compareSelect.value;
    this.dom.compareSelect.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Compare…";
    this.dom.compareSelect.appendChild(none);
    const keys = new Map<string, string>();
    for (const watch of this.viewing.data.watches) {
      const key = watchGraphKey(watch);
      if (key !== this.#key && isGraphableWatchValue(watch.value)) keys.set(key, watch.label || key);
    }
    for (const [key, label] of keys) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      this.dom.compareSelect.appendChild(option);
    }
    this.dom.compareSelect.value = keys.has(current) ? current : "";
  }

  private renderStats(primary: readonly Readonly<WatchMarker>[], comparison: readonly Readonly<WatchMarker>[]): void {
    const write = (markers: readonly Readonly<WatchMarker>[], count: HTMLElement, average: HTMLElement, minimum: HTMLElement, maximum: HTMLElement) => {
      const values = markers.map((marker) => numericValue(marker.watch.value)).filter((value): value is number => value != null);
      count.textContent = String(values.length);
      average.textContent = values.length ? formatNumber(values.reduce((sum, value) => sum + value, 0) / values.length, 3) : "—";
      minimum.textContent = values.length ? formatNumber(Math.min(...values), 3) : "—";
      maximum.textContent = values.length ? formatNumber(Math.max(...values), 3) : "—";
    };
    write(primary, this.dom.count, this.dom.average, this.dom.minimum, this.dom.maximum);
    write(comparison, this.dom.compareCount, this.dom.compareAverage, this.dom.compareMinimum, this.dom.compareMaximum);
    this.renderLatestValues(this.viewing.playback.currentDisplayPose()?.t ?? null);
  }

  private renderLatestValues(time: number | null): void {
    const write = (markers: readonly Readonly<WatchMarker>[], element: HTMLElement) => {
      const marker = time == null ? markers.at(-1) : this.latestMarkerAtOrBefore(markers, time);
      const value = numericValue(marker?.watch.value);
      element.textContent = value == null ? "—" : formatNumber(value, 3);
    };
    write(this.#primaryMarkers, this.dom.latest);
    write(this.#comparisonMarkers, this.dom.compareLatest);
  }

  private latestMarkerAtOrBefore(markers: readonly Readonly<WatchMarker>[], time: number): Readonly<WatchMarker> | null {
    let low = 0;
    let high = markers.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((markers[middle]?.t ?? Infinity) <= time) low = middle + 1;
      else high = middle - 1;
    }
    return high >= 0 ? markers[high] ?? null : null;
  }

  private nearestMarkerAtPixel(pixel: number): Readonly<WatchMarker> | null {
    const chart = this.#chart;
    if (!chart || pixel < chart.chartArea.left || pixel > chart.chartArea.right) return null;
    const seconds = Number(chart.scales.x.getValueForPixel(pixel));
    if (!Number.isFinite(seconds)) return null;
    const time = seconds * 1000;
    const nearest = (markers: readonly Readonly<WatchMarker>[]): Readonly<WatchMarker> | null => {
      if (!markers.length) return null;
      let low = 0;
      let high = markers.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if ((markers[middle]?.t ?? Infinity) < time) low = middle + 1;
        else high = middle;
      }
      const before = markers[Math.max(0, low - 1)] ?? null;
      const after = markers[Math.min(markers.length - 1, low)] ?? null;
      if (!before) return after;
      if (!after) return before;
      return Math.abs(before.t - time) <= Math.abs(after.t - time) ? before : after;
    };
    const primary = nearest(this.#primaryMarkers);
    const comparison = nearest(this.#comparisonMarkers);
    if (!primary) return comparison;
    if (!comparison) return primary;
    return Math.abs(primary.t - time) <= Math.abs(comparison.t - time) ? primary : comparison;
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.#dragOffset) {
      const maxLeft = Math.max(12, window.innerWidth - this.dom.panel.offsetWidth - 12);
      const maxTop = Math.max(12, window.innerHeight - this.dom.panel.offsetHeight - 12);
      this.dom.panel.style.left = `${Math.max(12, Math.min(maxLeft, event.clientX - this.#dragOffset.x))}px`;
      this.dom.panel.style.top = `${Math.max(12, Math.min(maxTop, event.clientY - this.#dragOffset.y))}px`;
    } else if (this.#resizeStart) {
      this.dom.panel.style.width = `${Math.max(420, Math.min(980, this.#resizeStart.width + event.clientX - this.#resizeStart.x))}px`;
      this.dom.panel.style.height = `${Math.max(260, Math.min(window.innerHeight - 24, this.#resizeStart.height + event.clientY - this.#resizeStart.y))}px`;
      this.resize();
    }
  }
}
