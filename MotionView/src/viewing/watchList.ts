import { requestDrawAll } from "../render/renderScheduler";
import type { VirtualList } from "./virtualList";

export interface WatchListRendererDependencies {
  watchList: HTMLElement | null;
  watchFilter: HTMLSelectElement | null;
  watchSort: HTMLSelectElement | null;
  watchCount: HTMLElement | null;
  get watchListVirtual(): VirtualList<any> | null;
  getWatchMarkers(): any[];
  getWatches(): any[];
  getSelectedWatch(): any;
  setRenderedWatchIndexByTime(indexByTime: Map<unknown, number>): void;
  refreshWatchGraphPanelData(): void;
  levelStyle(level: unknown): { fill: string; text: string; name: string };
  levelSortRank(level: unknown): number;
  watchSortValueKey(value: unknown): { t: number; n: number; s: string };
  watchFilterKeyForWatch(watch: any): string;
  watchFilterMatches(watch: any): boolean;
  watchFilterLabelForWatch(watch: any): string;
  watchVisibilityKeyForWatch(watch: any): string;
  watchVisibilityIconId(watch: any): string;
  watchVisibilityTitle(watch: any): string;
  isGraphableWatchValue(value: unknown): boolean;
  svgIconHref(iconId: string): string;
  setSvgUseHref(useElement: SVGUseElement | null, href: string): void;
  escapeHtml(value: unknown): string;
  fmtNum(value: unknown, decimals?: number): string;
  selectWatchMarker(marker: any, fromUserClick: boolean, clickPos: { x: number; y: number } | null): void;
  toggleFloatingWatch(watchId: unknown): void;
  toggleWatchVisibilityForWatch(watch: any): void;
  openOrToggleWatchGraphPanel(marker: any): void;
}

export interface WatchListRenderer {
  createItem(marker: any): HTMLElement | null;
  renderList(): void;
  renderFilter(): void;
  highlight(timeMs: unknown, doScroll: boolean): void;
  closeActionsMenu(options?: { restoreFocus?: boolean }): void;
  isActionsMenuTarget(target: Element | null): boolean;
  syncItemActionLayout(row: HTMLElement): void;
}

