import invisibleWatchIconUrl from "../../assets/svg/viewing/invisibleWatch.svg?url";
import pinWatchIconUrl from "../../assets/svg/viewing/pinWatch.svg?url";
import visibleWatchIconUrl from "../../assets/svg/viewing/visibleWatch.svg?url";
import watchGraphIconUrl from "../../assets/svg/viewing/watchGraph.svg?url";
import { setStatus } from "../../app/status";
import type { WatchEntry } from "../../state/models";
import type { ViewingDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import type { WatchMarker } from "../viewingTypes";
import { createVirtualList, type VirtualList } from "../virtualList";
import { escapeHtml, formatNumber, isGraphableWatchValue, levelSortRank, levelStyle, watchGraphKey, watchKey } from "../viewingPresentation";

export class WatchListView {
  readonly #list: VirtualList<Readonly<WatchMarker>>;
  #openActionsMenu: Readonly<{ button: HTMLButtonElement; menu: HTMLElement }> | null = null;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingDom,
  ) {
    const list = createVirtualList<Readonly<WatchMarker>>(dom.watchList, {
      estimateRowHeight: 62,
      overscanPx: 320,
      getKey: (marker, index) => `${marker.t}:${watchKey(marker.watch)}:${index}`,
      renderItem: (marker) => this.createItem(marker),
      syncRowLayout: (row) => this.syncActionLayout(row),
    });
    if (!list) throw new Error("MotionView could not initialize the watch virtual list.");
    this.#list = list;
  }

  bind(): void {
    this.dom.watchSort.addEventListener("change", () => this.render());
    this.dom.watchFilter.addEventListener("change", () => this.render());
    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !this.isOpenMenuTarget(target)) this.closeActionsMenu();
    });
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
    all.textContent = "All";
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
    this.closeActionsMenu();
    const items = this.viewing.projection.watchMarkers.filter((marker) => this.filterMatches(marker.watch));
    const mode = this.dom.watchSort.value;
    items.sort((left, right) => {
      if (mode === "level") return levelSortRank(right.watch.level) - levelSortRank(left.watch.level) || right.t - left.t;
      if (mode === "time") return left.t - right.t;
      if (mode === "-time") return right.t - left.t;
      if (mode === "value") return String(left.watch.value ?? "").localeCompare(String(right.watch.value ?? ""), undefined, { numeric: true });
      return 0;
    });
    this.dom.watchCount.textContent = String(items.length);
    this.#list.setItems(items);
  }

  highlight(scroll = false): void {
    const time = this.viewing.navigation.selectedWatch?.t;
    if (scroll && time != null) {
      const items = this.#list.getItems();
      for (let index = 0; index < items.length; index += 1) {
        if (items[index]?.t === time) {
          this.#list.scrollToIndex(index, 12);
          break;
        }
      }
    }
    for (const row of this.dom.watchList.querySelectorAll<HTMLElement>(".watchItem")) {
      row.classList.toggle("selected", time != null && Number(row.dataset.t) === time);
    }
  }

  private createItem(marker: Readonly<WatchMarker>): HTMLElement {
    const watch = marker.watch;
    const style = levelStyle(watch.level);
    const visible = watch.visible !== false;
    const booleanValue = String(watch.value ?? "").trim().toLowerCase();
    const booleanClass = booleanValue === "true"
      ? " isBooleanTrue"
      : booleanValue === "false" ? " isBooleanFalse" : "";
    const element = document.createElement("div");
    element.className = "watchItem";
    if (this.viewing.navigation.selectedWatch?.t === marker.t) element.classList.add("selected");
    element.dataset.t = String(marker.t);
    const icon = (url: string, id: string) => `${url}#icon-${id}`;
    const graphButton = isGraphableWatchValue(watch.value)
      ? `<button class="iconBtn watchGraphBtn" type="button" title="Open watch graph"><svg width="20" height="20"><use href="${icon(watchGraphIconUrl, "watchGraph")}"></use></svg></button>` : "";
    const pinButton = `<button class="iconBtn watchPinBtn" type="button" title="Pin watch" aria-label="Pin watch"><svg width="20" height="20"><use href="${icon(pinWatchIconUrl, "pinWatch")}"></use></svg></button>`;
    const visibilityButton = `<button class="iconBtn watchVisibilityBtn" type="button" title="${visible ? "Hide" : "Show"} watch" aria-label="${visible ? "Hide" : "Show"} watch"><svg width="20" height="20"><use href="${icon(visible ? visibleWatchIconUrl : invisibleWatchIconUrl, visible ? "visibleWatch" : "invisibleWatch")}"></use></svg></button>`;
    element.innerHTML = `<div class="watchItemContent"><div class="watchItemHeader">
      <div class="watchTitleGroup"><span class="pill level watchLevelPill" style="background:${style.fill};color:${style.text}">${style.name}</span><span class="watchLabel">${escapeHtml(watch.label)}</span></div>
      <div class="watchMeta"><div class="watchTimestamp muted">${formatNumber(marker.t / 1000, 2)}s</div><div class="watchActions watchActionsPill watchActionsFull pill">
        ${pinButton}${visibilityButton}${graphButton}</div>
        <div class="watchActionsCompact">
          <button class="iconBtn watchActionsMoreBtn" type="button" title="More watch actions" aria-label="More watch actions" aria-expanded="false">⋮</button>
          <div class="watchActionsCompactMenu" hidden>${pinButton}${visibilityButton}${graphButton}</div>
        </div></div></div><div class="bigValue${booleanClass}">${escapeHtml(watch.value ?? "")}</div></div>`;
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
      event.preventDefault();
      this.viewing.playback.pause();
      const index = marker.idx ?? this.viewing.projection.findFloorIndex(marker.t);
      const pose = this.viewing.projection.interpolatePose(marker.t) ?? marker.pose;
      if (index >= 0 && pose) this.viewing.navigation.lockTrack(pose, index);
      this.viewing.navigation.selectWatch(marker);
      setStatus(`Watch @${formatNumber(marker.t / 1000, 2)}s selected.`);
    }, { passive: false });
    const moreButton = element.querySelector<HTMLButtonElement>(".watchActionsMoreBtn");
    const compactMenu = element.querySelector<HTMLElement>(".watchActionsCompactMenu");
    moreButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (compactMenu) this.toggleActionsMenu(moreButton, compactMenu);
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
        this.dom.watchList.dispatchEvent(new CustomEvent("viewing-pin-watch", { bubbles: true, detail: { watch } }));
        this.closeActionsMenu();
      });
    }
    for (const button of element.querySelectorAll<HTMLButtonElement>(".watchGraphBtn")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.dom.watchList.dispatchEvent(new CustomEvent("viewing-open-watch-graph", { bubbles: true, detail: { marker } }));
        this.closeActionsMenu();
      });
    }
    return element;
  }

  private toggleActionsMenu(button: HTMLButtonElement, menu: HTMLElement): void {
    const wasOpen = this.#openActionsMenu?.menu === menu && !menu.hidden;
    this.closeActionsMenu();
    if (wasOpen) return;
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    this.#openActionsMenu = { button, menu };
  }

  private closeActionsMenu(restoreFocus = false): void {
    if (!this.#openActionsMenu) return;
    const { button, menu } = this.#openActionsMenu;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    this.#openActionsMenu = null;
    if (restoreFocus) button.focus();
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
}
