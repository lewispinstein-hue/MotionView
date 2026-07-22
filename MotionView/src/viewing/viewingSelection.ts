export function scrollIntoViewIfNeeded(
  container: HTMLElement | null,
  element: Element | null,
  pad = 10,
) {
  if (!container || !element) return;
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  if (
    elementRect.top >= containerRect.top + pad
    && elementRect.bottom <= containerRect.bottom - pad
  ) {
    return;
  }

  const topDelta = elementRect.top - (containerRect.top + pad);
  const bottomDelta = elementRect.bottom - (containerRect.bottom - pad);
  if (topDelta < 0) container.scrollTop += topDelta;
  else if (bottomDelta > 0) container.scrollTop += bottomDelta;
}
