import type { Pose, WatchEntry } from "../state/models";

export interface FloatingInfoController {
  toggleInfo(): void;
  updateInfo(pose: Pose | null, index: number): void;
  refreshPinnedPanels(): void;
  toggleWatch(watchId: number | string | null): HTMLElement | null;
  openWatch(watchId: number | string | null): HTMLElement | null;
  handleWindowMouseMove(event: MouseEvent): void;
  handleWindowMouseUp(): void;
}

interface FloatingInfoOptions {
  floatWindow: HTMLElement | null;
  toggleButton: HTMLElement | null;
  closeButton: HTMLElement | null;
  header: HTMLElement | null;
  resizer: HTMLElement | null;
  pinnedHost: HTMLElement | null;
  pinnedTemplate: HTMLTemplateElement | null;
  bounds: { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number };
  getWatches(): readonly WatchEntry[];
  getReferenceTimeMs(): number | null;
  getLockedTimeMs(): number | null;
  getHoverTimeMs(): number | null;
  hasData(): boolean;
  hasPoses(): boolean;
  isWatchMarkerVisibleForClosestWatch(watch: WatchEntry): boolean;
  speedFromNorm(value: number | null | undefined): number | null;
  normFromSpeedRaw(value: number | null | undefined): number;
  formatNumber(value: number, decimals?: number, fallback?: string): string;
  setPlayTimeMs(timeMs: number | null): void;
  pausePlayback(): void;
  setSelectedIndex(index: number): void;
  findFloorIndexByTime(timeMs: number): number;
  updatePoseReadout(): void;
  requestDrawAll(): void;
  levelStyle(level: string): { fill: string; text: string };
  normalizeLogLevel(level: unknown): string;
  onToggle(enabled: boolean): void;
}

