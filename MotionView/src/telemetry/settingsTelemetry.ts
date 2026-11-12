import type { TelemetryClient } from "./telemetryClient";

export type ProsAutoDetectFailure =
  | "bridge_unavailable"
  | "request_failed"
  | "bridge_error"
  | "invalid_response";

/** Settings actions and diagnostics; never includes local paths or image contents. */
export class SettingsTelemetry {
  constructor(private readonly telemetry: TelemetryClient) {}

  fieldImageLoaded(field: string) {
    return this.telemetry.capture("field_image_loaded", { field }, {
      debounceMs: 1500,
    });
  }

  customFieldImageUploaded(imageType: string, imageBytes: number) {
    return this.telemetry.capture("custom_field_image_uploaded", {
      image_type: imageType,
      image_bytes: imageBytes,
    });
  }

  robotImageUploaded(imageType: string, imageBytes: number) {
    return this.telemetry.capture("robot_image_uploaded", {
      image_type: imageType,
      image_bytes: imageBytes,
    });
  }

  unitsChanged(units: string) {
    return this.telemetry.capture("settings_units_changed", { units });
  }

  speedNormalizationChanged(minSpeed: number | null, maxSpeed: number | null) {
    return this.telemetry.capture("settings_speed_normalization_changed", {
      min_speed: minSpeed,
      max_speed: maxSpeed,
    });
  }

  prosProjectAutoDetectFailed(reason: ProsAutoDetectFailure, httpStatus?: number) {
    return this.telemetry.capture("pros_project_auto_detect_failed", {
      reason,
      ...(httpStatus && httpStatus > 0 ? { http_status: httpStatus } : {}),
    });
  }

  telemetryPreferenceChanged(enabled: boolean) {
    return this.telemetry.capture(
      "telemetry_preference_changed",
      { telemetry_enabled: enabled },
      { explicitUserAction: true },
    );
  }
}
