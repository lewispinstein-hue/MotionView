import type { PlanningDialogs } from "./PlanningDialogs";
import type { PlanningFeature } from "./PlanningFeature";

const WAYPOINT_PLACEHOLDERS = "Available placeholders: ${x}, ${y}, ${theta}, ${distance}, ${iteration}, ${speed}, and ${forwards}.";

/** Opens the shared code editor for a single waypoint and applies its content atomically. */
export class PlanningWaypointEditor {
  constructor(
    private readonly planning: PlanningFeature,
    private readonly dialogs: PlanningDialogs,
  ) {}

  async edit(index: number): Promise<void> {
    const waypoint = this.planning.route.waypoints[index];
    if (!waypoint) return;
    const code = Object.prototype.hasOwnProperty.call(waypoint, "overrideCode")
      ? String(waypoint.overrideCode ?? "")
      : this.planning.exportTemplate;
    const result = await this.dialogs.edit({
      title: "Edit Waypoint",
      subtitle: `Waypoint #${index + 1}`,
      groupTitle: "Waypoint Code",
      description: WAYPOINT_PLACEHOLDERS,
      code,
      indicatorIcons: waypoint.indicatorIcons ?? [],
    });
    if (!result) return;
    this.planning.route.updateContent(index, result.code, result.indicatorIcons);
  }
}
