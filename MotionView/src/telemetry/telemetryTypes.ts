export type TelemetryEventName = string;
export type TelemetryProperties = Record<string, unknown>;

export interface TelemetryCaptureOptions {
  debounceMs?: number;
  debounceKey?: string;
  immediate?: boolean;
}

export interface SystemInfo {
  os?: string;
  arch?: string;
}

export interface QueuedTelemetryEvent {
  event: TelemetryEventName;
  properties: TelemetryProperties;
  createdAt: string;
}
