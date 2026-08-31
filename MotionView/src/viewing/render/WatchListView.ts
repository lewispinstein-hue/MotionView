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
import { escapeHtml, formatNumber, isGraphableWatchValue, levelSortRank, levelStyle, watchGraphKey } from "../viewingPresentation";
import type { FloatingInfoView } from "./FloatingInfoView";
import type { WatchGraphView } from "./WatchGraphView";

export class WatchListView {
  readonly #list: VirtualList<Readonly<WatchMarker>>;
  readonly #keys = new WeakMap<object, string>();
  #nextKey = 1;
  #searchTerm = "";
  #itemCount = 0;
  #openActionsMenu: Readonly<{ button: HTMLButtonElement; menu: HTMLElement }> | null = null;
  #openActionsKey: string | null = null;

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
      syncRowLayout: (row) => this.syncActionLayout(row),
    });
    if (!list) throw new Error("MotionView could not initialize the watch virtual list.");
    this.#list = list;
  }

  bind(): void {
    this.dom.watchSort.addEventListener("change", () => {
      this.closeActionsMenu();
      this.render();
    });
    this.dom.watchFilter.addEventListener("change", () => {
      this.closeActionsMenu();
      this.render();
    });
    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !this.isOpenMenuTarget(target)) this.closeActionsMenu();
    });
  }

  get itemCount(): number { return this.#itemCount; }

  setSearch(value: string): void {
    this.#searchTerm = value.trim().toLocaleLowerCase();
  }

  filterMatches(watch: Readonly<WatchEntry>): boolean {
    const filter = this.dom.watchFilter.value || "all";
    return filter === "all" || watchGraphKey(watch) === filter;
  }

  isVisible(marker: Readonly<WatchMarker>): boolean {
    return marker.watch.visible !== false && this.filterMatches(marker.watch);
  }

  renderFilter(): void {
    const current = this.dom.watchFilter.value || "all";
    this.dom.watchFilter.replaceChildren();
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "Filter by label";
    this.dom.watchFilter.appendChild(all);
    const options = new Map<string, string>();
    for (const watch of this.viewing.data.watches) {
      const key = watchGraphKey(watch);
      const id = Number(watch.id);
      options.set(key, watch.label || (Number.isInteger(id) ? `Watch ${id}` : "Unnamed Watch"));
    }
    for (const [key, label] of [...options].sort((left, right) => left[1].localeCompare(right[1], undefined, { numeric: true }))) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      this.dom.watchFilter.appendChild(option);
    }
    this.dom.watchFilter.value = Array.from(this.dom.watchFilter.options).some((option) => option.value === current) ? current : "all";
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
    if (this.#openActionsKey && !items.some((marker) => this.keyFor(marker) === this.#openActionsKey)) {
      this.closeActionsMenu();
    }
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
        ${pinButton}${visibilityButton}${graphButton}</div>
        <div class="watchActionsCompact">
          <button class="iconBtn watchActionsMoreBtn" type="button" title="More watch actions" aria-label="More watch actions" aria-expanded="false">⋮</button>
          <div class="watchActionsCompactMenu" hidden>${pinButton}${visibilityButton}${graphButton}</div>
        </div></div></div><div class="bigValue${booleanClass}"><span class="eventSelectableText">${escapeHtml(watch.value ?? "")}</span></div></div>`;
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
    const moreButton = element.querySelector<HTMLButtonElement>(".watchActionsMoreBtn");
    const compactMenu = element.querySelector<HTMLElement>(".watchActionsCompactMenu");
    moreButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (compactMenu) this.toggleActionsMenu(itemKey, moreButton, compactMenu);
    });
    compactMenu?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeActionsMenu(true);
      } else if (event.key === "Tab") this.closeActionsMenu();
    });
    for (const button of element.querySelectorAll<HTMLButtonElement>(".watchVisibilityBtn")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.viewing.setWatchVisibility(watch, !visible);
        this.closeActionsMenu();
      });
    }
    for (const button of element.querySelectorAll<HTMLButtonElement>(".watchPinBtn")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.floatingInfo.toggleWatch(watch.id ?? null);
        this.closeActionsMenu();
        this.render();
      });
    }
    for (const button of element.querySelectorAll<HTMLButtonElement>(".watchGraphBtn")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.watchGraph.open(marker);
        this.closeActionsMenu();
        this.render();
      });
    }
    if (this.#openActionsKey === itemKey && moreButton && compactMenu) {
      compactMenu.hidden = false;
      moreButton.setAttribute("aria-expanded", "true");
      this.#openActionsMenu = { button: moreButton, menu: compactMenu };
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

  private toggleActionsMenu(key: string, button: HTMLButtonElement, menu: HTMLElement): void {
    const wasOpen = this.#openActionsKey === key && !menu.hidden;
    this.closeActionsMenu();
    if (wasOpen) return;
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    this.#openActionsKey = key;
    this.#openActionsMenu = { button, menu };
  }

  private closeActionsMenu(restoreFocus = false): void {
    const current = this.#openActionsMenu;
    this.#openActionsKey = null;
    this.#openActionsMenu = null;
    if (!current) return;
    current.menu.hidden = true;
    current.button.setAttribute("aria-expanded", "false");
    if (restoreFocus) current.button.focus();
  }

  private isOpenMenuTarget(target: Element): boolean {
    return !!this.#openActionsMenu
      && (this.#openActionsMenu.button.contains(target) || this.#openActionsMenu.menu.contains(target));
  }

  private syncActionLayout(row: HTMLElement): void {
    const label = row.querySelector<HTMLElement>(".watchLabel");
    const timestamp = row.querySelector<HTMLElement>(".watchTimestamp");
    if (!label || !timestamp) return;
    row.classList.toggle("watchActionsCollapsed", label.getBoundingClientRect().right > timestamp.getBoundingClientRect().left - 4 || label.scrollWidth > label.clientWidth + 1);
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
