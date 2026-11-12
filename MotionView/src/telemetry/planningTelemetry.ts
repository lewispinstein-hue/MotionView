import type { TelemetryClient } from "./telemetryClient";
import type { TelemetryProperties } from "./telemetryTypes";

export interface PlanningLagContext {
  plan_waypoints: number;
  simulator_model: string;
  movement_types: readonly string[];
  lead_waypoints: number;
}

export type PlanningSimulationFailure = "missing_result" | "worker_error" | "dispatch_error";

const BUCKETS_MS = [4, 8, 16, 24, 32, 50, 100, 200, 500, Infinity];
const SLOW_RENDER_MS = 32;

/** Low-volume workflow and performance telemetry for one app process. */
export class PlanningTelemetry {
  #enteredAt: number | null = null;
  #activeMs = 0;
  #visits = 0;
  #finalized = false;
  #pathsCreated = 0;
  #pathsDerived = 0;
  #transforms = 0;
  #codeExports = 0;
  #blockedExports = 0;
  #renderSamples = 0;
  #slowRenders = 0;
  #renderBuckets = BUCKETS_MS.map(() => 0);
  #recentRenders: number[] = [];
  #lastLagAt = -Infinity;
  #lagReports = 0;
  #lagContext: (() => PlanningLagContext) | null = null;
  #simulationRequests = 0;
  #simulationCompleted = 0;
  #simulationFailures = 0;
  #simulationFailureReports = 0;
  #simulationLatencyBuckets = BUCKETS_MS.map(() => 0);
  #largestSimulation = 0;
  #simulationModels = new Set<string>();
  #latestSimulationOutcome: string | null = null;

  constructor(
    private readonly telemetry: TelemetryClient,
    private readonly now: () => number = () => performance.now(),
  ) {}

  setLagContext(provider: () => PlanningLagContext): void {
    this.#lagContext = provider;
  }

  modeChanged(mode: "viewing" | "planning"): void {
    if (mode === "planning") {
      if (this.#enteredAt === null) {
        this.#enteredAt = this.now();
        this.#visits += 1;
      }
    } else if (this.#enteredAt !== null) {
      this.#activeMs += Math.max(0, this.now() - this.#enteredAt);
      this.#enteredAt = null;
    }
  }

  pathCreated(): void { this.#pathsCreated += 1; }
  pathTransformed(): void { this.#transforms += 1; }

  pathDerived(properties: TelemetryProperties): void {
    this.#pathsDerived += 1;
    void this.telemetry.capture("planning_path_derived", properties);
  }

  codeExported(properties: TelemetryProperties): void {
    this.#codeExports += 1;
    // Keep the established event name so existing export trends continue.
    void this.telemetry.capture("planning_template_exported", properties);
  }

  codeExportBlocked(properties: TelemetryProperties): void {
    this.#blockedExports += 1;
    void this.telemetry.capture("planning_code_export_blocked", properties);
  }

  simulationRequested(waypointCount: number, model: string): void {
    if (waypointCount < 2) return;
    this.#simulationRequests += 1;
    this.#largestSimulation = Math.max(this.#largestSimulation, waypointCount);
    this.#simulationModels.add(model);
  }

  simulationFinished(startedAt: number, waypointCount: number, outcome: string | null): void {
    if (waypointCount < 2) return;
    this.#simulationCompleted += 1;
    this.addBucket(this.#simulationLatencyBuckets, Math.max(0, this.now() - startedAt));
    if (outcome) this.#latestSimulationOutcome = outcome;
  }

  simulationFailed(
    startedAt: number,
    waypointCount: number,
    model: string,
    failure: PlanningSimulationFailure,
  ): void {
    if (waypointCount < 2) return;
    this.#simulationFailures += 1;
    if (this.#simulationFailureReports++ >= 3) return;
    void this.telemetry.capture("planning_simulation_failed", {
      failure,
      simulator_model: model,
      waypoint_count_bucket: this.countBucket(waypointCount),
      latency_ms: Math.round(Math.max(0, this.now() - startedAt)),
    });
  }

  recordRender(durationMs: number): void {
    if (this.#enteredAt === null || !Number.isFinite(durationMs)) return;
    const duration = Math.max(0, durationMs);
    this.#renderSamples += 1;
    this.addBucket(this.#renderBuckets, duration);
    if (duration >= SLOW_RENDER_MS) this.#slowRenders += 1;
    this.#recentRenders.push(duration);
    if (this.#recentRenders.length > 10) this.#recentRenders.shift();
    const now = this.now();
    if (
      this.#lagReports >= 3 ||
      now - this.#lastLagAt < 60_000 ||
      this.#recentRenders.filter((value) => value >= SLOW_RENDER_MS).length < 3
    ) return;
    this.#lastLagAt = now;
    this.#lagReports += 1;
    const recent = [...this.#recentRenders].sort((a, b) => a - b);
    let context: PlanningLagContext | undefined;
    try {
      context = this.#lagContext?.();
    } catch {
      // Diagnostic collection must not interrupt field rendering.
    }
    void this.telemetry.capture("planning_render_lag", {
      render_p95_ms: Math.round(recent[Math.ceil(recent.length * 0.95) - 1] ?? duration),
      render_max_ms: Math.round(recent.at(-1) ?? duration),
      ...context,
    });
    this.#recentRenders = [];
  }

  /** Emit only on app close, aggregating all visits to Planning. */
  sessionEnded(properties: TelemetryProperties): void {
    if (this.#finalized || this.#visits === 0) return;
    this.#finalized = true;
    if (this.#enteredAt !== null) {
      this.#activeMs += Math.max(0, this.now() - this.#enteredAt);
      this.#enteredAt = null;
    }
    this.telemetry.queueAutomatic("planning_session_ended", {
      ...properties,
      planning_visits: this.#visits,
      active_seconds: Math.round(this.#activeMs / 1000),
      paths_created: this.#pathsCreated,
      paths_derived: this.#pathsDerived,
      transforms_applied: this.#transforms,
      code_exports: this.#codeExports,
      blocked_exports: this.#blockedExports,
      frames_sampled: this.#renderSamples,
      render_p95_ms: this.percentileBucket(this.#renderBuckets, this.#renderSamples),
      slow_frame_count: this.#slowRenders,
    });
    if (this.#simulationRequests > 0)
      this.telemetry.queueAutomatic("planning_simulation_summary", {
        requests: this.#simulationRequests,
        completed: this.#simulationCompleted,
        worker_failures: this.#simulationFailures,
        latency_p95_ms: this.percentileBucket(
          this.#simulationLatencyBuckets, this.#simulationCompleted,
        ),
        max_waypoint_count: this.#largestSimulation,
        simulator_models: [...this.#simulationModels].sort(),
        latest_preview_outcome: this.#latestSimulationOutcome,
      });
  }

  private addBucket(buckets: number[], value: number): void {
    const index = BUCKETS_MS.findIndex((bound) => value <= bound);
    buckets[index < 0 ? buckets.length - 1 : index]! += 1;
  }

  private percentileBucket(buckets: number[], count: number): number | null {
    if (!count) return null;
    const target = Math.ceil(count * 0.95);
    let seen = 0;
    for (let index = 0; index < buckets.length; index += 1) {
      seen += buckets[index]!;
      if (seen >= target) {
        const bound = BUCKETS_MS[index]!;
        return Number.isFinite(bound) ? bound : 500;
      }
    }
    return null;
  }

  private countBucket(count: number): string {
    return count < 10 ? "<10" : count < 25 ? "10-24" : count < 50 ? "25-49" : "50+";
  }
}
