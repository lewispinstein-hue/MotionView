import invisibleWatchIconSvg from "../../assets/svg/viewing/invisibleWatch.svg?raw";
import pinWatchIconSvg from "../../assets/svg/viewing/pinWatch.svg?raw";
import visibleWatchIconSvg from "../../assets/svg/viewing/visibleWatch.svg?raw";
import watchGraphIconSvg from "../../assets/svg/viewing/watchGraph.svg?raw";
import { setStatus } from "../../app/status";
import type { WatchEntry } from "../../state/models";
import type { ViewingListsDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import type { WatchMarker } from "../viewingTypes";
import { createVirtualList, type VirtualList } from "./virtualList";
import { escapeHtml, formatNumber, isGraphableWatchValue, levelSortRank, levelStyle, normalizeLogLevel } from "../viewingPresentation";
import type { FloatingInfoView } from "./FloatingInfoView";
import type { WatchGraphView } from "./WatchGraphView";

export class WatchListView {
  readonly #list: VirtualList<Readonly<WatchMarker>>;
  readonly #keys = new WeakMap<object, string>();
  #nextKey = 1;
  #searchTerm = "";
  #itemCount = 0;
  #previewKey: string | null = null;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingListsDom,
    private readonly floatingInfo: FloatingInfoView,
    private readonly watchGraph: WatchGraphView,
  ) {
    const list = createVirtualList<Readonly<WatchMarker>>(dom.watchList, {
      estimateRowHeight: 76,
      overscanPx: 320,
      scrollContainer: dom.scrollContainer,
      getKey: (marker) => this.keyFor(marker),
      renderItem: (marker) => this.createItem(marker),
    });
    if (!list) throw new Error("MotionView could not initialize the watch virtual list.");
    this.#list = list;
  }

  bind(): void {
    this.dom.watchSort.addEventListener("change", () => {
      this.render();
    });
  }

  get itemCount(): number { return this.#itemCount; }

  setSearch(value: string): void {
    this.#searchTerm = value.trim().toLocaleLowerCase();
  }

  filterMatches(watch: Readonly<WatchEntry>): boolean {
    const filter = this.dom.levelFilter.value || "all";
    return filter === "all" || normalizeLogLevel(watch.level) === filter;
  }

  isVisible(marker: Readonly<WatchMarker>): boolean {
    return marker.watch.visible !== false && this.filterMatches(marker.watch);
  }

  render(): void {
    const items = this.viewing.projection.watchMarkers.filter((marker) => this.filterMatches(marker.watch) && this.searchMatches(marker.watch));
    const mode = this.dom.watchSort.value;
    items.sort((left, right) => {
      if (mode === "level") return levelSortRank(right.watch.level) - levelSortRank(left.watch.level) || right.t - left.t;
      if (mode === "time") return left.t - right.t;
      if (mode === "-time") return right.t - left.t;
      if (mode === "value") return String(left.watch.value ?? "").localeCompare(String(right.watch.value ?? ""), undefined, { numeric: true });
      return 0;
    });
    this.#itemCount = items.length;
    this.#list.setItems(items);
  }

  private searchMatches(watch: Readonly<WatchEntry>): boolean {
    if (!this.#searchTerm) return true;
    return `${watch.label ?? ""} ${watch.value ?? ""}`.toLocaleLowerCase().includes(this.#searchTerm);
  }

  highlight(scroll = false): void {
    const selected = this.viewing.navigation.selectedWatch;
    if (scroll && selected) {
      const items = this.#list.getItems();
      for (let index = 0; index < items.length; index += 1) {
        if (items[index] === selected) {
          this.#list.scrollToIndex(index, 12);
          break;
        }
      }
    }
    const selectedKey = selected ? this.keyFor(selected) : null;
    for (const row of this.dom.watchList.querySelectorAll<HTMLElement>(".watchItem")) {
      row.classList.toggle("selected", row.dataset.watchKey === selectedKey);
    }
  }

  setPreviewTime(time: number): void {
    const items = this.#list.getItems();
    let nearestIndex = -1;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (let index = 0; index < items.length; index += 1) {
      const marker = items[index];
      if (!marker) continue;
      const delta = Math.abs(marker.t - time);
      if (delta < nearestDelta) {
        nearestIndex = index;
        nearestDelta = delta;
      }
    }
    this.#previewKey = nearestIndex >= 0 ? this.keyFor(items[nearestIndex]!) : null;
    if (nearestIndex >= 0) this.#list.scrollToIndex(nearestIndex, 12, "center");
    this.#list.refresh();
  }

  clearPreview(): void {
    if (!this.#previewKey) return;
    this.#previewKey = null;
    this.#list.refresh();
  }

  private createItem(marker: Readonly<WatchMarker>): HTMLElement {
    const itemKey = this.keyFor(marker);
    const watch = marker.watch;
    const style = levelStyle(watch.level);
    const visible = watch.visible !== false;
    const booleanValue = String(watch.value ?? "").trim().toLowerCase();
    const booleanClass = booleanValue === "true"
      ? " isBooleanTrue"
      : booleanValue === "false" ? " isBooleanFalse" : "";
    const element = document.createElement("div");
    element.className = "watchItem";
    if (this.viewing.navigation.selectedWatch === marker) element.classList.add("selected");
    if (this.#previewKey === itemKey) element.classList.add("previewSelected");
    element.dataset.t = String(marker.t);
    element.dataset.watchKey = itemKey;
    const icon = (svg: string) => `<span class="watchActionIcon">${svg}</span>`;
    const graphButton = isGraphableWatchValue(watch.value)
      ? `<button class="iconBtn watchGraphBtn${this.watchGraph.isOpenFor(marker) ? " isOn" : ""}" type="button">${icon(watchGraphIconSvg)}</button>` : "";
    const pinButton = `<button class="iconBtn watchPinBtn${this.floatingInfo.isWatchPinned(watch.id ?? null) ? " isOn" : ""}" type="button">${icon(pinWatchIconSvg)}</button>`;
    const visibilityButton = `<button class="iconBtn watchVisibilityBtn${visible ? "" : " isOff"}" type="button" title="${visible ? "Hide" : "Show"} watch" aria-label="${visible ? "Hide" : "Show"} watch">${icon(visible ? visibleWatchIconSvg : invisibleWatchIconSvg)}</button>`;
    element.innerHTML = `<div class="watchItemContent"><div class="watchItemHeader">
      <div class="watchTitleGroup"><span class="pill level watchLevelPill" style="background:${style.fill};color:${style.text}">${style.name}</span><span class="watchLabel eventSelectableText">${escapeHtml(watch.label)}</span></div>
      <div class="watchMeta"><div class="watchTimestamp muted"><span class="eventSelectableText">${formatNumber(marker.t / 1000, 2)}s</span></div><div class="watchActions watchActionsPill watchActionsFull pill">
        ${pinButton}${visibilityButton}${graphButton}</div></div></div><div class="bigValue${booleanClass}"><span class="eventSelectableText">${escapeHtml(watch.value ?? "")}</span></div></div>`;
    this.constrainTextSelection(element);
    element.addEventListener("pointerenter", () => {
      if (!this.viewing.playback.isPlaying) this.viewing.navigation.setTimelineHover(marker.t);
    });
    element.addEventListener("pointerleave", () => {
      if (this.viewing.navigation.hoverTimelineTime === marker.t) this.viewing.navigation.setTimelineHover(null);
    });
    const selectWatch = () => {
      if (this.viewing.navigation.selectedWatch === marker) {
        this.viewing.navigation.clearDetails();
        return;
      }
      this.viewing.playback.pause();
      this.viewing.navigation.setTimelineHover(null);
      const closest = this.viewing.projection.nearestIndex(marker.t, Number.POSITIVE_INFINITY);
      const index = marker.idx ?? closest?.index ?? -1;
      const pose = this.viewing.projection.interpolatePose(marker.t) ?? marker.pose ?? this.viewing.projection.poseAt(index);
      if (index >= 0 && pose) this.viewing.navigation.lockTrack(pose, index);
      this.viewing.navigation.selectWatch(marker);
      setStatus(`Watch @${formatNumber(marker.t / 1000, 2)}s selected.`);
    };
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button, .eventSelectableText"))) return;
      event.preventDefault();
      selectWatch();
    }, { passive: false });
    element.addEventListener("click", (event) => {
      const text = event.target instanceof Element ? event.target.closest<HTMLElement>(".eventSelectableText") : null;
      if (!text || text.dataset.selectionCancelled === "true" || window.getSelection()?.toString()) return;
      selectWatch();
    });
    for (const button of element.querySelectorAll<HTMLButtonElement>(".watchVisibilityBtn")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.viewing.setWatchVisibility(watch, !visible);
      });
    }
    for (const button of element.querySelectorAll<HTMLButtonElement>(".watchPinBtn")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.floatingInfo.toggleWatch(watch.id ?? null);
        this.render();
      });
    }
    for (const button of element.querySelectorAll<HTMLButtonElement>(".watchGraphBtn")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.watchGraph.open(marker);
        this.render();
      });
    }
    return element;
  }

  private keyFor(marker: Readonly<WatchMarker>): string {
    const watch = marker.watch as object;
    let key = this.#keys.get(watch);
    if (!key) {
      key = `watch:${this.#nextKey}`;
      this.#nextKey += 1;
      this.#keys.set(watch, key);
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
