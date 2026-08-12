export interface LiveCounts {
  posesAdded: number;
  watchesAdded: number;
  logsAdded: number;
  waypointsAdded: number;
}

export interface LivePendingBatch {
  lines: string[];
  startIndex: number;
  endIndex: number;
}

export class LivePendingBuffer {
  private lines: string[] = [];
  private consumed = 0;

  constructor(private readonly maxPending = 12_000) {}

  push(line: string) {
    this.lines.push(line);
    if (this.lines.length > this.maxPending) {
      const drop = this.lines.length - this.maxPending;
      this.lines.splice(0, drop);
      this.consumed = Math.max(0, this.consumed - drop);
    }
  }

  clear() {
    if (this.lines.length === 0) return;
    this.lines = [];
    this.consumed = 0;
  }

  batch(): LivePendingBatch | null {
    const startIndex = this.consumed;
    const endIndex = this.lines.length;
    if (startIndex >= endIndex) return null;
    return {
      lines: this.lines,
      startIndex,
      endIndex,
    };
  }

  markConsumed(endIndex: number) {
    const consumedCount = Math.max(0, Math.min(endIndex, this.lines.length));
    if (consumedCount === 0) return;
    this.lines = this.lines.slice(consumedCount);
    this.consumed = 0;
  }

  pendingCount() {
    return this.lines.length - this.consumed;
  }

  get consumedIndex() {
    return this.consumed;
  }
}

export function stripToTag(line: string) {
  const iData = line.indexOf("[POSE]");
  const iWatch = line.indexOf("[WATCH]");
  const iLog = line.indexOf("[LOG]");
  const iWaypoint = line.indexOf("[WPOINT]");
  const indices = [iData, iWatch, iLog, iWaypoint].filter((idx) => idx >= 0);
  const i = indices.length ? Math.min(...indices) : -1;

  if (i < 0) return "";
  return line.slice(i).trim();
}

export function emptyLiveCounts(): LiveCounts {
  return { posesAdded: 0, watchesAdded: 0, logsAdded: 0, waypointsAdded: 0 };
}
