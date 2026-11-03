import type { PlanWaypoint } from "../state/models";
export const DEFAULT_BOOMERANG_LEAD = 0.6;
export function normalizePlanningLead(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : DEFAULT_BOOMERANG_LEAD;
}
export function isBoomerangWaypoint(point: Readonly<PlanWaypoint>): boolean {
  return (
    (typeof point.lead === "number" && Number.isFinite(point.lead)) ||
    !!point.motions?.some((m) => m.type === "boomerang")
  );
}
export function waypointLead(point: Readonly<PlanWaypoint>): number {
  return isBoomerangWaypoint(point) ? normalizePlanningLead(point.lead) : 0;
}
export function isSegmentForwards(
  start: Readonly<PlanWaypoint>,
  end?: Readonly<PlanWaypoint>,
): boolean {
  if (typeof start.forwards === "boolean") return start.forwards;
  if (!end || (start.x === end.x && start.y === end.y)) return true;
  const pathTheta =
    (Math.atan2(end.x - start.x, end.y - start.y) * 180) / Math.PI;
  return (
    Math.abs(((pathTheta - (Number(start.theta) || 0) + 540) % 360) - 180) <= 90
  );
}

/** Facing heading for a distance drive, clockwise from +Y, including reverse. */
export function segmentDriveHeading(
  start: Readonly<PlanWaypoint>,
  end?: Readonly<PlanWaypoint>,
): number {
  const heading = !end || (start.x === end.x && start.y === end.y)
    ? Number(start.theta) || 0
    : Math.atan2(end.x - start.x, end.y - start.y) * 180 / Math.PI +
      (isSegmentForwards(start, end) ? 0 : 180);
  return ((heading % 360) + 360) % 360;
}
