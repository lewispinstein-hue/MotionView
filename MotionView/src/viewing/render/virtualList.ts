export interface VirtualListRange<T> {
  startIndex: number;
  endIndex: number;
  items: T[];
}

export interface VirtualListStore<T> {
  readonly length: number;
  readonly capacity: number;
  reserve(capacity: number): void;
  add(item: T): void;
  addMany(items: Iterable<T> | ArrayLike<T>): void;
  setItems(nextItems: ArrayLike<T>): void;
  clear(): void;
  get(index: number): T | undefined;
  getItems(): ArrayLike<T>;
  scrollToIndex(index: number, elements: number): VirtualListRange<T>;
}

export function createVirtualListStore<T>(initialItems: ArrayLike<T> = []): VirtualListStore<T> {
  let items: T[] = [];
  let itemCount = 0;

  function isArrayLike(value: unknown): value is ArrayLike<T> {
    return !!value && typeof (value as { length?: unknown }).length === "number";
  }

  function knownItemCount(value: Iterable<T> | ArrayLike<T>): number | null {
    if (isArrayLike(value)) return Math.max(0, Math.trunc(value.length) || 0);
    const size = (value as { size?: unknown }).size;
    return typeof size === "number" ? Math.max(0, Math.trunc(size) || 0) : null;
  }

  function reserve(capacity: number) {
    const nextCapacity = Math.max(0, Math.trunc(capacity) || 0);
    if (nextCapacity > items.length) items.length = nextCapacity;
  }

  function reserveForAdditional(additionalItems: number) {
    if (additionalItems <= 0) return;
    const required = itemCount + additionalItems;
    if (required <= items.length) return;
    const doubled = Math.max(items.length * 2, 8);
    reserve(Math.max(required, doubled));
  }

  function copyFromArrayLike(nextItems: ArrayLike<T>) {
    itemCount = Math.max(0, Math.trunc(nextItems.length) || 0);
    items = new Array<T>(itemCount);
    for (let i = 0; i < itemCount; i += 1) {
      items[i] = nextItems[i];
    }
  }

  copyFromArrayLike(initialItems);

  function rangeFrom(index: number, elements: number): VirtualListRange<T> {
    const startIndex = Math.max(0, Math.min(itemCount, Math.trunc(index) || 0));
    const count = Math.max(0, Math.trunc(elements) || 0);
    const endIndex = Math.min(itemCount, startIndex + count);
    return {
      startIndex,
      endIndex,
      items: items.slice(startIndex, endIndex),
    };
  }

  return {
    get length() {
      return itemCount;
    },
    get capacity() {
      return items.length;
    },
    reserve,
    add(item: T) {
      reserveForAdditional(1);
      items[itemCount] = item;
      itemCount += 1;
    },
    addMany(nextItems: Iterable<T> | ArrayLike<T>) {
      const count = knownItemCount(nextItems);
      if (count != null) reserveForAdditional(count);

      if (isArrayLike(nextItems)) {
        for (let i = 0; i < nextItems.length; i += 1) {
          items[itemCount] = nextItems[i];
          itemCount += 1;
        }
        return;
      }

      for (const item of nextItems) {
        reserveForAdditional(1);
        items[itemCount] = item;
        itemCount += 1;
      }
    },
    setItems(nextItems: ArrayLike<T>) {
      copyFromArrayLike(nextItems);
    },
    clear() {
      items = [];
      itemCount = 0;
    },
    get(index: number) {
      if (index < 0 || index >= itemCount) return undefined;
      return items[index];
    },
    getItems() {
      return items.slice(0, itemCount);
    },
    scrollToIndex: rangeFrom,
  };
}

export interface VirtualListOptions<T> {
  estimateRowHeight?: number;
  overscanPx?: number;
  scrollContainer?: HTMLElement;
  getKey(item: T, index: number): string;
  renderItem(item: T, index: number): HTMLElement | null;
  syncRowLayout?: (row: HTMLElement) => void;
}

export interface VirtualList<T> {
  readonly length: number;
  readonly capacity: number;
  reserve(capacity: number): void;
  add(item: T): void;
  addMany(items: Iterable<T> | ArrayLike<T>): void;
  clear(options?: { resetScroll?: boolean }): void;
  setItems(nextItems: ArrayLike<T>, options?: { resetScroll?: boolean; preserveScroll?: boolean }): void;
  refresh(): void;
  scrollToIndex(index: number, pad?: number, alignment?: "nearest" | "center"): void;
  getRange(index: number, elements: number): VirtualListRange<T>;
  getItems(): ArrayLike<T>;
}

