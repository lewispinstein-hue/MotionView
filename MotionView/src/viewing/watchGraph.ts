import Chart from "chart.js/auto";
import { requestDrawAll } from "../render/renderScheduler";
import type { WatchEntry } from "../state/models";
import type { ViewingSelectionController } from "./viewingSelection";
import type { WatchMarker } from "./viewingTypes";

export function watchGraphKeyForWatch(watch: Partial<WatchEntry> | null | undefined): string {
  const idNum = Number(watch?.id);
  if (Number.isInteger(idNum)) return `id:${idNum}`;
  return `label:${String(watch?.label ?? "").trim()}`;
}

export function isGraphableWatchValue(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  if (text === "true" || text === "false") return true;
  return Number.isFinite(Number(text));
}

export interface WatchGraphController {
  keyForWatch(watch: Partial<WatchEntry> | null | undefined): string;
  isGraphableValue(value: unknown): boolean;
  refreshPanelData(): void;
  openOrTogglePanel(marker: WatchMarker | null | undefined): void;
  toggleCurrentPanel(): void;
  hidePanel(options?: { preserveKey?: boolean }): void;
  resizeChart(): void;
  bindEvents(): void;
  handleWindowMouseMove(event: MouseEvent): void;
  handleWindowMouseUp(): void;
}

interface WatchGraphOptions {
  selection: ViewingSelectionController;
  panel: HTMLElement | null;
  header: HTMLElement | null;
  resizer: HTMLElement | null;
  closeButton: HTMLElement | null;
  subtitle: HTMLElement | null;
  title: HTMLElement | null;
  compareSelect: HTMLSelectElement | null;
  latest: HTMLElement | null;
  compareLatest: HTMLElement | null;
  count: HTMLElement | null;
  avg: HTMLElement | null;
  min: HTMLElement | null;
  max: HTMLElement | null;
  compareCount: HTMLElement | null;
  compareAvg: HTMLElement | null;
  compareMin: HTMLElement | null;
  compareMax: HTMLElement | null;
  canvas: HTMLCanvasElement | null;
  empty: HTMLElement | null;
  getData(): unknown;
  getWatches(): readonly WatchEntry[];
  getWatchMarkers(): readonly WatchMarker[];
  getWatchMarkersByTime(): readonly WatchMarker[];
  getReferenceTimeMs(): number | null;
  getCurrentPoseTimeMs(): number | null;
  getLatestRobotTimeMs(): number | null;
  isPlaying(): boolean;
  isLivestreaming(): boolean;
  lastWatchAtTime(markers: readonly WatchMarker[], timeMs: number): WatchMarker | null;
  formatNumber(value: number, decimals?: number): string;
  clamp(value: number, min: number, max: number): number;
  selectWatchMarker(marker: WatchMarker, fromUserClick: boolean, position?: { x: number; y: number } | null): void;
  updatePoseReadout(): void;
}

const FOLLOW_HEAD_TOLERANCE_S = 2.5;
const MIN_W = 420;
const MIN_H = 260;
const MAX_W = 980;
const MARGIN = 12;

function numericWatchValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "true") return 1;
  if (text === "false") return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function isBooleanWatchValue(value: unknown) {
  if (typeof value === "boolean") return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "false";
}

function formatCount(value: unknown) {
  return Number.isFinite(value) ? String(Math.trunc(Number(value))) : "—";
}

function formatNumeric(value: unknown, formatNumber: (value: number, decimals?: number) => string) {
  if (!Number.isFinite(value)) return "—";
  const n = Number(value);
  if (Number.isInteger(n)) return String(n);
  return formatNumber(n, 3);
}

