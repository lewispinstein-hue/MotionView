import type { PlanningRendering } from "./planningTypes";

export function createPlanningRendering(): PlanningRendering {
  return {
    render() {},
    renderSidebar() {},
    renderTimelineDom() {},
    drawFieldOverlay() {},
    drawTimeline() {},
    hitTestField() {
      return -1;
    },
  };
}
