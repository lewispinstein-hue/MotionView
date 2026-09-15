import type { TelemetryClient } from "./telemetryClient";
import type { TelemetryProperties } from "./telemetryTypes";

export class PlanningTelemetry {
  constructor(private readonly telemetry: TelemetryClient) {}

  templateUpdated(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_template_updated", properties);
  }

  templateExported(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_template_exported", properties);
  }

  objectCreated(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_object_created", properties);
  }

  objectRemoved(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_object_removed", properties);
  }

  methodCreated(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_method_created", properties);
  }

  methodUpdated(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_method_updated", properties);
  }

  methodRemoved(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_method_removed", properties);
  }

  timelineNodeCreated(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_timeline_node_created", properties);
  }

  timelineNodeMoved(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_timeline_node_moved", properties);
  }

  timelineNodeUpdated(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_timeline_node_updated", properties);
  }

  timelineNodeRemoved(properties: TelemetryProperties = {}) {
    return this.telemetry.capture("planning_timeline_node_removed", properties);
  }
}
