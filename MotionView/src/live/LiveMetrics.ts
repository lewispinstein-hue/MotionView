import { liveTelemetry } from "../telemetry/createTelemetry";
import { createTelemetryId } from "../telemetry/telemetryIds";
import type { TelemetryProperties } from "../telemetry/telemetryTypes";
import type { ParsedLiveViewingBatch, ViewingAppendResult } from "../viewing/viewingTypes";
import type { LiveRunEndReason, LiveRunStart } from "./liveTypes";

interface LiveTelemetrySink {
  totalStreamingDuration(properties?: TelemetryProperties): Promise<unknown>;
  livestreamMetrics(properties?: TelemetryProperties): Promise<unknown>;
  liveRunStarted(properties: TelemetryProperties): Promise<unknown>;
  liveRunFatalError(properties: TelemetryProperties): Promise<unknown>;
  liveRunEnded(properties: TelemetryProperties): Promise<unknown>;
}

interface ActiveLiveRun {
  readonly id: string;
  readonly start: LiveRunStart;
  readonly observedStartedAt: number;
  poses: number;
  watches: number;
  logs: number;
  waypoints: number;
  batches: number;
  fatalSystemLogs: number;
  latestTimestampMs: number | null;
}

interface LiveSessionSummary {
  runs: number;
  poses: number;
  watches: number;
  logs: number;
  waypoints: number;
  batches: number;
  fatalSystemLogs: number;
  observedDurationMs: number;
  telemetryDurationMs: number;
}

export interface LiveMetricsOptions {
  readonly telemetry?: LiveTelemetrySink;
  readonly now?: () => number;
  readonly createRunId?: () => string;
}

