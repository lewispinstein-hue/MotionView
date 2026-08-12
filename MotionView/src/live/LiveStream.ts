import type { BridgeService } from "../app/BridgeService";
import { liveTelemetry } from "../telemetry/createTelemetry";
import type { ViewingFeature } from "../viewing/ViewingFeature";
import type { ViewingAppendResult } from "../viewing/viewingTypes";
import type { LiveEvents } from "./LiveEvents";
import type { LiveLineParser } from "./LiveLineParser";
import type { LiveMetrics } from "./LiveMetrics";
import type { LiveSession } from "./LiveSession";
import type { LiveApiResponse, LiveStreamState } from "./liveTypes";

const EMPTY_APPEND_RESULT: ViewingAppendResult = {
  posesAdded: 0,
  watchesAdded: 0,
  logsAdded: 0,
  waypointsAdded: 0,
  hasNewData: false,
  metadataChanged: false,
};

export class LiveStream {
  #command: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly session: LiveSession,
    private readonly events: LiveEvents,
    private readonly bridge: BridgeService,
    private readonly viewing: ViewingFeature,
    private readonly parser: LiveLineParser,
    private readonly metrics: LiveMetrics,
  ) {
    events.preferencesChanged.subscribe(() => this.restartRefreshTimer());
  }

  get streaming(): boolean { return this.session.streamState === "streaming"; }
  get acceptingData(): boolean { return this.streaming || this.session.streamState === "starting"; }
  get state(): LiveStreamState { return this.session.streamState; }
  get pendingLineCount(): number { return this.session.pending.pendingCount(); }

  start(): Promise<boolean> {
    return this.serialize(async () => {
      if (this.streaming) return true;
      if (this.session.connectionState !== "connected") return false;
      this.setState("starting");
      this.session.clearPending();
      this.session.resetParser();
      liveTelemetry.resetCurrentStreamingSession();
      const response = await this.bridge.post<LiveApiResponse>("/api/start", undefined, { timeoutMs: 5_000 });
      if (!response.ok || response.json?.ok === false) {
        this.appendConsole(`[api] start failed (${response.json?.status || response.status})`);
        this.appendConsole("Backend may not be working. Try restarting the application.");
        this.session.clearPending();
        this.setState("idle");
        return false;
      }
      if (this.session.connectionState !== "connected") {
        await this.bridge.post<LiveApiResponse>("/api/stop", undefined, { timeoutMs: 5_000 });
        this.setState("idle");
        return false;
      }
      this.setState("streaming");
      liveTelemetry.streamingStarted();
      this.events.notice.emit({ kind: "success", message: "Streaming started" });
      this.appendConsole("[UI] Streaming started");
      return true;
    });
  }

  stop(options: Readonly<{ force?: boolean }> = {}): Promise<boolean> {
    return this.serialize(async () => {
      if (!options.force && !this.streaming && this.session.streamState !== "starting") {
        this.session.clearPending();
        return true;
      }
      const wasStreaming = this.streaming;
      this.setState("stopping");
      const force = !!options.force;
      let response = await this.bridge.post<LiveApiResponse>(force ? "/api/kill" : "/api/stop", undefined, { timeoutMs: 5_000 });
      if (force && (!response.ok || response.json?.ok === false)) {
        response = await this.bridge.post<LiveApiResponse>("/api/stop", undefined, { timeoutMs: 5_000 });
      }
      if (!response.ok || response.json?.ok === false) {
        this.appendConsole(`[api] stop/kill failed (${response.json?.status || response.status})`);
        this.setState(wasStreaming ? "streaming" : "idle");
        return false;
      }
      this.session.clearPending();
      this.session.resetParser();
      this.setState("idle");
      await liveTelemetry.streamingStopped();
      const message = force ? "Force-killed" : "Streaming stopped";
      this.events.notice.emit({ kind: "success", message });
      this.appendConsole(`[UI] ${message}`);
      return true;
    });
  }

  refreshNow(): ViewingAppendResult {
    if (this.session.connectionState !== "connected") return EMPTY_APPEND_RESULT;
    if (this.session.streamState === "starting") return EMPTY_APPEND_RESULT;
    if (!this.streaming) {
      this.session.clearPending();
      return EMPTY_APPEND_RESULT;
    }
    const pending = this.session.pending.batch();
    if (!pending) return EMPTY_APPEND_RESULT;
    const startedAt = performance.now();
    try {
      const parsed = this.parser.parse(pending, this.viewing.data, this.session.lastPoseTimestamp);
      const result = this.viewing.appendLiveBatch(parsed.batch);
      this.session.pending.markConsumed(pending.endIndex);
      this.session.lastPoseTimestamp = parsed.lastPoseTimestamp;
      this.metrics.accept(result);
      if (result.hasNewData) {
        this.events.batchAccepted.emit({ result, pendingLineCount: this.pendingLineCount });
      }
      const duration = performance.now() - startedAt;
      if (duration > 100) {
        this.debug(`refresh: ${duration.toFixed(1)}ms (poses=${this.viewing.data.poses.length}, watches=${this.viewing.data.watches.length}, pending=${this.pendingLineCount})`);
      }
      return result;
    } catch (error) {
      this.debug(`refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      return EMPTY_APPEND_RESULT;
    }
  }

  loadCapture(text: string): ViewingAppendResult {
    const lines = String(text ?? "").split(/\r?\n/);
    const pending = { lines, startIndex: 0, endIndex: lines.length };
    const parsed = this.parser.parse(pending, this.viewing.data, null);
    const result = this.viewing.loadParsedBatch(parsed.batch);
    this.session.resetParser();
    this.session.clearPending();
    this.metrics.accept(result);
    return result;
  }

  connectionOpened(): void {
    this.restartRefreshTimer();
  }

  async connectionClosed(): Promise<void> {
    this.stopRefreshTimer();
    this.session.clearPending();
    this.session.resetParser();
    if (this.streaming || this.session.streamState === "stopping") await liveTelemetry.streamingStopped();
    else liveTelemetry.resetCurrentStreamingSession();
    this.setState("idle");
  }

  reset(): void {
    this.session.clearPending();
    this.session.resetParser();
  }

  private restartRefreshTimer(): void {
    this.stopRefreshTimer();
    if (this.session.connectionState !== "connected" || this.session.refreshIntervalMs <= 0) return;
    this.session.refreshTimer = setInterval(() => {
      if (this.session.refreshInFlight) return;
      this.session.refreshInFlight = true;
      try {
        this.refreshNow();
      } finally {
        this.session.refreshInFlight = false;
      }
    }, this.session.refreshIntervalMs);
  }

  private stopRefreshTimer(): void {
    if (this.session.refreshTimer) clearInterval(this.session.refreshTimer);
    this.session.refreshTimer = null;
    this.session.refreshInFlight = false;
  }

  private setState(next: LiveStreamState): void {
    const previous = this.session.streamState;
    if (previous === next) return;
    this.session.streamState = next;
    this.events.streamChanged.emit({ previous, current: next });
  }

  private appendConsole(line: string): void {
    this.events.consoleChanged.emit({ kind: "append", line });
  }

  private debug(message: string): void {
    if (!this.session.debugEnabled) return;
    this.appendConsole(`[DBG] ${message}`);
    void this.bridge.log("DEBUG", message, "live");
  }

  private serialize<T>(command: () => Promise<T>): Promise<T> {
    const run = this.#command.catch(() => undefined).then(command);
    this.#command = run;
    return run;
  }
}