export function createVirtualList<T>(
  container: HTMLElement | null,
  {
    estimateRowHeight = 64,
    overscanPx = 320,
    scrollContainer,
    getKey,
    renderItem,
    syncRowLayout = () => {},
  }: VirtualListOptions<T>,
): VirtualList<T> | null {
  if (!container) return null;
  const listContainer = container;
  const viewport = scrollContainer ?? listContainer;

  const content = document.createElement("div");
  content.className = "virtualListContent";
  listContainer.replaceChildren(content);
  listContainer.classList.add("virtualList");

  const store = createVirtualListStore<T>();
  let renderQueued = false;
  let tops: number[] = [];
  let heights: number[] = [];
  let totalHeight = 0;
  const measuredHeights = new Map<string, number>();

  function isVisible() {
    return listContainer.getClientRects().length > 0;
  }

  function listOffsetTop() {
    if (viewport === listContainer) return 0;
    const viewportRect = viewport.getBoundingClientRect();
    const listRect = listContainer.getBoundingClientRect();
    return viewport.scrollTop + listRect.top - viewportRect.top;
  }

  function localScrollTop() {
    return Math.max(0, viewport.scrollTop - listOffsetTop());
  }

  function recomputeLayout() {
    tops = new Array(store.length);
    heights = new Array(store.length);

    let cursor = 0;
    for (let i = 0; i < store.length; i += 1) {
      const item = store.get(i) as T;
      tops[i] = cursor;
      const key = getKey(item, i);
      const height = measuredHeights.get(key) ?? estimateRowHeight;
      heights[i] = height;
      cursor += height;
    }

    totalHeight = cursor;
    content.style.height = `${cursor}px`;
  }

  function lowerBoundTop(target: number) {
    let lo = 0;
    let hi = tops.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((tops[mid] + heights[mid]) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function upperBoundTop(target: number) {
    let lo = 0;
    let hi = tops.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function renderNow() {
    renderQueued = false;
    if (!isVisible()) return;
    if (!store.length) {
      content.replaceChildren();
      content.style.height = "0px";
      return;
    }

    const scrollTop = localScrollTop();
    const viewportHeight = viewport.clientHeight || (estimateRowHeight * 8);
    const startPx = Math.max(0, scrollTop - overscanPx);
    const endPx = scrollTop + viewportHeight + overscanPx;

    const startIndex = Math.max(0, lowerBoundTop(startPx));
    const endIndex = Math.min(store.length, Math.max(startIndex + 1, upperBoundTop(endPx)));

    const frag = document.createDocumentFragment();
    const renderedRows: Array<{ key: string; row: HTMLElement }> = [];
    let layoutDirty = false;

    for (let i = startIndex; i < endIndex; i += 1) {
      const item = store.get(i) as T;
      const row = renderItem(item, i);
      if (!row) continue;
      row.classList.add("virtualListRow");
      row.style.top = `${tops[i]}px`;
      const key = getKey(item, i);
      renderedRows.push({ key, row });
      frag.appendChild(row);
    }

    content.replaceChildren(frag);

    for (let i = 0; i < renderedRows.length; i += 1) {
      const { key, row } = renderedRows[i];
      syncRowLayout(row);
      const measureEl = row.querySelector<HTMLElement>(".watchItemContent") || row;
      const margins = getComputedStyle(measureEl);
      const rowHeight = Math.ceil(
        (measureEl.offsetHeight || row.offsetHeight || estimateRowHeight)
        + Number.parseFloat(margins.marginTop || "0")
        + Number.parseFloat(margins.marginBottom || "0"),
      );
      if (rowHeight > 0 && measuredHeights.get(key) !== rowHeight) {
        measuredHeights.set(key, rowHeight);
        layoutDirty = true;
      }
    }

    if (layoutDirty) {
      const anchor = captureScrollAnchor();
      recomputeLayout();
      restoreScrollAnchor(anchor);
      requestRender();
    }
  }

  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderNow);
  }

  function captureScrollAnchor() {
    if (!isVisible()) return null;
    const scrollTop = localScrollTop();
    const nearTop = viewport.scrollTop <= 12;
    const nearBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 12;
    const index = Math.max(0, Math.min(store.length - 1, lowerBoundTop(scrollTop)));
    const item = store.get(index);
    if (item == null) {
      return {
        nearTop,
        nearBottom,
        key: null,
        offset: 0,
        scrollTop: viewport.scrollTop,
      };
    }
    return {
      nearTop,
      nearBottom,
      key: getKey(item, index),
      offset: scrollTop - (tops[index] ?? 0),
      scrollTop: viewport.scrollTop,
    };
  }

  function restoreScrollAnchor(anchor: ReturnType<typeof captureScrollAnchor> | null) {
    if (!anchor) return;
    if (anchor.nearTop) {
      viewport.scrollTop = 0;
      return;
    }
    if (anchor.nearBottom) {
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      return;
    }
    if (anchor.key != null) {
      for (let i = 0; i < store.length; i += 1) {
        const item = store.get(i) as T;
        if (getKey(item, i) !== anchor.key) continue;
        viewport.scrollTop = Math.max(0, listOffsetTop() + (tops[i] ?? 0) + anchor.offset);
        return;
      }
    }
    viewport.scrollTop = anchor.scrollTop;
  }

  function scrollToIndex(index: number, pad = 12, alignment: "nearest" | "center" = "nearest") {
    if (!Number.isInteger(index) || index < 0 || index >= store.length) return;
    const top = tops[index] ?? 0;
    const height = heights[index] ?? estimateRowHeight;
    const absoluteTop = listOffsetTop() + top;
    if (alignment === "center") {
      viewport.scrollTop = Math.max(0, absoluteTop - Math.max(0, (viewport.clientHeight - height) / 2));
      requestRender();
      return;
    }
    const visibleTop = viewport.scrollTop + pad;
    const visibleBottom = viewport.scrollTop + viewport.clientHeight - pad;
    if (absoluteTop < visibleTop) viewport.scrollTop = Math.max(0, absoluteTop - pad);
    else if ((absoluteTop + height) > visibleBottom) {
      viewport.scrollTop = Math.max(0, absoluteTop + height - viewport.clientHeight + pad);
    }
    requestRender();
  }

  function setItems(nextItems: ArrayLike<T>, { resetScroll = false, preserveScroll = true } = {}) {
    const anchor = preserveScroll && !resetScroll ? captureScrollAnchor() : null;
    if (nextItems && typeof nextItems.length === "number") store.setItems(nextItems);
    else store.clear();
    const nextKeys = new Set<string>();
    for (let index = 0; index < store.length; index += 1) {
      nextKeys.add(getKey(store.get(index) as T, index));
    }
    for (const key of measuredHeights.keys()) {
      if (!nextKeys.has(key)) measuredHeights.delete(key);
    }
    recomputeLayout();
    if (resetScroll && isVisible()) viewport.scrollTop = 0;
    else restoreScrollAnchor(anchor);
    requestRender();
  }

  function clear({ resetScroll = false } = {}) {
    store.clear();
    measuredHeights.clear();
    recomputeLayout();
    content.replaceChildren();
    content.style.height = "0px";
    if (resetScroll && isVisible()) viewport.scrollTop = 0;
  }

  viewport.addEventListener("scroll", requestRender, { passive: true });
  window.addEventListener("resize", requestRender);
  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(requestRender);
    resizeObserver.observe(viewport);
    if (viewport !== listContainer) resizeObserver.observe(listContainer);
  }

  return {
    get length() {
      return store.length;
    },
    get capacity() {
      return store.capacity;
    },
    reserve: (capacity: number) => store.reserve(capacity),
    add(item: T) {
      const anchor = captureScrollAnchor();
      store.add(item);
      recomputeLayout();
      restoreScrollAnchor(anchor);
      requestRender();
    },
    addMany(items: Iterable<T> | ArrayLike<T>) {
      const anchor = captureScrollAnchor();
      store.addMany(items);
      recomputeLayout();
      restoreScrollAnchor(anchor);
      requestRender();
    },
    clear,
    setItems,
    refresh: requestRender,
    scrollToIndex,
    getRange: (index: number, elements: number) => store.scrollToIndex(index, elements),
    getItems: () => store.getItems(),
  };
}
