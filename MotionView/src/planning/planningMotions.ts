import type {
  PlanMotionTemplates,
  PlanWaypoint,
  PlanWaypointMotion,
} from "../state/models";
import { isWaypointIndicatorIcon } from "./planningIndicators";
import { createPlanMotionId } from "./planningState";

export const MAX_WAYPOINT_MOTIONS = 2;
export const PLANNING_MOTION_TYPES = [
  { type: "forward", name: "Straight" },
  { type: "rotate", name: "Turn" },
  { type: "swing", name: "Swing" },
  { type: "boomerang", name: "Boomerang" },
] as const;

export function createDefaultMotionTemplates(forward: string): PlanMotionTemplates {
  return {
    forward,
    rotate: "turnToHeading(${theta});",
    swing: "swingToHeading(${theta});",
    boomerang: "moveToPose(${x}, ${y}, ${theta});",
  };
}

export function normalizeMotionTemplates(
  value: unknown,
  fallback: Readonly<PlanMotionTemplates>,
): PlanMotionTemplates {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown> : {};
  const result = { ...fallback };
  for (const { type } of PLANNING_MOTION_TYPES) {
    if (typeof source[type] === "string") result[type] = source[type];
  }
  return result;
}

/** Retains order and empty overrides, with one or two distinct motion types. */
export function normalizeWaypointMotions(value: unknown): PlanWaypointMotion[] {
  const motions: PlanWaypointMotion[] = [];
  const ids = new Set<string>();
  const types = new Set<PlanWaypointMotion["type"]>();
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== "object" || !isWaypointIndicatorIcon(raw.type)) continue;
    if (types.has(raw.type)) continue;
    let id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || ids.has(id)) id = createPlanMotionId();
    ids.add(id);
    types.add(raw.type);
    const motion: PlanWaypointMotion = { id, type: raw.type };
    if (typeof raw.overrideCode === "string") motion.overrideCode = raw.overrideCode;
    motions.push(motion);
    if (motions.length === MAX_WAYPOINT_MOTIONS) break;
  }
  return motions.length ? motions : [{ id: createPlanMotionId(), type: "forward" }];
}

export function getMotionCode(
  motion: Readonly<PlanWaypointMotion>,
  templates: Readonly<PlanMotionTemplates>,
): string {
  return Object.prototype.hasOwnProperty.call(motion, "overrideCode")
    ? motion.overrideCode ?? "" : templates[motion.type];
}

/** Legacy code is one intact motion, never inferred from its visual-only tags. */
export function waypointMotionsForEditing(point: Readonly<PlanWaypoint>): PlanWaypointMotion[] {
  if (Array.isArray(point.motions)) return normalizeWaypointMotions(point.motions);
  const motion: PlanWaypointMotion = { id: createPlanMotionId(), type: "forward" };
  if (Object.prototype.hasOwnProperty.call(point, "overrideCode")) {
    motion.overrideCode = point.overrideCode ?? "";
  }
  return [motion];
}

export function getWaypointCode(
  point: Readonly<PlanWaypoint>,
  templates: Readonly<PlanMotionTemplates>,
): string {
  if (Array.isArray(point.motions)) {
    return point.motions.map((motion) => getMotionCode(motion, templates)).join("\n");
  }
  return Object.prototype.hasOwnProperty.call(point, "overrideCode")
    ? point.overrideCode ?? "" : templates.forward;
}
