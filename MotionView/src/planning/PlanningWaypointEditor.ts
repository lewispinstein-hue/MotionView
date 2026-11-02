import type { PlanningDialogs } from "./PlanningDialogs";
import type { PlanningFeature } from "./PlanningFeature";
import { formatDistanceFromInches } from "../shared/units";
import { getWaypointCode, waypointMotionsForEditing } from "./planningMotions";
import { isSegmentForwards } from "./planningSegments";

const WAYPOINT_PLACEHOLDERS =
  "The code that this waypoint will generate. ${x}, ${y}, and ${theta} use the destination; ${speed}, ${forwards}, and ${lead} (@ld) use this waypoint. Lead is 0 for straight segments.";

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
      const message =
        index === 0
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
    const target = this.planning.route.waypoints[index + 1]!;
    const theta = Number.isFinite(target.theta) ? Number(target.theta!.toFixed(1)) : 0;
    const targetPose = `${formatDistanceFromInches(target.x)}, ${formatDistanceFromInches(target.y)}, ${theta}°`;
    const result = await this.dialogs.edit({
      title: "Edit Waypoint",
      subtitle: `Waypoint #${index + 1} → #${index + 2} (${targetPose})`,
      groupTitle: "Waypoint Code",
      description: WAYPOINT_PLACEHOLDERS,
      code: getWaypointCode(waypoint, this.planning.motionTemplates),
      motionEditor: {
        mode: "waypoint",
        templates: this.planning.motionTemplates,
        motions: waypointMotionsForEditing(waypoint),
        forwards: isSegmentForwards(waypoint, target),
      },
    });
    if (!result?.motions) return;
    this.planning.route.updateMotions(index, result.motions, result.forwards);
  }
}
