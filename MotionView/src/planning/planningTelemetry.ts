import type { PlanningTelemetry, PlanningTelemetrySnapshot } from "./planningTypes";
import type { PlanningModeInternalState } from "./planningInternalState";

export function createPlanningTelemetry(state: PlanningModeInternalState): PlanningTelemetry {
  return {
    getTelemetryProperties(extra: Record<string, unknown> = {}): PlanningTelemetrySnapshot {
      const methodCount = state.objects.reduce((sum, object) => sum + (Array.isArray(object.methods) ? object.methods.length : 0), 0);
      return {
        plan_waypoints: state.waypoints.length,
        plan_objects: state.objects.length,
        plan_methods: methodCount,
        plan_nodes: state.nodes.length,
        template_chars: state.exportTemplate.length,
        ...extra,
      };
    },
  };
}
