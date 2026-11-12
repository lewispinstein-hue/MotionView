import { getMode } from "../app/modeController";
import { planningTelemetry } from "../telemetry/createTelemetry";

export interface RenderSchedulerCallbacks {
  drawField(): void;
}

export interface ViewingRenderLayer {
  drawTimeline(): void;
}

export interface PlanningRenderLayer {
  drawTimeline(): void;
}

let callbacks: RenderSchedulerCallbacks | null = null;
let viewingLayer: ViewingRenderLayer | null = null;
let planningLayer: PlanningRenderLayer | null = null;
let drawQueued = false;

export function configureRenderScheduler(
  nextCallbacks: RenderSchedulerCallbacks,
): void {
  callbacks = nextCallbacks;
}

export function registerViewingRenderLayer(layer: ViewingRenderLayer): void {
  viewingLayer = layer;
}

export function registerPlanningRenderLayer(layer: PlanningRenderLayer): void {
  planningLayer = layer;
}

export function drawAllNow(): void {
  const planning = getMode() === "planning";
  const startedAt = planning ? performance.now() : 0;
  callbacks?.drawField();
  viewingLayer?.drawTimeline();
  planningLayer?.drawTimeline();
  if (planning) planningTelemetry.recordRender(performance.now() - startedAt);
}

export function requestDrawAll(): void {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    drawAllNow();
  });
}
