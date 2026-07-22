export interface LogListRendererDependencies {
  logList: HTMLElement | null;
  logCount: HTMLElement | null;
  logSort: HTMLSelectElement | null;
  watchToleranceMs: number;
  getLogs(): any[];
  getSelectedLogTime(): number | null;
  setSelectedLogTime(time: number | null): void;
  clearWaypointSelectionState(): void;
  highlightWaypointInList(waypointId: unknown, eventTime: unknown, doScroll: boolean): void;
  jumpToEventTime(time: number, options: Record<string, unknown>): void;
  setStatus(message: string): void;
  getRawPoseTime(index: number): unknown;
  levelStyle(level: unknown): { fill: string; text: string; name: string };
  levelSortRank(level: unknown): number;
  fmtNum(value: unknown, decimals?: number): string;
  escapeHtml(value: unknown): string;
  scrollIntoViewIfNeeded(container: HTMLElement | null, element: Element | null, pad?: number): void;
}

export interface LogListRenderer {
  render(): void;
  highlight(timeMs: number | null, doScroll: boolean): void;
}

export function createLogListRenderer(deps: LogListRendererDependencies): LogListRenderer {
  function highlight(timeMs: number | null, doScroll: boolean) {
    if (!deps.logList) return;
    const items = deps.logList.querySelectorAll(".watchItem");
    items.forEach((element) => element.classList.remove("selected"));
    if (timeMs == null) return;
    const element = deps.logList.querySelector(`.watchItem[data-t="${CSS.escape(String(timeMs))}"]`);
    if (element) {
      element.classList.add("selected");
      if (doScroll) requestAnimationFrame(() => deps.scrollIntoViewIfNeeded(deps.logList, element, 12));
    }
  }

  function render() {
    if (!deps.logList || !deps.logCount) return;

    deps.logList.innerHTML = "";
    const logs = deps.getLogs();
    deps.logCount.textContent = `${logs.length}`;

    const mode = deps.logSort ? deps.logSort.value : "-time";
    const items = logs.slice();
    items.sort((a, b) => {
      if (mode === "level") {
        const rank = deps.levelSortRank(b.level) - deps.levelSortRank(a.level);
        if (rank !== 0) return rank;
        return (b.t ?? 0) - (a.t ?? 0);
      }
      if (mode === "time") return (a.t ?? 0) - (b.t ?? 0);
      return (b.t ?? 0) - (a.t ?? 0);
    });

    for (const entry of items) {
      const style = deps.levelStyle(entry.level);
      const systemPill = entry.isSystem
        ? '<span class="pill logSystemPill">SYSTEM</span>'
        : "";
      const div = document.createElement("div");
      div.className = "watchItem";
      div.dataset.t = String(entry.t);
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="pill level" style="background:${style.fill};color:${style.text}">${deps.escapeHtml(style.name)}</span>
            ${systemPill}
          </div>
          <div class="muted">${entry.t != null ? `${deps.fmtNum(entry.t / 1000, 2)}s` : "—"}</div>
        </div>
        <div class="bigValue selectableText">${deps.escapeHtml(String(entry.message ?? entry.value ?? ""))}</div>
      `;
      div.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        if (ev.target instanceof Element && ev.target.closest(".selectableText")) return;
        ev.preventDefault();
        deps.setSelectedLogTime(entry.t ?? null);
        deps.clearWaypointSelectionState();
        deps.highlightWaypointInList(null, null, false);
        deps.jumpToEventTime(entry.t, {
          exactStatus: (near: any) => deps.setStatus(`Log @${entry.t}ms mapped to pose @${deps.getRawPoseTime(near.idx)}ms (Δ=${near.dt}ms).`),
          interpolatedStatus: () => deps.setStatus(`Log @${entry.t}ms shown via interpolation (no pose within ±${deps.watchToleranceMs}ms).`),
          noPoseStatus: () => deps.setStatus(`Log @${entry.t}ms selected (no poses loaded).`),
          clearWatchSelection: true,
        });
        highlight(entry.t, true);
      }, { passive: false });
      deps.logList.appendChild(div);
    }

    if (deps.getSelectedLogTime() != null) highlight(deps.getSelectedLogTime(), false);
  }

  return {
    render,
    highlight,
  };
}
