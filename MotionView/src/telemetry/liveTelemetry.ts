import type { TelemetryClient } from "./telemetryClient";
import type { TelemetryProperties } from "./telemetryTypes";

export class LiveTelemetry {
  private currentSessionMs = 0;
  private totalSessionMs = 0;
  private streamingStartedAt: number | null = null;

  constructor(private readonly telemetry: TelemetryClient) {}

  streamingStarted() {
    this.currentSessionMs = 0;
    this.streamingStartedAt = performance.now();
  }

  async streamingStopped() {
    const seconds = this.consumeCurrentStreamingSeconds();
    if (seconds <= 0) return false;
    return this.telemetry.capture("streaming_duration", {
      streaming_seconds: seconds,
    }, { debounceMs: 1500 });
  }

  resetCurrentStreamingSession() {
    this.currentSessionMs = 0;
    this.streamingStartedAt = null;
  }

  async totalStreamingDuration(properties: TelemetryProperties = {}) {
    this.stopStreamingClock();
    return this.telemetry.capture("total_streaming_duration", {
      duration: this.formatSeconds(this.totalSessionMs / 1000, 1),
      ...properties,
    });
  }

  livestreamMetrics(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("livestream_metrics", properties);
  }

  private consumeCurrentStreamingSeconds() {
    this.stopStreamingClock();
    const seconds = Math.round(this.currentSessionMs / 1000);
    this.resetCurrentStreamingSession();
    return seconds;
  }

  private stopStreamingClock() {
    if (this.streamingStartedAt == null) return;
    const elapsed = performance.now() - this.streamingStartedAt;
    this.currentSessionMs += elapsed;
    this.totalSessionMs += elapsed;
    this.streamingStartedAt = null;
  }

  private formatSeconds(value: number, decimals: number) {
    return Number(value.toFixed(decimals));
  }
}
