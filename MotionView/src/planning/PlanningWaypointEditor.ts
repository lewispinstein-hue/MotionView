import type { PlanningDialogs } from "./PlanningDialogs";
import type { PlanningFeature } from "./PlanningFeature";

const WAYPOINT_PLACEHOLDERS = "This code moves from this waypoint to the next. ${x}, ${y}, and ${theta} use the destination; ${speed} and ${forwards} use this waypoint. The final waypoint does not emit code.";

/** Opens the shared code editor for a single waypoint and applies its content atomically. */
export class PlanningWaypointEditor {
  constructor(
    private readonly planning: PlanningFeature,
    private readonly dialogs: PlanningDialogs,
  ) {}

  async edit(index: number): Promise<void> {
    const waypoint = this.planning.route.waypoints[index];
    if (!waypoint) return;
    if (index >= this.planning.route.length - 1) {
      const message = index === 0
        ? "This is the only waypoint, so there is no route segment to generate code for. Add another waypoint to create a movement."
        : `Waypoint #${index + 1} is the route destination. It does not generate code; edit waypoint #${index} to change the movement that reaches it.`;
      await this.dialogs.confirm({
        title: "Final Waypoint",
        message,
        confirmLabel: "Got it",
        hideCancel: true,
      });
      return;
    }
    const code = Object.prototype.hasOwnProperty.call(waypoint, "overrideCode")
      ? String(waypoint.overrideCode ?? "")
      : this.planning.exportTemplate;
    const result = await this.dialogs.edit({
      title: "Edit Waypoint",
      subtitle: `Waypoint #${index + 1} → #${index + 2}`,
      groupTitle: "Waypoint Code",
      description: WAYPOINT_PLACEHOLDERS,
      code,
      indicatorIcons: waypoint.indicatorIcons ?? [],
    });
    if (!result) return;
    this.planning.route.updateContent(index, result.code, result.indicatorIcons);
  }
}
