export interface RenderSchedulerCallbacks {
  drawField(): void;
  drawViewingTimeline(): void;
  drawPlanningTimeline(): void;
}

let callbacks: RenderSchedulerCallbacks | null = null;
let drawQueued = false;

export function configureRenderScheduler(nextCallbacks: RenderSchedulerCallbacks): void {
  callbacks = nextCallbacks;
}

export function drawAllNow(): void {
  callbacks?.drawField();
  callbacks?.drawViewingTimeline();
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
