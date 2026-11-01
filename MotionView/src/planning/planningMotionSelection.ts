import type { PlanMotionTemplates, PlanWaypointIndicatorIcon, PlanWaypointMotion } from "../state/models";
import { createPlanMotionId } from "./planningState";
import { getMotionCode, MAX_WAYPOINT_MOTIONS, normalizeWaypointMotions } from "./planningMotions";

export interface PlanningMotionDraft {
  readonly id: string;
  readonly type: PlanWaypointIndicatorIcon;
  code: string;
}

/** Modal-local selection; deselected drafts are retained until Confirm or Cancel. */
export class PlanningMotionSelection {
  readonly #templates: Readonly<PlanMotionTemplates>;
  readonly #drafts = new Map<PlanWaypointIndicatorIcon, PlanningMotionDraft>();
  readonly #motions: PlanningMotionDraft[];

  constructor(motions: readonly Readonly<PlanWaypointMotion>[] | undefined, templates: Readonly<PlanMotionTemplates>) {
    this.#templates = { ...templates };
    this.#motions = normalizeWaypointMotions(motions)
      .map((motion) => ({ id: motion.id, type: motion.type, code: getMotionCode(motion, templates) }));
    for (const motion of this.#motions) this.#drafts.set(motion.type, motion);
  }

  get motions(): readonly Readonly<PlanningMotionDraft>[] {
    return this.#motions;
  }

  get result(): PlanWaypointMotion[] {
    return this.#motions.map(({ id, type, code }) => code === this.#templates[type]
      ? { id, type } : { id, type, overrideCode: code });
  }

  isSelected(type: PlanWaypointIndicatorIcon): boolean {
    return this.#motions.some((motion) => motion.type === type);
  }

  toggle(type: PlanWaypointIndicatorIcon): boolean {
    const index = this.#motions.findIndex((motion) => motion.type === type);
    if (index >= 0) {
      if (this.#motions.length === 1) return false;
      this.#motions.splice(index, 1);
    } else {
      if (this.#motions.length >= MAX_WAYPOINT_MOTIONS) return false;
      let draft = this.#drafts.get(type);
      if (!draft) {
        draft = { id: createPlanMotionId(), type, code: this.#templates[type] };
        this.#drafts.set(type, draft);
      }
      this.#motions.push(draft);
    }
    return true;
  }

  swap(): boolean {
    if (this.#motions.length !== 2) return false;
    this.#motions.reverse();
    return true;
  }

  updateCode(id: string, code: string): void {
    const motion = this.#motions.find((entry) => entry.id === id);
    if (motion) motion.code = code;
  }
}
