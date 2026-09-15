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

  resetParser(): void {
    this.lastPoseTimestamp = null;
  }

  clearPending(): void {
    this.pending.clear();
  }
}
