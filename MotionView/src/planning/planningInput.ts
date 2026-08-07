import type { PlanningInput } from "./planningTypes";

export function createPlanningInput(): PlanningInput {
  return {
    bindEvents() {},
    handleKeydown() {
      return false;
    },
  };
}
