import type { TelemetryClient } from "./telemetryClient";
import type { TelemetryProperties } from "./telemetryTypes";

export class ExportTelemetry {
  constructor(private readonly telemetry: TelemetryClient) {}

  motionviewJsonExported(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("motionview_json_exported", properties);
  }
}
