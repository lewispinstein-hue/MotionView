import { setStatus } from "../../app/status";
import type { LogEntry } from "../../state/models";
import type { ViewingDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import { createVirtualList, type VirtualList } from "../virtualList";
import { escapeHtml, formatNumber, levelSortRank, levelStyle } from "../viewingPresentation";

export class LogListView {
  readonly #list: VirtualList<Readonly<LogEntry>>;
  #indexByTime = new Map<number, number>();

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingDom,
  ) {
    const list = createVirtualList<Readonly<LogEntry>>(dom.logList, {
      estimateRowHeight: 70,
      overscanPx: 320,
      getKey: (entry, index) => `${entry.t}:${index}`,
      renderItem: (entry) => this.createItem(entry),
    });
    if (!list) throw new Error("MotionView could not initialize the log virtual list.");
    this.#list = list;
  }

  bind(): void {
    this.dom.logSort.addEventListener("change", () => this.render());
  }

  render(): void {
    const items = Array.from(this.viewing.data.logs);
    const mode = this.dom.logSort.value;
    items.sort((left, right) => {
      if (mode === "level") return levelSortRank(right.level) - levelSortRank(left.level) || right.t - left.t;
      return mode === "time" ? left.t - right.t : right.t - left.t;
    });
    this.dom.logCount.textContent = String(items.length);
    this.#indexByTime = new Map(items.map((entry, index) => [entry.t, index]));
    this.#list.setItems(items);
  }

  highlight(scroll = false): void {
    const selectedTime = this.viewing.navigation.selectedLogTime;
    if (scroll && selectedTime != null) {
      const index = this.#indexByTime.get(selectedTime);
      if (index != null) this.#list.scrollToIndex(index, 12);
    }
    this.#list.refresh();
  }

  private createItem(entry: Readonly<LogEntry>): HTMLElement {
    const style = levelStyle(entry.level);
    const element = document.createElement("div");
    element.className = "watchItem";
    if (entry.t === this.viewing.navigation.selectedLogTime) element.classList.add("selected");
    element.dataset.t = String(entry.t);
    element.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="pill level" style="background:${style.fill};color:${style.text}">${style.name}</span>
        ${entry.isSystem ? '<span class="pill logSystemPill">SYSTEM</span>' : ""}
      </div><div class="muted">${formatNumber(entry.t / 1000, 2)}s</div>
    </div><div class="bigValue selectableText">${escapeHtml(entry.message ?? entry.value ?? "")}</div>`;
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".selectableText"))) return;
      event.preventDefault();
      this.viewing.playback.pause();
      this.viewing.navigation.selectLog(entry.t);
      const near = this.viewing.projection.nearestIndex(entry.t, 60);
      if (near) {
        this.viewing.navigation.selectPose(near.index, { preserveDetails: true });
        setStatus(`Log @${entry.t}ms mapped to pose @${this.viewing.data.poses[near.index]?.t}ms (Δ=${near.deltaMs}ms).`);
      } else if (this.viewing.data.poses.length) {
        this.viewing.navigation.selectPose(this.viewing.projection.findFloorIndex(entry.t), { preserveDetails: true });
        setStatus(`Log @${entry.t}ms shown via interpolation (no pose within ±60ms).`);
      } else setStatus(`Log @${entry.t}ms selected (no poses loaded).`);
      this.highlight(true);
    }, { passive: false });
    return element;
  }
}
