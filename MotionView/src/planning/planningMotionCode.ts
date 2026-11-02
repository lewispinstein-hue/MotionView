/** Editor-only ranges; label rows never become part of a motion's source code. */
export interface MotionCodeEntry {
  readonly id: string;
  readonly name: string;
  readonly code: string;
}

export interface MotionCodeRange {
  readonly id: string;
  readonly name: string;
  readonly headingStart: number;
  readonly start: number;
  readonly end: number;
}

export interface MotionCodeDocument {
  readonly source: string;
  readonly ranges: readonly MotionCodeRange[];
}

export function createMotionCodeDocument(
  entries: readonly MotionCodeEntry[],
): MotionCodeDocument {
  let source = "";
  const ranges: MotionCodeRange[] = [];
  for (const entry of entries) {
    if (source) source += "\n";
    const headingStart = source.length;
    source += ranges.length ? "\n\n" : "\n";
    const start = source.length;
    source += entry.code;
    ranges.push({
      id: entry.id,
      name: entry.name,
      headingStart,
      start,
      end: source.length,
    });
  }
  return { source, ranges };
}

/** Accepts edits contained in one owned block, without guessing from code text. */
export function applyMotionCodeEdit(
  document: MotionCodeDocument,
  next: string,
  preferredId: string | null = null,
): { document: MotionCodeDocument; id: string; code: string } | null {
  const delta = next.length - document.source.length;
  const preferred = document.ranges.find((range) => range.id === preferredId);
  const candidates = preferred
    ? [preferred, ...document.ranges.filter((range) => range !== preferred)]
    : document.ranges;
  const owner = candidates.find(
    (range) =>
      range.end + delta >= range.start &&
      next.slice(0, range.start) === document.source.slice(0, range.start) &&
      next.slice(range.end + delta) === document.source.slice(range.end),
  );
  if (!owner) return null;
  const ranges = document.ranges.map((range) =>
    range === owner
      ? { ...range, end: range.end + delta }
      : range.start > owner.end
        ? {
            ...range,
            headingStart: range.headingStart + delta,
            start: range.start + delta,
            end: range.end + delta,
          }
        : range,
  );
  return {
    document: { source: next, ranges },
    id: owner.id,
    code: next.slice(owner.start, owner.end + delta),
  };
}