/** Owns per-run and cumulative telemetry for the current viewer session. */
export class LiveMetrics {
  #finalized = false;
  #activeRun: ActiveLiveRun | null = null;
  #telemetryChain: Promise<void> = Promise.resolve();
  readonly #sessionSummary: LiveSessionSummary = {
    runs: 0,
    poses: 0,
    watches: 0,
    logs: 0,
    waypoints: 0,
    batches: 0,
    fatalSystemLogs: 0,
    observedDurationMs: 0,
    telemetryDurationMs: 0,
  };
  readonly #telemetry: LiveTelemetrySink;
  readonly #now: () => number;
  readonly #createRunId: () => string;

  constructor(options: LiveMetricsOptions = {}) {
    this.#telemetry = options.telemetry ?? liveTelemetry;
    this.#now = options.now ?? (() => performance.now());
    this.#createRunId = options.createRunId ?? createTelemetryId;
  }

  beginRun(start: LiveRunStart): void {
    this.endRun("replaced_by_start");
    const run: ActiveLiveRun = {
      id: this.#createRunId(),
      start,
      observedStartedAt: this.#now(),
      poses: 0,
      watches: 0,
      logs: 0,
      waypoints: 0,
      batches: 0,
      fatalSystemLogs: 0,
      latestTimestampMs: null,
    };
    this.#activeRun = run;
    this.queueTelemetry(() => this.#telemetry.liveRunStarted(this.runProperties(run)));
  }

  accept(result: Readonly<ViewingAppendResult>, batch?: Readonly<ParsedLiveViewingBatch>): void {
    const run = this.#activeRun;
    if (!run || !batch) return;
    run.poses += result.posesAdded;
    run.watches += result.watchesAdded;
    run.logs += result.logsAdded;
    run.waypoints += result.waypointsAdded;
    run.batches += 1;
    run.latestTimestampMs = maxTimestamp(run.latestTimestampMs, latestTimestamp(batch));

    for (const log of batch.logs ?? []) {
      if (log.isSystem !== true || log.level !== "FATAL") continue;
      run.fatalSystemLogs += 1;
      const properties = {
        ...this.runProperties(run),
        robot_timestamp_ms: log.t,
        message: log.message,
      };
      this.queueTelemetry(() => this.#telemetry.liveRunFatalError(properties));
    }
  }

  endRun(reason: LiveRunEndReason): void {
    const run = this.#activeRun;
    if (!run) return;
    this.#activeRun = null;

    const observedDurationMs = Math.max(0, Math.round(this.#now() - run.observedStartedAt));
    const lastTimestampMs = run.latestTimestampMs ?? run.start.robotStartTimestampMs;
    const telemetryDurationMs = Math.max(0, lastTimestampMs - run.start.robotStartTimestampMs);
    this.#sessionSummary.runs += 1;
    this.#sessionSummary.poses += run.poses;
    this.#sessionSummary.watches += run.watches;
    this.#sessionSummary.logs += run.logs;
    this.#sessionSummary.waypoints += run.waypoints;
    this.#sessionSummary.batches += run.batches;
    this.#sessionSummary.fatalSystemLogs += run.fatalSystemLogs;
    this.#sessionSummary.observedDurationMs += observedDurationMs;
    this.#sessionSummary.telemetryDurationMs += telemetryDurationMs;
    this.queueTelemetry(() => this.#telemetry.liveRunEnded({
      ...this.runProperties(run),
      end_reason: reason,
      observed_duration_ms: observedDurationMs,
      telemetry_duration_ms: telemetryDurationMs,
      last_telemetry_timestamp_ms: lastTimestampMs,
      poses_received: run.poses,
      watches_received: run.watches,
      logs_received: run.logs,
      waypoints_received: run.waypoints,
      // Length aliases make the final snapshot easy to query alongside the
      // corresponding Viewing collections while preserving the original
      // received-count property names.
      poses_len: run.poses,
      watches_len: run.watches,
      logs_len: run.logs,
      waypoints_len: run.waypoints,
      accepted_batches: run.batches,
      fatal_system_logs: run.fatalSystemLogs,
    }));
  }

  async finalizeTelemetry(): Promise<void> {
    if (this.#finalized) return this.#telemetryChain;
    this.#finalized = true;
    this.endRun("app_closed");
    // Keep the legacy session-level event as a compact companion to the
    // detailed per-run events. Existing dashboard fields are retained while
    // the additional totals describe every robot-program run in this app use.
    this.queueTelemetry(() => this.#telemetry.totalStreamingDuration());
    this.queueTelemetry(() => this.#telemetry.livestreamMetrics(this.sessionProperties()));
    await this.#telemetryChain;
  }

  async drainTelemetry(): Promise<void> {
    await this.#telemetryChain;
  }

  private runProperties(run: Readonly<ActiveLiveRun>): TelemetryProperties {
    return {
      live_run_id: run.id,
      robot_start_timestamp_ms: run.start.robotStartTimestampMs,
      odom_provider_id: run.start.odomProviderId,
      odom_provider: run.start.odomProvider,
      mvlib_version_encoded: run.start.mvlibVersionEncoded,
    };
  }

  private sessionProperties(): TelemetryProperties {
    const summary = this.#sessionSummary;
    return {
      // Names retained for existing livestream_metrics dashboards.
      totalPosesReceived: summary.poses,
      totalWatchesReceived: summary.watches,
      totalLogsReceived: summary.logs,
      totalWaypointsReceived: summary.waypoints,
      // Session-level context added alongside the legacy totals.
      totalRuns: summary.runs,
      totalAcceptedBatches: summary.batches,
      totalFatalSystemLogs: summary.fatalSystemLogs,
      totalObservedDurationMs: summary.observedDurationMs,
      totalTelemetryDurationMs: summary.telemetryDurationMs,
    };
  }

  private queueTelemetry(capture: () => Promise<unknown>): void {
    const send = async () => {
      try {
        await capture();
      } catch (error) {
        // Telemetry is observational and must not affect live streaming.
        console.warn("Live-run telemetry capture failed:", error);
      }
    };
    this.#telemetryChain = this.#telemetryChain.then(send, send);
  }
}

function latestTimestamp(batch: Readonly<ParsedLiveViewingBatch>): number | null {
  let latest: number | null = null;
  for (const pose of batch.poses ?? []) latest = maxTimestamp(latest, pose.t ?? null);
  for (const watch of batch.watches ?? []) latest = maxTimestamp(latest, watch.t);
  for (const log of batch.logs ?? []) latest = maxTimestamp(latest, log.t);
  for (const waypoint of batch.waypointEvents ?? []) latest = maxTimestamp(latest, waypoint.t);
  return latest;
}

function maxTimestamp(current: number | null, candidate: number | null): number | null {
  if (candidate == null || !Number.isFinite(candidate)) return current;
  return current == null ? candidate : Math.max(current, candidate);
}
