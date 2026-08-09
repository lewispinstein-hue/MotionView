export interface ScrollAnchor {
  key: string | null;
  offset: number;
  scrollTop: number;
  nearBottom: boolean;
}

export function captureScrollAnchor(
  container: HTMLElement | null,
  itemSelector: string,
  getKey: (element: HTMLElement) => string | null,
): ScrollAnchor | null {
  if (!container) return null;
  const containerRect = container.getBoundingClientRect();
  const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 12;

  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (rect.bottom < containerRect.top) continue;
    return {
      key: getKey(item),
      offset: rect.top - containerRect.top,
      scrollTop: container.scrollTop,
      nearBottom,
    };
  }

  return {
    key: null,
    offset: 0,
    scrollTop: container.scrollTop,
    nearBottom,
  };
}

export function restoreScrollAnchor(
  container: HTMLElement | null,
  anchor: ScrollAnchor | null,
  itemSelector: string,
  getKey: (element: HTMLElement) => string | null,
) {
  if (!container || !anchor) return;
  if (anchor.nearBottom) {
    container.scrollTop = container.scrollHeight;
    return;
  }

  if (anchor.key != null) {
    const containerRect = container.getBoundingClientRect();
    const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
    const item = items.find((candidate) => getKey(candidate) === anchor.key);
    if (item) {
      const rect = item.getBoundingClientRect();
      container.scrollTop += rect.top - containerRect.top - anchor.offset;
      return;
    }
  }

  container.scrollTop = anchor.scrollTop;
}