export function createWatchListRenderer(deps: WatchListRendererDependencies): WatchListRenderer {
  let openActionsMenu: { button: HTMLElement; menu: HTMLElement } | null = null;

  function closeActionsMenu({ restoreFocus = false } = {}) {
    if (!openActionsMenu) return;
    const { menu, button } = openActionsMenu;
    menu?.setAttribute("hidden", "");
    button?.setAttribute("aria-expanded", "false");
    if (restoreFocus) button?.focus?.();
    openActionsMenu = null;
  }

  function toggleActionsMenu(button: HTMLElement | null, menu: HTMLElement | null) {
    if (!button || !menu) return;
    const wasOpen = openActionsMenu?.menu === menu && !menu.hasAttribute("hidden");
    closeActionsMenu();
    if (wasOpen) return;
    menu.removeAttribute("hidden");
    button.setAttribute("aria-expanded", "true");
    openActionsMenu = { button, menu };
  }

  function isActionsMenuTarget(target: Element | null) {
    if (!target || !openActionsMenu) return false;
    return !!(
      openActionsMenu.menu?.contains(target)
      || openActionsMenu.button?.contains(target)
    );
  }

  function watchBooleanValueClass(value: unknown) {
    const text = String(value ?? "").trim().toLowerCase();
    if (text === "true") return " isBooleanTrue";
    if (text === "false") return " isBooleanFalse";
    return "";
  }

  function syncItemActionLayout(row: HTMLElement) {
    if (!row?.classList?.contains("watchItem")) return;
    const label = row.querySelector<HTMLElement>(".watchLabel");
    const timestamp = row.querySelector<HTMLElement>(".watchTimestamp");
    if (!label || !timestamp) return;

    row.classList.remove("watchActionsCollapsed", "watchLabelTruncated");
    const labelRect = label.getBoundingClientRect();
    const timestampRect = timestamp.getBoundingClientRect();
    const needsCollapse = labelRect.right > timestampRect.left - 4
      || label.scrollWidth > label.clientWidth + 1;
    if (!needsCollapse) return;

    row.classList.add("watchActionsCollapsed");
    const collapsedLabelRect = label.getBoundingClientRect();
    const collapsedTimestampRect = timestamp.getBoundingClientRect();
    if (
      collapsedLabelRect.right > collapsedTimestampRect.left - 4
      || label.scrollWidth > label.clientWidth + 1
    ) {
      row.classList.add("watchLabelTruncated");
    }
  }

  function updateVisibilityButtons(key: string) {
    if (!deps.watchList || !key) return;
    const buttons = deps.watchList.querySelectorAll<HTMLButtonElement>(`.watchVisibilityBtn[data-watch-visibility-key="${key}"]`);
    for (const button of buttons) {
      const useElement = button.querySelector<SVGUseElement>("use");
      const iconId = button.dataset.iconId || "icon-visibleWatch";
      if (useElement) deps.setSvgUseHref(useElement, deps.svgIconHref(iconId));
      button.title = button.dataset.title || "Toggle watch visibility";
      button.setAttribute("aria-label", button.dataset.title || "Toggle watch visibility");
    }
    requestDrawAll();
  }

  function createItem(marker: any) {
    if (!marker) return null;
    const watch = marker.watch;
    const style = deps.levelStyle(watch.level);
    const label = watch.label || "";
    const value = watch.value ?? "";
    const time = marker.t;
    const showGraphButton = deps.isGraphableWatchValue(value);

    const div = document.createElement("div");
    div.className = "watchItem";
    if (deps.getSelectedWatch()?.marker?.t === time) div.classList.add("selected");
    div.dataset.t = String(time);

    div.innerHTML = `
      <div class="watchItemContent">
        <div class="watchItemHeader">
          <div class="watchTitleGroup">
            <span class="pill level watchLevelPill" style="background:${style.fill};color:${style.text}">${deps.escapeHtml(style.name)}</span>
            <span class="watchLabel">${deps.escapeHtml(label)}</span>
          </div>
          <div class="watchMeta">
            <div class="watchTimestamp muted">${time != null ? `${deps.fmtNum(time / 1000, 2)}s` : "—"}</div>
            <div class="watchActions watchActionsPill watchActionsFull pill">
              <button class="iconBtn watchPinBtn" type="button" title="Open watch graph">
                  <svg width="20" height="20">
                    <use href="${deps.svgIconHref("icon-pinWatch")}" xlink:href="${deps.svgIconHref("icon-pinWatch")}"></use>
                  </svg>
              </button>
              <button class="iconBtn watchVisibilityBtn" type="button" title="Toggle watch visibility">
                <svg width="20" height="20">
                  <use href="${deps.svgIconHref(deps.watchVisibilityIconId(watch))}" xlink:href="${deps.svgIconHref(deps.watchVisibilityIconId(watch))}"></use>
                </svg>
              </button>
              ${showGraphButton ? `
              <button class="iconBtn watchGraphBtn" type="button" title="Open watch graph">
                <svg width="20" height="20">
                  <use href="${deps.svgIconHref("icon-watchGraph")}" xlink:href="${deps.svgIconHref("icon-watchGraph")}"></use>
                </svg>
              </button>
              ` : ""}
            </div>
            <div class="watchActionsCompact">
              <button class="iconBtn watchActionsMoreBtn" type="button" title="More watch actions" aria-label="More watch actions" aria-expanded="false">
                ⋮
              </button>
              <div class="watchActionsCompactMenu" hidden>
                <button class="iconBtn watchPinBtn" type="button" title="Pin watch">
                  <svg width="20" height="20">
                    <use href="${deps.svgIconHref("icon-pinWatch")}" xlink:href="${deps.svgIconHref("icon-pinWatch")}"></use>
                  </svg>
                </button>
                <button class="iconBtn watchVisibilityBtn" type="button" title="Toggle watch visibility">
                  <svg width="20" height="20">
                    <use href="${deps.svgIconHref(deps.watchVisibilityIconId(watch))}" xlink:href="${deps.svgIconHref(deps.watchVisibilityIconId(watch))}"></use>
                  </svg>
                </button>
                ${showGraphButton ? `
                <button class="iconBtn watchGraphBtn" type="button" title="Open watch graph">
                  <svg width="20" height="20">
                    <use href="${deps.svgIconHref("icon-watchGraph")}" xlink:href="${deps.svgIconHref("icon-watchGraph")}"></use>
                  </svg>
                </button>
                ` : ""}
              </div>
            </div>
          </div>
        </div>
        <div class="bigValue${watchBooleanValueClass(value)}">${deps.escapeHtml(String(value))}</div>
      </div>
    `;

    div.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      deps.selectWatchMarker(marker, true, { x: ev.clientX, y: ev.clientY });
    }, { passive: false });

    const moreButton = div.querySelector<HTMLElement>(".watchActionsMoreBtn");
    const compactMenu = div.querySelector<HTMLElement>(".watchActionsCompactMenu");
    if (moreButton && compactMenu) {
      moreButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleActionsMenu(moreButton, compactMenu);
      });
      moreButton.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
      }, { passive: true });
      compactMenu.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
      }, { passive: true });
      compactMenu.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          closeActionsMenu({ restoreFocus: true });
        } else if (ev.key === "Tab") {
          closeActionsMenu();
        }
      });
    }

    const pinButtons = div.querySelectorAll<HTMLButtonElement>(".watchPinBtn");
    for (const pinButton of pinButtons) {
      pinButton.title = "Pin watch";
      pinButton.setAttribute("aria-label", "Pin watch");
      pinButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        deps.toggleFloatingWatch(watch.id ?? watch.watchId ?? null);
        closeActionsMenu();
      });
      pinButton.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
      }, { passive: true });
    }

    const visibilityButtons = div.querySelectorAll<HTMLButtonElement>(".watchVisibilityBtn");
    for (const visibilityButton of visibilityButtons) {
      const visibilityKey = deps.watchVisibilityKeyForWatch(watch);
      const visibilityTitle = deps.watchVisibilityTitle(watch);
      visibilityButton.dataset.watchVisibilityKey = visibilityKey;
      visibilityButton.dataset.iconId = deps.watchVisibilityIconId(watch);
      visibilityButton.dataset.title = visibilityTitle;
      visibilityButton.title = visibilityTitle;
      visibilityButton.setAttribute("aria-label", visibilityTitle);
      visibilityButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        deps.toggleWatchVisibilityForWatch(watch);
        updateVisibilityButtons(visibilityKey);
        closeActionsMenu();
      });
      visibilityButton.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
      }, { passive: true });
    }

    const graphButtons = div.querySelectorAll<HTMLButtonElement>(".watchGraphBtn");
    for (const graphButton of graphButtons) {
      graphButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        deps.openOrToggleWatchGraphPanel(marker);
        closeActionsMenu();
      });
      graphButton.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
      }, { passive: true });
    }

    return div;
  }

  function renderFilter() {
    if (!deps.watchFilter) return;
    const current = deps.watchFilter.value || "all";
    deps.watchFilter.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All";
    deps.watchFilter.appendChild(allOption);

    const seen = new Set<string>();
    const options: Array<{ key: string; label: string }> = [];
    const source = deps.getWatchMarkers().length > 0
      ? deps.getWatchMarkers().map((marker) => marker.watch).filter(Boolean)
      : deps.getWatches();
    for (let i = 0; i < source.length; i += 1) {
      const watch = source[i];
      const key = deps.watchFilterKeyForWatch(watch);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      options.push({
        key,
        label: deps.watchFilterLabelForWatch(watch),
      });
    }

    options.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
    for (const option of options) {
      const opt = document.createElement("option");
      opt.value = option.key;
      opt.textContent = option.label;
      deps.watchFilter.appendChild(opt);
    }

    const nextValue = Array.from(deps.watchFilter.options).some((opt) => opt.value === current) ? current : "all";
    deps.watchFilter.value = nextValue;
  }

  function highlight(timeMs: unknown, doScroll: boolean) {
    const virtualList = deps.watchListVirtual;
    if (!virtualList) return;
    if (timeMs != null && doScroll) {
      const items = virtualList.getItems();
      for (let i = 0; i < items.length; i += 1) {
        if (items[i]?.t === timeMs) {
          virtualList.scrollToIndex(i, 12);
          break;
        }
      }
    }
    virtualList.refresh();
  }

  function renderList() {
    closeActionsMenu();
    if (deps.watchFilter) renderFilter();
    if (deps.watchCount) deps.watchCount.textContent = "0";

    const mode = deps.watchSort ? deps.watchSort.value : "time";
    const items = deps.getWatchMarkers().filter((marker) => deps.watchFilterMatches(marker.watch));
    if (deps.watchCount) deps.watchCount.textContent = `${items.length}`;

    items.sort((a, b) => {
      const watchA = a.watch || {};
      const watchB = b.watch || {};
      if (mode === "level") {
        const rank = deps.levelSortRank(watchB.level) - deps.levelSortRank(watchA.level);
        if (rank !== 0) return rank;
        return (b.t ?? 0) - (a.t ?? 0);
      }
      if (mode === "time") return (a.t ?? 0) - (b.t ?? 0);
      if (mode === "-time") return (b.t ?? 0) - (a.t ?? 0);
      if (mode === "value") {
        const keyA = deps.watchSortValueKey(watchA.value);
        const keyB = deps.watchSortValueKey(watchB.value);
        if (keyA.t !== keyB.t) return keyA.t - keyB.t;
        if (keyA.t === 1) return keyA.n - keyB.n;
        return keyA.s.localeCompare(keyB.s);
      }
      return 0;
    });

    const renderedIndexByTime = new Map<unknown, number>();
    for (let i = 0; i < items.length; i += 1) {
      renderedIndexByTime.set(items[i].t, i);
    }
    deps.setRenderedWatchIndexByTime(renderedIndexByTime);

    deps.watchListVirtual?.setItems(items);
    if (deps.getSelectedWatch()?.marker?.t != null) highlight(deps.getSelectedWatch().marker.t, false);
    deps.refreshWatchGraphPanelData();
  }

  return {
    createItem,
    renderList,
    renderFilter,
    highlight,
    closeActionsMenu,
    isActionsMenuTarget,
    syncItemActionLayout,
  };
}
