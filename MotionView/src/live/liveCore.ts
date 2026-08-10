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

export class LiveActionGate {
  private inFlight = false;
  private lastActionAt = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly cooldownMs = 400,
    private readonly timeoutMs = 6000,
    private readonly onTimeout?: () => void,
  ) {}

  get active() {
    return this.inFlight;
  }

  canRun() {
    const now = Date.now();
    if (this.inFlight) return false;
    if (now - this.lastActionAt < this.cooldownMs) return false;
    this.lastActionAt = now;
    return true;
  }

  setInFlight(value: boolean) {
    this.inFlight = value;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (value) {
      this.timeout = setTimeout(() => {
        this.inFlight = false;
        this.onTimeout?.();
      }, this.timeoutMs);
    }
  }
}

export interface LiveConnectionCallbacks {
  onOpen(): void;
  onMessage(raw: string): void;
  onClose(): void;
  onError(): void;
}

export class LiveWebSocketClient {
  private socket: WebSocket | null = null;

  get connected() {
    return this.socket != null;
  }

  connect(url: string, callbacks: LiveConnectionCallbacks) {
    if (this.socket) return false;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", callbacks.onOpen);
    socket.addEventListener("message", (event) => {
      callbacks.onMessage(typeof event.data === "string" ? event.data : "");
    });
    socket.addEventListener("close", () => {
      this.socket = null;
      callbacks.onClose();
    });
    socket.addEventListener("error", callbacks.onError);
    return true;
  }

  close() {
    if (!this.socket) return;
    try {
      this.socket.close();
    } catch {
      // Closing is best-effort; the caller handles final state.
    }
    this.socket = null;
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
