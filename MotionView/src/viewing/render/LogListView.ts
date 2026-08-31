import { setStatus } from "../../app/status";
import type { LogEntry } from "../../state/models";
import type { ViewingListsDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import { createVirtualList, type VirtualList } from "./virtualList";
import { escapeHtml, formatNumber, levelSortRank, levelStyle } from "../viewingPresentation";

export class LogListView {
  readonly #list: VirtualList<Readonly<LogEntry>>;
  readonly #keys = new WeakMap<object, string>();
  #nextKey = 1;
  #indexByEntry = new Map<Readonly<LogEntry>, number>();
  #searchTerm = "";
  #itemCount = 0;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingListsDom,
  ) {
    const list = createVirtualList<Readonly<LogEntry>>(dom.logList, {
      estimateRowHeight: 70,
      overscanPx: 320,
      getKey: (entry) => this.keyFor(entry),
      renderItem: (entry) => this.createItem(entry),
    });
    if (!list) throw new Error("MotionView could not initialize the log virtual list.");
    this.#list = list;
  }

  bind(): void {
    this.dom.logSort.addEventListener("change", () => this.render());
  }

  get itemCount(): number { return this.#itemCount; }

  setSearch(value: string): void {
    this.#searchTerm = value.trim().toLocaleLowerCase();
  }

  render(): void {
    const items = Array.from(this.viewing.data.logs).filter((entry) => this.searchMatches(entry));
    const mode = this.dom.logSort.value;
    items.sort((left, right) => {
      if (mode === "level") return levelSortRank(right.level) - levelSortRank(left.level) || right.t - left.t;
      return mode === "time" ? left.t - right.t : right.t - left.t;
    });
    this.#itemCount = items.length;
    this.#indexByEntry = new Map(items.map((entry, index) => [entry, index]));
    this.#list.setItems(items);
  }

  private searchMatches(entry: Readonly<LogEntry>): boolean {
    if (!this.#searchTerm) return true;
    return `${entry.label ?? ""} ${entry.message ?? entry.value ?? ""}`.toLocaleLowerCase().includes(this.#searchTerm);
  }

  highlight(scroll = false): void {
    const selected = this.viewing.navigation.selectedLog;
    if (scroll && selected) {
      const index = this.#indexByEntry.get(selected);
      if (index != null) this.#list.scrollToIndex(index, 12);
    }
    this.#list.refresh();
  }

  private createItem(entry: Readonly<LogEntry>): HTMLElement {
    const style = levelStyle(entry.level);
    const element = document.createElement("div");
    element.className = "watchItem logItem";
    if (entry === this.viewing.navigation.selectedLog) element.classList.add("selected");
    element.dataset.t = String(entry.t);
    element.innerHTML = `<div class="watchItemContent logItemContent"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="pill level" style="background:${style.fill};color:${style.text}">${style.name}</span>
        ${entry.isSystem ? '<span class="pill logSystemPill">SYSTEM</span>' : ""}
      </div><div class="muted"><span class="eventSelectableText">${formatNumber(entry.t / 1000, 2)}s</span></div>
    </div><div class="bigValue selectableText"><span class="eventSelectableText">${escapeHtml(entry.message ?? entry.value ?? "")}</span></div></div>`;
    this.constrainTextSelection(element);
    element.addEventListener("pointerenter", () => {
      if (!this.viewing.playback.isPlaying) this.viewing.navigation.setTimelineHover(entry.t);
    });
    element.addEventListener("pointerleave", () => {
      if (this.viewing.navigation.hoverTimelineTime === entry.t) this.viewing.navigation.setTimelineHover(null);
    });
    const selectLog = () => {
      if (this.viewing.navigation.selectedLog === entry) {
        this.viewing.navigation.clearDetails();
        return;
      }
      this.viewing.playback.pause();
      this.viewing.navigation.setTimelineHover(null);
      const nearest = this.viewing.projection.nearestIndex(entry.t, Number.POSITIVE_INFINITY);
      const index = nearest?.index ?? -1;
      const pose = this.viewing.projection.interpolatePose(entry.t) ?? this.viewing.projection.poseAt(index);
      if (index >= 0 && pose) this.viewing.navigation.lockTrack(pose, index);
      this.viewing.navigation.selectLog(entry);
      if (nearest) setStatus(`Log @${entry.t}ms mapped to closest pose @${this.viewing.data.poses[index]?.t}ms (Δ=${nearest.deltaMs}ms).`);
      else setStatus(`Log @${entry.t}ms selected (no poses loaded).`);
      this.highlight(true);
    };
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".eventSelectableText"))) return;
      event.preventDefault();
      selectLog();
    }, { passive: false });
    element.addEventListener("click", (event) => {
      const text = event.target instanceof Element ? event.target.closest<HTMLElement>(".eventSelectableText") : null;
      if (!text || text.dataset.selectionCancelled === "true" || window.getSelection()?.toString()) return;
      selectLog();
    });
    return element;
  }

  private keyFor(entry: Readonly<LogEntry>): string {
    const object = entry as object;
    let key = this.#keys.get(object);
    if (!key) {
      key = `log:${this.#nextKey}`;
      this.#nextKey += 1;
      this.#keys.set(object, key);
    }
    return key;
  }

  private constrainTextSelection(item: HTMLElement): void {
    for (const text of item.querySelectorAll<HTMLElement>(".eventSelectableText")) {
      text.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        text.dataset.selectionCancelled = "";
        const constrain = (move: PointerEvent) => {
          const target = document.elementFromPoint(move.clientX, move.clientY);
          if (target && text.contains(target)) return;
          text.dataset.selectionCancelled = "true";
          window.getSelection()?.removeAllRanges();
        };
        const release = () => {
          window.removeEventListener("pointermove", constrain);
          window.setTimeout(() => delete text.dataset.selectionCancelled, 0);
        };
        window.addEventListener("pointermove", constrain, { passive: true });
        window.addEventListener("pointerup", release, { once: true });
      }, { passive: true });
    }
  }
}
