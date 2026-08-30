import type { PlanningLayoutView } from "../../../planning/render/PlanningLayoutView";
import type { ViewingLayoutView } from "../../../viewing/render/ViewingLayoutView";
import type { SettingsFeature } from "../SettingsFeature";

function cssNumber(property: string, fallback: number): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(property));
  return Number.isFinite(value) ? value : fallback;
}

export class LayoutSettingsBinding {
  constructor(private readonly settings: SettingsFeature, private readonly planning: PlanningLayoutView, private readonly viewing: ViewingLayoutView) {}
  apply(): void {
    const value = this.settings.current;
    this.viewing.applyPersistedLayout({ leftSidebarWidth: value.layoutLeftSidebarWidth, sidebarWidth: value.layoutRightSidebarWidthViewing, timelineHeight: value.layoutTimelineHeight });
    this.planning.applyPersistedLayout({ sidebarWidth: value.layoutRightSidebarWidthPlanning, waypointListHeight: value.layoutPlanningWaypointHeight, timelineHeight: value.layoutPlanningTimelineHeight });
  }
  capture(): void {
    this.settings.update({ layoutLeftSidebarWidth: cssNumber("--leftSidebarW", 360), layoutRightSidebarWidthViewing: cssNumber("--rightSidebarWViewing", 370), layoutRightSidebarWidthPlanning: cssNumber("--rightSidebarWPlanning", 370), layoutTimelineHeight: cssNumber("--timelineH", 180), layoutPlanningWaypointHeight: cssNumber("--planListH", 240), layoutPlanningTimelineHeight: cssNumber("--planningTimelineH", 144) }, "system");
  }
}
