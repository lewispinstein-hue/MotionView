import { planningTelemetry } from "../telemetry/createTelemetry";
import type { PlanningDialogs } from "./PlanningDialogs";
import type { PlanningFeature } from "./PlanningFeature";
import { getPlanNodeEffectiveMethod } from "./planningObjects";

const NODE_TEMPLATE_DESCRIPTION =
  "These code changes only apply to this placed node. Available placeholders: ${x}, ${y}, ${theta}, ${distance}, ${iteration}, ${speed}, ${forwards}, ${lead} (@ld), and ${lockedDriveSide} (@side)";

export async function editPlanningNode(
  planning: PlanningFeature,
  dialogs: PlanningDialogs,
  nodeId: string,
): Promise<void> {
  const node = planning.timeline.get(nodeId);
  const method = node
    ? getPlanNodeEffectiveMethod(planning.objects.items, node)
    : null;
  if (!node || !method) return;
  const result = await dialogs.edit({
    title: "Edit Placed Node",
    groupTitle: "Node Code",
    description: NODE_TEMPLATE_DESCRIPTION,
    code: method.code,
  });
  if (!result) return;
  const changed = planning.timeline.setCodeOverride(nodeId, result.code);
  if (changed.changed)
    void planningTelemetry.timelineNodeUpdated(
      planning.telemetryProperties({
        node_override_created: !changed.hadOverride && changed.hasOverride,
        node_override_cleared: changed.hadOverride && !changed.hasOverride,
      }),
    );
}