export function createFloatingInfo(options: FloatingInfoOptions): FloatingInfoController {
  let panelCount = 0;
  let pinnedDragTarget: HTMLElement | null = null;
  let pinnedDragStart = { x: 0, y: 0 };
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let isResizing = false;

  const findLatestWatchById = (watchId: number | string | null) => {
    if (watchId == null) return null;
    const normalizedId = String(watchId);
    const watches = options.getWatches();
    for (let i = watches.length - 1; i >= 0; i -= 1) {
      const watch = watches[i] as WatchEntry & { watchId?: unknown };
      const candidateId = watch?.id ?? watch?.watchId;
      if (candidateId != null && String(candidateId) === normalizedId) return watch;
    }
    return null;
  };

  const findWatchByIdAtOrBeforeTime = (watchId: number | string | null, timeMs: number | null) => {
    if (watchId == null || timeMs == null) return null;
    const normalizedId = String(watchId);
    const watches = options.getWatches();
    for (let i = watches.length - 1; i >= 0; i -= 1) {
      const watch = watches[i] as WatchEntry & { watchId?: unknown };
      const candidateId = watch?.id ?? watch?.watchId;
      if (candidateId == null || String(candidateId) !== normalizedId) continue;
      if ((watch.t ?? Infinity) <= timeMs) return watch;
    }
    return null;
  };

  const applyPinnedLevel = (element: Element | null, levelRaw: unknown) => {
    if (!(element instanceof HTMLElement)) return;
    const style = options.levelStyle(options.normalizeLogLevel(levelRaw));
    element.style.background = style.fill;
    element.style.color = style.text;
    element.style.borderColor = "rgba(255, 255, 255, 0.10)";
  };

  const getPinnedPanelById = (watchId: number | string | null) => {
    if (!options.pinnedHost || watchId == null) return null;
    return options.pinnedHost.querySelector(`.pinnedWatchPanel[data-watch-id="${CSS.escape(String(watchId))}"]`) as HTMLElement | null;
  };

  const closePinnedPanel = (panel: HTMLElement | null) => {
    if (!panel) return;
    if (pinnedDragTarget === panel) pinnedDragTarget = null;
    panel.remove();
  };

  const updatePinnedPanel = (panel: HTMLElement | null, watchId: number | string | null) => {
    if (!panel) return;
    const timeMs = options.getReferenceTimeMs();
    const latest = findWatchByIdAtOrBeforeTime(watchId, timeMs);
    const latestOverall = findLatestWatchById(watchId);
    const nameEl = panel.querySelector(".pinnedWatchName");
    const valueEl = panel.querySelector(".pinnedWatchValue");
    const label = latest?.label || latestOverall?.label || (watchId == null ? "No watch selected" : `Watch ${watchId}`);
    if (nameEl) nameEl.textContent = label;
    if (valueEl) valueEl.textContent = latest?.value != null ? String(latest.value) : "—";
    applyPinnedLevel(valueEl, latest?.level ?? "INFO");
  };

  const refreshPinnedPanels = () => {
    if (!options.pinnedHost) return;
    const panels = options.pinnedHost.querySelectorAll(".pinnedWatchPanel");
    for (const panel of panels) {
      updatePinnedPanel(panel as HTMLElement, (panel as HTMLElement).dataset.watchId || null);
    }
  };

  const openWatch = (watchId: number | string | null) => {
    if (!options.pinnedHost || !options.pinnedTemplate) return null;
    const root = options.pinnedTemplate.content.firstElementChild?.cloneNode(true) as HTMLElement | null;
    if (!root) return null;
    const headerEl = root.querySelector(".pinnedWatchHeader");
    const closeEl = root.querySelector(".pinnedWatchClose");
    root.dataset.watchId = watchId == null ? "" : String(watchId);
    root.style.top = `${128 + panelCount * 26}px`;
    root.style.right = `${16 + panelCount * 18}px`;
    panelCount += 1;
    updatePinnedPanel(root, watchId);
    headerEl?.addEventListener("mousedown", (event) => {
      if (!(event instanceof MouseEvent) || event.button !== 0) return;
      pinnedDragTarget = root;
      pinnedDragStart = {
        x: event.clientX - root.offsetLeft,
        y: event.clientY - root.offsetTop,
      };
      root.style.left = `${root.offsetLeft}px`;
      root.style.top = `${root.offsetTop}px`;
      root.style.right = "auto";
      event.preventDefault();
    });
    closeEl?.addEventListener("click", () => closePinnedPanel(root));
    options.pinnedHost.appendChild(root);
    return root;
  };

  const toggleWatch = (watchId: number | string | null) => {
    if (watchId == null) return openWatch(null);
    const existing = getPinnedPanelById(watchId);
    if (existing) {
      closePinnedPanel(existing);
      return null;
    }
    return openWatch(watchId);
  };

  const findTemporallyClosestWatch = (targetMs: number | null | undefined) => {
    if (targetMs == null) return null;
    let closest: WatchEntry | null = null;
    let minDiff = Infinity;
    for (const watch of options.getWatches()) {
      const diff = Math.abs(watch.t - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = watch;
      }
    }
    return closest ? { watch: closest, diffMs: minDiff } : null;
  };

  const setText = (id: string, value: string) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  const updateInfo = (pose: Pose | null, index: number) => {
    if (!options.floatWindow || options.floatWindow.hidden || !pose) {
      setText("fx", "—");
      setText("fy", "—");
      setText("ft", "—");
      setText("ftime", "—");
      setText("favg", "—");
      setText("flv", "—");
      setText("frv", "—");
      setText("fdeltat", "—");
      setText("fcount", "Point: —/—");
      return;
    }

    setText("fx", options.formatNumber(pose.x, 2));
    setText("fy", options.formatNumber(pose.y, 2));
    setText("ft", `${options.formatNumber(pose.theta, 2)}°`);
    setText("ftime", `${options.formatNumber((pose.t ?? 0) / 1000, 2)}s`);

    const left = pose.l_vel || 0;
    const right = pose.r_vel || 0;
    const speed = options.speedFromNorm(pose.speed_norm ?? 0);
    const leftDisplay = options.speedFromNorm(options.normFromSpeedRaw(left));
    const rightDisplay = options.speedFromNorm(options.normFromSpeedRaw(right));
    setText("favg", speed == null ? "—" : options.formatNumber(speed, 2));
    setText("flv", leftDisplay == null ? "—" : options.formatNumber(leftDisplay, 2));
    setText("frv", rightDisplay == null ? "—" : options.formatNumber(rightDisplay, 2));
    setText("fcount", `Point: ${index + 1}`);

    const result = findTemporallyClosestWatch(pose.t);
    const watchTime = document.getElementById("fwatchtime");
    const watchLabel = document.getElementById("fwatchlabel");
    const watchValue = document.getElementById("fwatchvalue");
    const clickable = document.getElementById("fwatchclickable");
    const deltaTime = document.getElementById("fdeltat");

    if (result) {
      const { watch, diffMs } = result;
      const direction = (watch.t > (pose.t ?? 0)) ? "ahead" : "ago";
      const seconds = options.formatNumber(diffMs / 1000, 1, "0");
      if (watchLabel) watchLabel.textContent = ` ${watch.label}`;
      if (watchValue) watchValue.textContent = ` ${watch.value}`;
      if (watchTime) watchTime.textContent = ` ${seconds}s ${direction}`;
      if (clickable instanceof HTMLElement) {
        clickable.style.cursor = "pointer";
        clickable.onclick = () => {
          options.pausePlayback();
          options.setPlayTimeMs(watch.t);
          options.setSelectedIndex(options.findFloorIndexByTime(watch.t));
          options.updatePoseReadout();
          options.requestDrawAll();
        };
      }
      const lockedTime = options.getLockedTimeMs() ?? 0;
      const hoveredTime = options.getHoverTimeMs() ?? lockedTime;
      const delta = Math.abs(hoveredTime - lockedTime) / 1000;
      if (deltaTime) deltaTime.textContent = `${options.formatNumber(delta, 2, "0")}s`;
    } else {
      if (watchLabel) watchLabel.textContent = " —";
      if (watchValue) watchValue.textContent = " —";
      if (watchTime) watchTime.textContent = " —";
      if (deltaTime) deltaTime.textContent = "—";
      if (clickable instanceof HTMLElement) {
        clickable.style.cursor = "default";
        clickable.onclick = null;
      }
    }
  };

  options.toggleButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    controller.toggleInfo();
  });
  options.closeButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    options.floatWindow?.classList.add("hidden");
    options.toggleButton?.classList.remove("isOn");
    options.floatWindow?.classList.remove("isOn");
  });
  options.header?.addEventListener("mousedown", (event) => {
    if (!(event instanceof MouseEvent) || !options.floatWindow) return;
    isDragging = true;
    dragStart = {
      x: event.clientX - options.floatWindow.offsetLeft,
      y: event.clientY - options.floatWindow.offsetTop,
    };
  });
  options.resizer?.addEventListener("mousedown", (event) => {
    isResizing = true;
    event.preventDefault();
  });

  const controller: FloatingInfoController = {
    toggleInfo() {
      if (!options.floatWindow || !options.toggleButton) return;
      options.floatWindow.classList.toggle("hidden");
      const enabled = !options.floatWindow.classList.contains("hidden");
      options.toggleButton.classList.toggle("isOn", enabled);
      options.floatWindow.classList.toggle("isOn", enabled);
      options.onToggle(enabled);
    },
    updateInfo,
    refreshPinnedPanels,
    toggleWatch,
    openWatch,
    handleWindowMouseMove(event) {
      if (isDragging && options.floatWindow) {
        options.floatWindow.style.left = `${event.clientX - dragStart.x}px`;
        options.floatWindow.style.top = `${event.clientY - dragStart.y}px`;
      }
      if (pinnedDragTarget) {
        const nextLeft = event.clientX - pinnedDragStart.x;
        const nextTop = event.clientY - pinnedDragStart.y;
        const rect = pinnedDragTarget.getBoundingClientRect();
        const clampedLeft = Math.max(0, Math.min(nextLeft, Math.max(0, window.innerWidth - rect.width)));
        const clampedTop = Math.max(0, Math.min(nextTop, Math.max(0, window.innerHeight - rect.height)));
        pinnedDragTarget.style.left = `${clampedLeft}px`;
        pinnedDragTarget.style.top = `${clampedTop}px`;
        pinnedDragTarget.style.right = "auto";
      }
      if (isResizing && options.floatWindow) {
        let newWidth = event.clientX - options.floatWindow.offsetLeft;
        let newHeight = event.clientY - options.floatWindow.offsetTop;
        newWidth = Math.max(options.bounds.minWidth, Math.min(newWidth, options.bounds.maxWidth));
        newHeight = Math.max(options.bounds.minHeight, Math.min(newHeight, options.bounds.maxHeight));
        options.floatWindow.style.width = `${newWidth}px`;
        options.floatWindow.style.height = `${newHeight}px`;
      }
    },
    handleWindowMouseUp() {
      isDragging = false;
      isResizing = false;
      pinnedDragTarget = null;
    },
  };

  return controller;
}
