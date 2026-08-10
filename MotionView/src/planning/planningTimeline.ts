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

export interface PlanningTimelineRenderer { draw(): void; }

export function createPlanningTimelineRenderer(deps: PlanningTimelineRendererDependencies): PlanningTimelineRenderer {
  return { draw() {
    if (!deps.planningTimelineCanvas || !deps.context || getMode() !== "planning") return;
    const rect = deps.planningTimelineCanvas.getBoundingClientRect();
    const { width, height } = rect;
    const context = deps.context;
    context.clearRect(0, 0, width, height);
    const total = deps.getPlanTotalLength();
    if (total <= 0) return;
    const y = height / 2;
    context.strokeStyle = "rgba(255,255,255,0.12)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(deps.timelinePadX, y);
    context.lineTo(width - deps.timelinePadX, y);
    context.stroke();
    const progressX = deps.getPlanTimelineXFromDistance(deps.getPlanPlayDistance());
    context.strokeStyle = "rgba(120,180,255,0.9)";
    context.beginPath();
    context.moveTo(deps.timelinePadX, y);
    context.lineTo(progressX, y);
    context.stroke();
    context.beginPath();
    context.arc(progressX, y, 8, 0, Math.PI * 2);
    context.fillStyle = "rgba(90, 162, 250, 0.9)";
    context.fill();
    context.strokeStyle = "rgba(0,0,0,0.9)";
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = "rgba(180,220,255,0.9)";
    for (const x of deps.getCurrentPlanTimelineLayout()?.waypointX ?? []) {
      context.beginPath();
      context.arc(x, y, 3.5, 0, Math.PI * 2);
      context.fill();
    }
  } };
}
