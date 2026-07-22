import type { PlanningModeController, PlanningModeDependencies } from "./planningTypes";

export interface PlanningModeImplementation extends Partial<PlanningModeController> {}

export function createPlanningMode(
  _dependencies: PlanningModeDependencies,
  implementation: PlanningModeImplementation = {},
): PlanningModeController {
  return {
    loadImportedData: implementation.loadImportedData ?? (() => {}),
    clear: implementation.clear ?? (() => {}),
    render: implementation.render ?? (() => {}),
    pause: implementation.pause ?? (() => {}),
    play: implementation.play ?? (() => {}),
    togglePlayback: implementation.togglePlayback ?? (() => {}),
    setDistance: implementation.setDistance ?? (() => {}),
    getExportData: implementation.getExportData ?? (() => ({ waypoints: [], objects: [], nodes: [], template: "" })),
    hasData: implementation.hasData ?? (() => false),
    bindEvents: implementation.bindEvents ?? (() => {}),
    handleKeydown: implementation.handleKeydown ?? (() => false),
    drawOverlay: implementation.drawOverlay ?? (() => {}),
    drawTimeline: implementation.drawTimeline ?? (() => {}),
    hitTestField: implementation.hitTestField ?? (() => -1),
    getTelemetryProperties: implementation.getTelemetryProperties ?? ((extra = {}) => ({
      plan_waypoints: 0,
      plan_objects: 0,
      plan_methods: 0,
      plan_nodes: 0,
      template_chars: 0,
      ...extra,
    })),
  };
}
