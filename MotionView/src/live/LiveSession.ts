import { LivePendingBuffer } from "./liveCore";
import type { LiveConnectionState, LiveStreamState } from "./liveTypes";

/** Mutable transport state shared only by concrete Live domain classes. */
export class LiveSession {
  readonly pending = new LivePendingBuffer();
  connectionState: LiveConnectionState = "disconnected";
  streamState: LiveStreamState = "idle";
  refreshIntervalMs = 500;
  lastPoseTimestamp: number | null = null;
  refreshTimer: ReturnType<typeof setInterval> | null = null;
  refreshInFlight = false;
  socket: WebSocket | null = null;
  #timestampAnchor: { timestampMs: number; receivedAt: number } | null = null;

  /** Track receipt time, not refresh time: refresh can be Off for minutes. */
  observeTimestamp(
    timestampMs: number,
    startsNewRun = false,
    now = Date.now(),
  ): void {
    if (
      startsNewRun ||
      this.#timestampAnchor == null ||
      timestampMs > this.#timestampAnchor.timestampMs
    ) {
      this.#timestampAnchor = { timestampMs, receivedAt: now };
    }
  }

  timestampResume(
    now = Date.now(),
  ): { timestampMs: number; elapsedMs: number } | null {
    const anchor = this.#timestampAnchor;
    return anchor
      ? {
          timestampMs: anchor.timestampMs,
          elapsedMs: Math.max(0, now - anchor.receivedAt),
        }
      : null;
  }

  forgetTimestamp(): void {
    this.#timestampAnchor = null;
  }

  resetParser(): void {
    this.lastPoseTimestamp = null;
  }

  clearPending(): void {
    this.pending.clear();
  }
}