export function createWatchGraph(options: WatchGraphOptions): WatchGraphController {
  let panelOpen = false;
  let panelKey: string | null = null;
  let compareKey = "";
  let chart: Chart | null = null;
  let markersForKey: WatchMarker[] = [];
  let compareMarkersForKey: WatchMarker[] = [];
  let zoomRange: { min: number; max: number } | null = null;
  let followLatest = false;
  let isDragging = false;
  let isResizing = false;
  let dragStart = { x: 0, y: 0 };
  let hoverSaved: {
    index: number;
    lockActive: boolean;
    lockPose: typeof options.selection.trackLockPose;
    lockIndex: number | null;
  } | null = null;

  const statsByKey = (key: string | null) => {
    if (!key) return { latest: null, count: 0, avg: null, min: null, max: null };
    let latest: WatchEntry | null = null;
    let count = 0;
    let sum = 0;
    let numericCount = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const entry of options.getWatches()) {
      if (watchGraphKeyForWatch(entry) !== key) continue;
      count += 1;
      if (!latest || (entry.t ?? 0) >= (latest.t ?? 0)) latest = entry;
      const numericValue = numericWatchValue(entry.value);
      if (numericValue == null) continue;
      sum += numericValue;
      numericCount += 1;
      min = Math.min(min, numericValue);
      max = Math.max(max, numericValue);
    }
    return {
      latest,
      count,
      avg: numericCount > 0 ? sum / numericCount : null,
      min: numericCount > 0 ? min : null,
      max: numericCount > 0 ? max : null,
    };
  };

  const findWatchByKeyAtOrBeforeTime = (key: string | null, timeMs: number | null) => {
    if (!key || timeMs == null) return null;
    const watches = options.getWatches();
    for (let i = watches.length - 1; i >= 0; i -= 1) {
      const entry = watches[i];
      if (watchGraphKeyForWatch(entry) !== key) continue;
      if ((entry.t ?? Infinity) <= timeMs) return entry;
    }
    return null;
  };

  const graphableWatchOptions = (currentKey = "") => {
    const seen = new Set<string>();
    const result: Array<{ key: string; label: string; id: number }> = [];
    const watches = options.getWatches();
    for (let i = watches.length - 1; i >= 0; i -= 1) {
      const watch = watches[i];
      if (!watch || !isGraphableWatchValue(watch.value)) continue;
      const key = watchGraphKeyForWatch(watch);
      if (!key || key === currentKey || seen.has(key)) continue;
      seen.add(key);
      result.push({
        key,
        label: String(watch.label || (Number.isInteger(Number(watch.id)) ? `Watch ${watch.id}` : "Unnamed Watch")),
        id: Number(watch.id),
      });
    }
    result.sort((a, b) => {
      const labelCmp = a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
      if (labelCmp !== 0) return labelCmp;
      const aHasId = Number.isInteger(a.id);
      const bHasId = Number.isInteger(b.id);
      if (aHasId && bHasId) return a.id - b.id;
      if (aHasId) return -1;
      if (bHasId) return 1;
      return a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: "base" });
    });
    return result;
  };

  const refreshCompareSelect = () => {
    const select = options.compareSelect;
    if (!select) return;
    const choices = graphableWatchOptions(panelKey ?? "");
    const previousValue = choices.some((choice) => choice.key === compareKey) ? compareKey : "";
    compareKey = previousValue;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = choices.length > 0 ? "No comparison" : "No comparison watches";
    select.appendChild(placeholder);
    for (const choice of choices) {
      const option = document.createElement("option");
      option.value = choice.key;
      option.textContent = choice.label;
      select.appendChild(option);
    }
    select.value = previousValue;
    select.disabled = choices.length === 0;
  };

  const collectSeries = (key: string | null) => {
    const points: Array<{ x: number; y: number; isBoolean: boolean }> = [];
    const markers: WatchMarker[] = [];
    let hasBooleanSeries = false;
    for (const marker of options.getWatchMarkers()) {
      const entry = marker?.watch;
      if (watchGraphKeyForWatch(entry) !== key) continue;
      const y = numericWatchValue(entry?.value);
      const tMs = Number(marker?.t);
      if (y == null || !Number.isFinite(tMs)) continue;
      hasBooleanSeries = hasBooleanSeries || isBooleanWatchValue(entry?.value);
      markers.push(marker);
      points.push({ x: tMs / 1000, y, isBoolean: isBooleanWatchValue(entry?.value) });
    }
    return { points, markers, hasBooleanSeries };
  };

  const seriesRange = (points: readonly { y: number }[]) => {
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
      const y = Number(point?.y);
      if (!Number.isFinite(y)) continue;
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max };
  };

  const normalizeBooleanPoints = (points: Array<{ x: number; y: number }>, referenceRange: { min: number; max: number } | null) => {
    if (!points.length) return [];
    let minValue = referenceRange?.min ?? 0;
    let maxValue = referenceRange?.max ?? 1;
    if (minValue === maxValue) {
      if (minValue === 0) maxValue = 1;
      else minValue = 0;
    }
    return points.map((point) => ({ x: point.x, y: point.y > 0 ? maxValue : minValue }));
  };

  const buildDatasets = (key: string | null, nextCompareKey = "") => {
    const primarySeries = collectSeries(key);
    const compareSeries = nextCompareKey ? collectSeries(nextCompareKey) : { points: [], markers: [], hasBooleanSeries: false };
    const primaryRange = seriesRange(primarySeries.points);
    const compareRange = seriesRange(compareSeries.points);
    const primaryPoints = primarySeries.hasBooleanSeries
      ? normalizeBooleanPoints(primarySeries.points, compareRange)
      : primarySeries.points.map((point) => ({ x: point.x, y: point.y }));
    const comparePoints = compareSeries.hasBooleanSeries
      ? normalizeBooleanPoints(compareSeries.points, primaryRange)
      : compareSeries.points.map((point) => ({ x: point.x, y: point.y }));
    const combinedRange = seriesRange(primaryPoints.concat(comparePoints));
    const yMin = combinedRange?.min ?? 0;
    const yMaxBase = combinedRange?.max ?? 1;
    return {
      primarySeries,
      compareSeries,
      primaryPoints,
      comparePoints,
      yRange: { min: yMin, max: yMin === yMaxBase ? (yMin === 0 ? 1 : yMin + 1) : yMaxBase },
    };
  };

  const timeRange = (primaryPoints: readonly { x: number }[], comparePoints: readonly { x: number }[]) => {
    const allPoints = primaryPoints.concat(comparePoints);
    let min = Infinity;
    let max = -Infinity;
    for (const point of allPoints) {
      const x = Number(point?.x);
      if (!Number.isFinite(x)) continue;
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    if (min === max) return { min, max: min + 1 };
    return { min, max };
  };

  const normalizeZoomRange = (range: { min: number; max: number } | null, fullRange: { min: number; max: number } | null) => {
    if (!range || !fullRange) return null;
    const fullMin = Number(fullRange.min);
    const fullMax = Number(fullRange.max);
    if (!Number.isFinite(fullMin) || !Number.isFinite(fullMax) || fullMax <= fullMin) return null;
    let min = options.clamp(Number(range.min), fullMin, fullMax);
    let max = options.clamp(Number(range.max), fullMin, fullMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    const minSpan = Math.min(0.1, fullMax - fullMin);
    if ((max - min) < minSpan) {
      const center = (min + max) / 2;
      min = center - minSpan / 2;
      max = center + minSpan / 2;
    }
    if (min < fullMin) {
      max += fullMin - min;
      min = fullMin;
    }
    if (max > fullMax) {
      min -= max - fullMax;
      max = fullMax;
    }
    min = options.clamp(min, fullMin, fullMax);
    max = options.clamp(max, fullMin, fullMax);
    if ((max - min) >= (fullMax - fullMin) - 1e-6) return null;
    return { min, max };
  };

  const rangeNearRobotHead = (range: { min: number; max: number } | null) => {
    if (!range) return false;
    const robotTimeMs = options.getLatestRobotTimeMs();
    const robotTime = Number.isFinite(robotTimeMs) ? Number(robotTimeMs) / 1000 : null;
    const rightEdge = Number(range.max);
    return Number.isFinite(robotTime) && Number.isFinite(rightEdge) && rightEdge >= Number(robotTime) - FOLLOW_HEAD_TOLERANCE_S;
  };

  const setZoomRange = (nextRange: { min: number; max: number }, fullRange: { min: number; max: number } | null) => {
    zoomRange = normalizeZoomRange(nextRange, fullRange);
    followLatest = rangeNearRobotHead(zoomRange);
  };

  const renderForKey = (key: string | null) => {
    if (!options.canvas) return;
    const { primarySeries, compareSeries, primaryPoints, comparePoints, yRange } = buildDatasets(key, compareKey);
    markersForKey = primarySeries.markers;
    compareMarkersForKey = compareSeries.markers;
    const hasPrimaryPoints = primaryPoints.length > 0;
    const hasComparePoints = comparePoints.length > 0;
    const fullTimeRange = timeRange(primaryPoints, comparePoints);
    let nextZoomRange = normalizeZoomRange(zoomRange, fullTimeRange);
    if (!followLatest && rangeNearRobotHead(nextZoomRange)) followLatest = true;
    if (followLatest && nextZoomRange && fullTimeRange) {
      const span = nextZoomRange.max - nextZoomRange.min;
      nextZoomRange = normalizeZoomRange({ min: fullTimeRange.max - span, max: fullTimeRange.max }, fullTimeRange);
    }
    zoomRange = nextZoomRange;
    if (!zoomRange) followLatest = false;
    if (options.empty) options.empty.hidden = hasPrimaryPoints || hasComparePoints;
    if (!hasPrimaryPoints) {
      if (chart) {
        chart.destroy();
        chart = null;
      }
      return;
    }
    const datasets: any[] = [{
      label: "Value",
      data: primaryPoints,
      borderColor: "#6ea8fff2",
      backgroundColor: "rgba(110, 168, 255, 0.25)",
      borderWidth: 2,
      pointRadius: 0,
      tension: primarySeries.hasBooleanSeries ? 0 : 0.1,
      stepped: primarySeries.hasBooleanSeries ? "after" : false,
    }];
    if (hasComparePoints) {
      datasets.push({
        label: "Comparison",
        data: comparePoints,
        borderColor: "#ff810c",
        backgroundColor: "rgba(255, 129, 12, 0.2)",
        borderWidth: 2,
        pointRadius: 0,
        tension: compareSeries.hasBooleanSeries ? 0 : 0.1,
        stepped: compareSeries.hasBooleanSeries ? "after" : false,
      });
    }
    if (!chart) {
      chart = new Chart(options.canvas, {
        type: "line",
        data: { datasets },
        options: {
          animation: false,
          maintainAspectRatio: false,
          parsing: false,
          normalized: true,
          scales: {
            x: {
              type: "linear",
              min: zoomRange?.min,
              max: zoomRange?.max,
              title: { display: true, text: "Time (s)", color: "rgba(255,255,255,0.75)" },
              ticks: { color: "rgba(255,255,255,0.72)" },
              grid: { color: "rgba(255,255,255,0.1)" },
            },
            y: {
              type: "linear",
              min: yRange.min,
              max: yRange.max,
              title: { display: true, text: "Value", color: "rgba(255,255,255,0.75)" },
              ticks: { color: "rgba(255,255,255,0.72)" },
              grid: { color: "rgba(255,255,255,0.1)" },
            },
          },
          plugins: { legend: { display: false } },
        },
      });
      return;
    }
    chart.data.datasets = datasets;
    if (chart.options?.scales?.x) {
      chart.options.scales.x.min = zoomRange?.min;
      chart.options.scales.x.max = zoomRange?.max;
    }
    if (chart.options?.scales?.y) {
      chart.options.scales.y.min = yRange.min;
      chart.options.scales.y.max = yRange.max;
    }
    chart.update("none");
  };

  const resizeChart = () => {
    if (!chart) return;
    chart.resize();
    chart.update("none");
  };

  const saveHoverState = () => {
    if (hoverSaved != null) return;
    hoverSaved = {
      index: options.selection.selectedIndex,
      lockActive: options.selection.trackLockActive,
      lockPose: options.selection.trackLockPose,
      lockIndex: options.selection.trackLockIndex,
    };
  };

  const clearHoverPreview = ({ restore = true } = {}) => {
    options.selection.hoverTimelineTime = null;
    if (restore && hoverSaved != null) {
      options.selection.selectedIndex = hoverSaved.index;
      options.selection.trackLockActive = hoverSaved.lockActive;
      options.selection.trackLockPose = hoverSaved.lockPose;
      options.selection.trackLockIndex = hoverSaved.lockIndex;
    }
    hoverSaved = null;
    options.updatePoseReadout();
    requestDrawAll();
  };

  const markerFromEvent = (event: MouseEvent) => {
    if (!chart) return null;
    const hits = chart.getElementsAtEventForMode(event, "nearest", { intersect: false }, false);
    if (!Array.isArray(hits) || !hits.length) return null;
    const datasetIndex = hits[0]?.datasetIndex;
    const pointIndex = hits[0]?.index;
    if (!Number.isInteger(pointIndex)) return null;
    if (datasetIndex === 1) return compareMarkersForKey[pointIndex] ?? null;
    return markersForKey[pointIndex] ?? null;
  };

  const hidePanel = ({ preserveKey = false } = {}) => {
    if (!options.panel) return;
    options.panel.classList.add("hidden");
    options.panel.classList.remove("isOn");
    panelOpen = false;
    if (!preserveKey) {
      panelKey = null;
      compareKey = "";
      zoomRange = null;
      followLatest = false;
    }
    markersForKey = [];
    compareMarkersForKey = [];
    clearHoverPreview({ restore: true });
    if (!preserveKey && chart) {
      chart.destroy();
      chart = null;
    }
    if (!preserveKey && options.empty) options.empty.hidden = false;
    refreshCompareSelect();
  };

  const refreshPanelData = () => {
    refreshCompareSelect();
    if (!panelOpen || !panelKey) return;
    const { latest, count, avg, min, max } = statsByKey(panelKey);
    const compareStats = compareKey ? statsByKey(compareKey) : null;
    if (!latest || count <= 0) {
      hidePanel();
      return;
    }
    const currentLatest = findWatchByKeyAtOrBeforeTime(panelKey, options.getReferenceTimeMs());
    const currentCompareLatest = compareKey ? findWatchByKeyAtOrBeforeTime(compareKey, options.getReferenceTimeMs()) : null;
    const idNum = Number(latest.id);
    const hasId = Number.isInteger(idNum);
    if (options.subtitle) options.subtitle.textContent = hasId ? `Id: ${idNum}` : "Id: —";
    if (options.title) options.title.textContent = String(latest.label ?? "") || "—";
    if (options.latest) options.latest.textContent = currentLatest?.value == null ? "—" : String(currentLatest.value);
    if (options.compareLatest) options.compareLatest.textContent = currentCompareLatest?.value == null ? "—" : String(currentCompareLatest.value);
    if (options.count) options.count.textContent = formatCount(count);
    if (options.avg) options.avg.textContent = formatNumeric(avg, options.formatNumber);
    if (options.min) options.min.textContent = formatNumeric(min, options.formatNumber);
    if (options.max) options.max.textContent = formatNumeric(max, options.formatNumber);
    if (options.compareCount) options.compareCount.textContent = formatCount(compareStats?.count);
    if (options.compareAvg) options.compareAvg.textContent = formatNumeric(compareStats?.avg, options.formatNumber);
    if (options.compareMin) options.compareMin.textContent = formatNumeric(compareStats?.min, options.formatNumber);
    if (options.compareMax) options.compareMax.textContent = formatNumeric(compareStats?.max, options.formatNumber);
    renderForKey(panelKey);
  };

  const showPanelForKey = (key: string) => {
    const { latest, count } = statsByKey(key);
    if (!latest || count <= 0 || !options.panel) return false;
    if (panelKey !== key) {
      zoomRange = null;
      followLatest = false;
    }
    options.panel.classList.remove("hidden");
    options.panel.classList.add("isOn");
    panelOpen = true;
    panelKey = key;
    refreshPanelData();
    resizeChart();
    return true;
  };

  const openOrTogglePanel = (marker: WatchMarker | null | undefined) => {
    const key = watchGraphKeyForWatch(marker?.watch || {});
    if (!key) return;
    if (panelOpen && panelKey === key) {
      hidePanel();
      return;
    }
    showPanelForKey(key);
  };

  const findClosestMarker = (targetMs: number) => {
    if (!Number.isFinite(targetMs)) return null;
    let closest: WatchMarker | null = null;
    let minDiff = Infinity;
    for (const marker of options.getWatchMarkers()) {
      const diff = Math.abs((marker?.t ?? 0) - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = marker;
      }
    }
    return closest;
  };

  const toggleCurrentPanel = () => {
    if (panelOpen) {
      hidePanel({ preserveKey: true });
      return;
    }
    if (panelKey && showPanelForKey(panelKey)) return;
    const selectedMarker = options.selection.selectedWatch?.marker ?? null;
    const poseTime = Number(options.getCurrentPoseTimeMs());
    const fallbackMarker = Number.isFinite(poseTime)
      ? (options.lastWatchAtTime(options.getWatchMarkersByTime(), poseTime) ?? findClosestMarker(poseTime))
      : (options.getWatchMarkers()[options.getWatchMarkers().length - 1] ?? null);
    const marker = selectedMarker || fallbackMarker;
    if (marker) openOrTogglePanel(marker);
  };

  const bindEvents = () => {
    options.closeButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hidePanel();
    });
    if (options.header && options.panel) {
      options.header.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("#btnCloseWatchGraph, #watchGraphCompareSelect")) return;
        isDragging = true;
        dragStart = {
          x: event.clientX - options.panel!.offsetLeft,
          y: event.clientY - options.panel!.offsetTop,
        };
        event.preventDefault();
      });
    }
    options.compareSelect?.addEventListener("change", () => {
      compareKey = options.compareSelect?.value || "";
      zoomRange = null;
      followLatest = false;
      renderForKey(panelKey);
    });
    options.compareSelect?.addEventListener("mousedown", (event) => event.stopPropagation());
    options.compareSelect?.addEventListener("pointerdown", (event) => event.stopPropagation());
    options.resizer?.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      isResizing = true;
      event.preventDefault();
      event.stopPropagation();
    });
    if (!options.canvas) return;
    options.canvas.addEventListener("mousemove", (event) => {
      if (!options.getData() || options.isPlaying() || !panelOpen) return;
      const marker = markerFromEvent(event);
      options.canvas!.style.cursor = marker ? "pointer" : "crosshair";
      if (!marker) {
        clearHoverPreview({ restore: true });
        return;
      }
      saveHoverState();
      options.selection.hoverTimelineTime = marker.t ?? null;
      options.updatePoseReadout();
      requestDrawAll();
    });
    options.canvas.addEventListener("mouseleave", () => {
      if (!options.getData() || options.isPlaying()) return;
      options.canvas!.style.cursor = "default";
      clearHoverPreview({ restore: true });
    });
    options.canvas.addEventListener("mousedown", (event) => {
      if (!options.getData() || options.isPlaying() || !panelOpen) return;
      if (options.isLivestreaming() || event.button !== 0) return;
      const marker = markerFromEvent(event);
      if (!marker) return;
      event.preventDefault();
      clearHoverPreview({ restore: false });
      options.selectWatchMarker(marker, false, null);
    });
    options.canvas.addEventListener("wheel", (event) => {
      if (!panelOpen || !chart) return;
      const chartArea = chart.chartArea;
      const xScale = chart.scales?.x;
      if (!chartArea || !xScale || !options.canvas) return;
      const rect = options.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) return;
      const datasets = chart.data?.datasets ?? [];
      const fullRange = timeRange((datasets[0]?.data as any) ?? [], (datasets[1]?.data as any) ?? []);
      if (!fullRange) return;
      event.preventDefault();
      const currentMin = Number.isFinite(xScale.min) ? xScale.min : fullRange.min;
      const currentMax = Number.isFinite(xScale.max) ? xScale.max : fullRange.max;
      const currentSpan = currentMax - currentMin;
      if (!Number.isFinite(currentSpan) || currentSpan <= 0) return;
      const anchor = xScale.getValueForPixel(x);
      if (!Number.isFinite(anchor)) return;
      const zoomFactor = Math.exp((event.deltaY || 0) * 0.0012);
      let nextSpan = currentSpan * zoomFactor;
      nextSpan = options.clamp(nextSpan, Math.min(0.1, fullRange.max - fullRange.min), fullRange.max - fullRange.min);
      const ratio = (Number(anchor) - currentMin) / currentSpan;
      const nextMin = Number(anchor) - nextSpan * ratio;
      setZoomRange({ min: nextMin, max: nextMin + nextSpan }, fullRange);
      renderForKey(panelKey);
    }, { passive: false });
  };

  return {
    keyForWatch: watchGraphKeyForWatch,
    isGraphableValue: isGraphableWatchValue,
    refreshPanelData,
    openOrTogglePanel,
    toggleCurrentPanel,
    hidePanel,
    resizeChart,
    bindEvents,
    handleWindowMouseMove(event) {
      if (isDragging && options.panel) {
        const nextLeft = event.clientX - dragStart.x;
        const nextTop = event.clientY - dragStart.y;
        const rect = options.panel.getBoundingClientRect();
        const clampedLeft = options.clamp(nextLeft, 0, Math.max(0, window.innerWidth - rect.width));
        const clampedTop = options.clamp(nextTop, 0, Math.max(0, window.innerHeight - rect.height));
        options.panel.style.left = `${clampedLeft}px`;
        options.panel.style.top = `${clampedTop}px`;
        options.panel.style.right = "auto";
      }
      if (isResizing && options.panel) {
        let newWidth = event.clientX - options.panel.offsetLeft;
        let newHeight = event.clientY - options.panel.offsetTop;
        const maxWidth = Math.max(MIN_W, window.innerWidth - options.panel.offsetLeft - MARGIN);
        const maxHeight = Math.max(MIN_H, window.innerHeight - options.panel.offsetTop - MARGIN);
        newWidth = options.clamp(newWidth, MIN_W, Math.min(MAX_W, maxWidth));
        newHeight = options.clamp(newHeight, MIN_H, maxHeight);
        options.panel.style.width = `${newWidth}px`;
        options.panel.style.height = `${newHeight}px`;
        resizeChart();
      }
    },
    handleWindowMouseUp() {
      isDragging = false;
      isResizing = false;
    },
  };
}
