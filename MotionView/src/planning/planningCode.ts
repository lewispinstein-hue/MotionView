import type { PlanningFeature } from "./PlanningFeature";
import { buildPlanExportCode } from "./planningTemplate";

function format(value: unknown, decimals = 2): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toFixed(decimals).replace(/\.?0+$/, "");
}

export function generatePlanningCode(planning: PlanningFeature): string {
  const data = planning.exportData();
  return buildPlanExportCode({
    template: data.template,
    waypoints: data.waypoints,
    nodes: data.nodes,
    objects: data.objects,
    readPlanSpeed: (value) => Number.isFinite(Number(value)) ? Number(value) : 127,
    formatTemplateNumber: (value, decimals = 3) => format(value, decimals),
    planThetaDegAt: (index) => Number(data.waypoints[index]?.theta) || 0,
    getSortedPlanNodes: () => [...data.nodes].sort(
      (a, b) => a.beforeWaypoint - b.beforeWaypoint || a.index - b.index,
    ),
  });
}
