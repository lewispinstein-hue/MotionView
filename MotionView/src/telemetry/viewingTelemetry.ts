import type { TelemetryClient } from "./telemetryClient";
import type { TelemetryCaptureOptions, TelemetryProperties } from "./telemetryTypes";

export class ViewingTelemetry {
  constructor(private readonly telemetry: TelemetryClient) {}

  fileLoaded(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("file_loaded", properties);
  }

  failedFileLoad(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("failed_file_load", properties);
  }

  fieldImageLoaded(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("field_image_loaded", properties, { debounceMs: 1500 });
  }

  floatingInfoToggled(properties: TelemetryProperties = {}, options: TelemetryCaptureOptions = { debounceMs: 1000 }) {
    return this.telemetry.capture("toggle_floating_info", properties, options);
  }

  planOverlayToggled(properties: TelemetryProperties = {}, options: TelemetryCaptureOptions = { debounceMs: 1000 }) {
    return this.telemetry.capture("toggle_plan_overlay", properties, options);
  }
}
