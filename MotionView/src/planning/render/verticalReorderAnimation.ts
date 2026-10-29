/** Capture current visual positions, including an in-flight reorder animation. */
export function captureVerticalPositions(
  items: Iterable<HTMLElement>,
  idKey: string,
): ReadonlyMap<string, number> {
  const positions = new Map<string, number>();
  for (const item of items) {
    const id = item.dataset[idKey];
    if (id) positions.set(id, item.getBoundingClientRect().top);
  }
  return positions;
}

/** Shared vertical slide used by Object Methods and waypoint motions. */
export function animateVerticalReorder(
  getItems: () => Iterable<HTMLElement>,
  idKey: string,
  positions: ReadonlyMap<string, number>,
): void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  requestAnimationFrame(() => {
    for (const item of getItems()) {
      const id = item.dataset[idKey];
      const previousTop = id ? positions.get(id) : undefined;
      if (previousTop === undefined) continue;
      const offset = previousTop - item.getBoundingClientRect().top;
      if (Math.abs(offset) < 1) continue;
      item.animate(
        [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
        { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    }
  });
}
