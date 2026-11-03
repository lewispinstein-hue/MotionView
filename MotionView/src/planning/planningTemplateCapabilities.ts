import type { PlanWaypointIndicatorIcon, PlanWaypointMotion } from "../state/models";
import type { PlanningTemplateLibrary } from "./planningTemplatePresets";

export function isVexcodePlanningLibrary(library: PlanningTemplateLibrary): boolean {
  return library === "vexcode-cpp" || library === "vexcode-python";
}

export function supportsPlanningMotion(library: PlanningTemplateLibrary, type: PlanWaypointIndicatorIcon): boolean {
  return !isVexcodePlanningLibrary(library) || type === "forward" || type === "rotate";
}

/** Basic counterparts are temporary; the document retains the original motions. */
export function planningMotionTypeForLibrary(
  type: PlanWaypointIndicatorIcon,
  library: PlanningTemplateLibrary,
): PlanWaypointIndicatorIcon {
  if (supportsPlanningMotion(library, type)) return type;
  return type === "swing" ? "rotate" : "forward";
}

export function planningMotionsForLibrary(
  motions: readonly Readonly<PlanWaypointMotion>[],
  library: PlanningTemplateLibrary,
): readonly Readonly<PlanWaypointMotion>[] {
  if (!isVexcodePlanningLibrary(library)) return motions;
  return motions.map(motion => supportsPlanningMotion(library, motion.type) ? motion : {
    id: motion.id,
    type: planningMotionTypeForLibrary(motion.type, library),
  });
}

/** An unchanged temporary counterpart keeps its original code and motion type. */
export function restorePlanningMotionEdits(
  original: readonly Readonly<PlanWaypointMotion>[],
  edited: readonly Readonly<PlanWaypointMotion>[],
  library: PlanningTemplateLibrary,
): PlanWaypointMotion[] {
  return edited.map(motion => {
    const saved = original.find(entry => entry.id === motion.id);
    return saved && !supportsPlanningMotion(library, saved.type) &&
      motion.type === planningMotionTypeForLibrary(saved.type, library) &&
      !Object.prototype.hasOwnProperty.call(motion, "overrideCode")
      ? { ...saved } : { ...motion };
  });
}
