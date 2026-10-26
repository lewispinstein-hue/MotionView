import type { BridgeService } from "../app/BridgeService";
import { liveTelemetry } from "../telemetry/createTelemetry";
import type { ViewingFeature } from "../viewing/ViewingFeature";
import type { ViewingAppendResult } from "../viewing/viewingTypes";
import type { LiveEvents } from "./LiveEvents";
import type { LiveLineParser, ParsedLiveBatchResult } from "./LiveLineParser";
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
  insertedWatches: [],
};

export class LiveStream {
  #command: Promise<unknown> = Promise.resolve();
  #lastBatchFailure: string | null = null;
  #projectPath: string | null = null;
  #applyingLiveBatch = false;

  constructor(
    private readonly session: LiveSession,
    private readonly events: LiveEvents,
    private readonly bridge: BridgeService,
    private readonly viewing: ViewingFeature,
    private readonly parser: LiveLineParser,
    private readonly metrics: LiveMetrics,
  ) {
    events.preferencesChanged.subscribe(() => this.restartRefreshTimer());
    events.projectChanged.subscribe(({ path }) => {
      if (this.#projectPath != null && path !== this.#projectPath)
        this.session.forgetTimestamp();
      this.#projectPath = path;
    });
    viewing.events.dataChanged.subscribe((event) => {
      if (event.kind === "replaced" && !this.#applyingLiveBatch) this.reset();
    });
  }

  get streaming(): boolean {
    return this.session.streamState === "streaming";
  }
  get acceptingData(): boolean {
    return (
      this.streaming ||
      this.session.streamState === "starting" ||
      this.session.streamState === "stopping"
    );
  }
  get state(): LiveStreamState {
    return this.session.streamState;
  }
  get pendingLineCount(): number {
    return this.session.pending.pendingCount();
  }

  start(): Promise<boolean> {
    return this.serialize(async () => {
      if (this.streaming) return true;
      if (this.session.connectionState !== "connected") return false;
      this.setState("starting");
      this.session.clearPending();
      this.session.resetParser();
      liveTelemetry.resetCurrentStreamingSession();
      const response = await this.bridge.post<LiveApiResponse>(
        "/api/start",
        { resume: this.session.timestampResume() },
        { timeoutMs: 5_000 },
      );
      if (!response.ok || response.json?.ok === false) {
        this.appendConsole(
          `[api] start failed (${response.json?.status || response.status})`,
        );
        this.appendConsole(
          "Backend may not be working. Try restarting the application.",
        );
        this.session.clearPending();
        this.setState("idle");
        return false;
      }
      if (this.session.connectionState !== "connected") {
        await this.bridge.post<LiveApiResponse>("/api/stop", undefined, {
          timeoutMs: 5_000,
        });
        this.setState("idle");
        return false;
      }
      this.setState("streaming");
      this.restartRefreshTimer();
      liveTelemetry.streamingStarted();
      this.events.notice.emit({
        kind: "success",
        message: "Streaming started",
      });
      this.appendConsole("[UI] Streaming started");
      return true;
    });
  }

  stop(
    options: Readonly<{ force?: boolean; reason?: "app_closed" }> = {},
  ): Promise<boolean> {
    return this.serialize(async () => {
      const endReason =
        options.reason ?? (options.force ? "force_stop" : "manual_stop");
      if (
        !options.force &&
        !this.streaming &&
        this.session.streamState !== "starting"
      ) {
        this.stopRefreshTimer();
        this.applyPendingBatch();
        this.metrics.endRun(endReason);
        this.session.clearPending();
        return true;
      }
      const wasStreaming = this.streaming;
      this.setState("stopping");
      const force = !!options.force;
      let response = await this.bridge.post<LiveApiResponse>(
        force ? "/api/kill" : "/api/stop",
        undefined,
        { timeoutMs: 5_000 },
      );
      if (force && (!response.ok || response.json?.ok === false)) {
        response = await this.bridge.post<LiveApiResponse>(
          "/api/stop",
          undefined,
          { timeoutMs: 5_000 },
        );
      }
      // Include records received while the backend was stopping. A normal
      // refresh is paused in this state; the final drain has no interval or
      // active-connection requirement.
      this.applyPendingBatch();
      if (!response.ok || response.json?.ok === false) {
        this.appendConsole(
          `[api] stop/kill failed (${response.json?.status || response.status})`,
        );
        this.setState(wasStreaming ? "streaming" : "idle");
        return false;
      }
      this.stopRefreshTimer();
      this.metrics.endRun(endReason);
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
    if (this.session.connectionState !== "connected")
      return EMPTY_APPEND_RESULT;
    if (
      this.session.streamState === "starting" ||
      this.session.streamState === "stopping"
    )
      return EMPTY_APPEND_RESULT;
    if (!this.streaming) {
      this.session.clearPending();
      return EMPTY_APPEND_RESULT;
    }
    return this.applyPendingBatch();
  }

  /** Apply accepted records before ending a capture, even with refresh Off. */
  private applyPendingBatch(): ViewingAppendResult {
    const pending = this.session.pending.batch();
    if (!pending) return EMPTY_APPEND_RESULT;
    let parsed: ParsedLiveBatchResult | null = null;
    try {
      parsed = this.parser.parse(
        pending,
        this.viewing.data,
        // Stop/exit and imported data can reset parser state without clearing
        // Viewing. Never append a pose behind the existing route's tail.
        this.viewing.data.poses[this.viewing.data.poses.length - 1]?.t ??
          this.session.lastPoseTimestamp,
      );
      if (parsed.runStart) this.metrics.beginRun(parsed.runStart);
      this.#applyingLiveBatch = true;
      const result = parsed.startsNewRun
        ? this.viewing.loadParsedBatch(parsed.batch)
        : this.viewing.appendLiveBatch(parsed.batch);
      this.session.pending.markConsumed(pending.endIndex);
      this.session.lastPoseTimestamp = parsed.lastPoseTimestamp;
      this.#lastBatchFailure = null;
      this.metrics.accept(result, parsed.batch);
      if (result.hasNewData) {
        this.events.batchAccepted.emit({
          result,
          pendingLineCount: this.pendingLineCount,
        });
      }
      return result;
    } catch (error) {
      // Never let one malformed record or rendering-side exception pin the
      // pending buffer forever. Previously the same batch was retried on each
      // refresh, so every subsequent valid telemetry record was stranded
      // behind it until the fixed-size buffer eventually overflowed.
      this.session.pending.markConsumed(pending.endIndex);
      if (parsed) this.session.lastPoseTimestamp = parsed.lastPoseTimestamp;
      const detail =
        error instanceof Error && error.message
          ? error.message
          : "unknown error";
      if (detail !== this.#lastBatchFailure) {
        this.#lastBatchFailure = detail;
        this.appendConsole(
          `[UI] Skipped a live-data batch (${detail}).`,
        );
      }
      console.error("MotionView could not process a live-data batch:", error);
      return EMPTY_APPEND_RESULT;
    } finally {
      this.#applyingLiveBatch = false;
    }
  }

  captureHasData(text: string): boolean {
    const lines = String(text ?? "").split(/\r?\n/);
    const pending = { lines, startIndex: 0, endIndex: lines.length };
    const { batch } = this.parser.parse(pending, this.viewing.data, null);
    return (
      (batch.poses?.length ?? 0) > 0 ||
      (batch.watches?.length ?? 0) > 0 ||
      (batch.logs?.length ?? 0) > 0 ||
      (batch.waypointEvents?.length ?? 0) > 0
    );
  }

  loadCapture(text: string): ViewingAppendResult {
    const lines = String(text ?? "").split(/\r?\n/);
    const pending = { lines, startIndex: 0, endIndex: lines.length };
    const parsed = this.parser.parse(pending, this.viewing.data, null);
    const result = this.viewing.loadParsedBatch(parsed.batch);
    this.session.resetParser();
    this.session.forgetTimestamp();
    this.session.clearPending();
    return result;
  }

  connectionOpened(): void {
    this.restartRefreshTimer();
  }

  remoteExit(): Promise<void> {
    return this.serialize(async () => {
      if (!this.streaming && this.session.streamState !== "starting") return;
      this.stopRefreshTimer();
      this.applyPendingBatch();
      this.metrics.endRun("terminal_disconnected");
      this.session.clearPending();
      this.session.resetParser();
      this.setState("idle");
      await liveTelemetry.streamingStopped();
      this.appendConsole("[UI] Robot disconnected");
    });
  }

  async connectionClosed(): Promise<void> {
    this.stopRefreshTimer();
    this.applyPendingBatch();
    this.metrics.endRun("connection_closed");
    this.session.clearPending();
    this.session.resetParser();
    if (this.streaming || this.session.streamState === "stopping")
      await liveTelemetry.streamingStopped();
    else liveTelemetry.resetCurrentStreamingSession();
    this.setState("idle");
  }

  reset(): void {
    this.session.clearPending();
    this.session.resetParser();
    this.session.forgetTimestamp();
  }

  /**
   * Drops records that arrived before a visible-data clear without resetting
   * the active stream's parser state. Resetting that state while the robot is
   * still sending data can break continuity until the whole app is reloaded.
   */
  discardPending(): void {
    this.session.clearPending();
  }

  private restartRefreshTimer(): void {
    this.stopRefreshTimer();
    if (
      this.session.connectionState !== "connected" ||
      !this.streaming ||
      this.session.refreshIntervalMs <= 0
    )
      return;
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

  private serialize<T>(command: () => Promise<T>): Promise<T> {
    const run = this.#command.catch(() => undefined).then(command);
    this.#command = run;
    return run;
  }
}
