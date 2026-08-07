import type {
  PlanningModeController,
  PlanningModeDependencies,
} from "./planningTypes";
import { createPlanningActions } from "./planningActions";
import { createPlanningInput } from "./planningInput";
import { createPlanningInternalState } from "./planningInternalState";
import { attachPlanningLegacyBridge } from "./planningLegacyBridge";
import { createPlanningLifecycle } from "./planningLifecycle";
import { createPlanningPlayback } from "./planningPlayback";
import { createPlanningRendering } from "./planningRendering";
import { createPlanningStateApi } from "./planningStateApi";
import { createPlanningTelemetry } from "./planningTelemetry";

export interface CreatePlanningModeOptions {
  defaultExportTemplate: string;
  maxUndoSteps?: number;
}

export function createPlanningMode(
  dependencies: PlanningModeDependencies,
  options: CreatePlanningModeOptions,
): PlanningModeController {
  const readPlanSpeed = dependencies.readPlanSpeed ?? ((value: unknown, fallback = 127) => {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
  });

  const internalState = createPlanningInternalState(options.defaultExportTemplate);
  const state = createPlanningStateApi(internalState);
  const rendering = createPlanningRendering();
  const playback = createPlanningPlayback(internalState, dependencies, rendering);
  const actions = createPlanningActions(internalState, playback, dependencies, {
    defaultExportTemplate: options.defaultExportTemplate,
    maxUndoSteps: options.maxUndoSteps ?? 50,
    readPlanSpeed,
  });
  const input = createPlanningInput();
  const telemetry = createPlanningTelemetry(internalState);
  const lifecycle = createPlanningLifecycle(internalState, actions, playback, dependencies, {
    defaultExportTemplate: options.defaultExportTemplate,
    readPlanSpeed,
  });

  const controller: PlanningModeController = {
    state,
    actions,
    playback,
    rendering,
    input,
    telemetry,
    loadImportedData: lifecycle.loadImportedData,
    clear: lifecycle.clear,
    getExportData: lifecycle.getExportData,
  };

  attachPlanningLegacyBridge(controller, internalState, options.defaultExportTemplate);

  return controller;
}
