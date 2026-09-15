import type { TelemetryClient } from "./telemetryClient";
import type { TelemetryProperties } from "./telemetryTypes";

export class AppTelemetry {
  constructor(private readonly telemetry: TelemetryClient) {}

  loaded(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("app_loaded", properties);
  }

  modeChanged(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("mode_changed", properties, { debounceMs: 700 });
  }

  exiting(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("app_exit", properties);
  }
}
