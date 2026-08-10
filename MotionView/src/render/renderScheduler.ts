export interface RenderSchedulerCallbacks {
  drawField(): void;
  drawPlanningTimeline(): void;
}

export interface ViewingRenderLayer {
  drawTimeline(): void;
}

let callbacks: RenderSchedulerCallbacks | null = null;
let viewingLayer: ViewingRenderLayer | null = null;
let drawQueued = false;

export function configureRenderScheduler(nextCallbacks: RenderSchedulerCallbacks): void {
  callbacks = nextCallbacks;
}

export function registerViewingRenderLayer(layer: ViewingRenderLayer): void {
  viewingLayer = layer;
}

export function drawAllNow(): void {
  callbacks?.drawField();
  viewingLayer?.drawTimeline();
  callbacks?.drawPlanningTimeline();
}

export function requestDrawAll(): void {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    drawAllNow();
  });
}
