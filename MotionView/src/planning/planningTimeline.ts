import { getMode } from "../app/modeController";

export interface PlanningTimelineRendererDependencies {
  planningTimelineCanvas: HTMLCanvasElement | null;
  context: CanvasRenderingContext2D | null;
  getCurrentPlanTimelineLayout(): { waypointX?: number[] } | null;
  getPlanTotalLength(): number;
  getPlanPlayDistance(): number;
  getPlanTimelineXFromDistance(distance: number): number;
  timelinePadX: number;
}

export interface PlanningTimelineRenderer {
  draw(): void;
}

export function createPlanningTimelineRenderer(deps: PlanningTimelineRendererDependencies): PlanningTimelineRenderer {
  function draw() {
    if (!deps.planningTimelineCanvas || !deps.context) return;
    if (getMode() !== "planning") return;

    const rect = deps.planningTimelineCanvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const layout = deps.getCurrentPlanTimelineLayout();
    const ctx = deps.context;
    ctx.clearRect(0, 0, width, height);

    const total = deps.getPlanTotalLength();
    if (total <= 0) return;

    const y = height / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(deps.timelinePadX, y);
    ctx.lineTo(width - deps.timelinePadX, y);
    ctx.stroke();

    const progressX = deps.getPlanTimelineXFromDistance(deps.getPlanPlayDistance());
    ctx.strokeStyle = "rgba(120,180,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(deps.timelinePadX, y);
    ctx.lineTo(progressX, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(progressX, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(90, 162, 250, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "rgba(180,220,255,0.9)";
    const waypointX = layout?.waypointX?.length ? layout.waypointX : [];
    for (const x of waypointX) {
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { draw };
}
